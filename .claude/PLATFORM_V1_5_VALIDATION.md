# Platform 1.5.0 — Context Management Layer: Pre-Merge Refinement & Validation

**Scope:** Framework Improvement Workflow refinement of PR #156 (Context Management Layer) before merge.
**Authority:** Existing `.claude/` framework; preserve architecture; improve only where necessary; no regressions; no duplicated authority.
**Canonical policy:** [`constitution/CONTEXT_ARTIFACTS.md`](constitution/CONTEXT_ARTIFACTS.md) §8. **Decision:** [ADR-020](../docs/14-governance/architecture-decisions/ADR-020-context-management-layer.md) (Proposed).

This report records the Lead Architect / Framework Engineer / Security Reviewer / Consistency Reviewer refinement pass and its evidence. Every required improvement was applied except where keeping the current shape is the smaller long-term maintenance surface, in which case the justification is recorded.

## Disposition of each required improvement

| # | Required improvement | Disposition | Evidence |
|---|---|---|---|
| 1 | Remove unnecessary manual maintenance; derive manifests from existing metadata where possible | **Partially applied + justified.** Dropped every *derivable* field from `EXECUTION_MANIFEST`: the workflow `file` (now derived as `.claude/workflows/<id>.md`), `gates` (stay with the workflow / `LOOP_REGISTRY.yaml`), the duplicated `framework_version` field (VERSION.yaml is sole authority). The per-workflow **document/artifact load set is irreducible authored data** — it is not present in any existing machine-readable metadata and can only be recovered from prose by parsing natural language, which ADR-020 rejects on determinism grounds. `--validate` guards it against drift. | `context/EXECUTION_MANIFEST.json`; ADR-020 Decision 2 / Alternatives |
| 2 | Reduce cache-invalidation scope; prefer content digests over framework-version | **Applied.** Boot Context is now keyed by a **content digest of its boot documents** (`bootDigest()`), not the framework-version string. A version bump that changes no boot document no longer invalidates it. The duplicated `framework_version` manifest fields are gone. | `tooling/context-loader.js` `bootDigest`; `knowledge/SYNC_STATE.yaml` `cache_state.boot_context.key`; §8 |
| 3 | Eliminate unnecessary state; remove SESSION_CONTEXT/CACHE_STATE if derivable | **Applied.** Both generated files, `--emit`, `--prune`, and the `.gitignore` entries are removed. Warm/cold and the load **delta are derived at call time** from the authoritative `SESSION_STATE.yaml` / `SYNC_STATE.yaml` `cache_state`. Nothing is persisted, so nothing is rebuilt or pruned. | loader `resolve`; ADR-020 Decision 4 / Alternatives |
| 4 | Reduce framework complexity; minimize the engine; avoid engine growth | **Applied.** Loader shrank **646 → 356 lines** (−45%): removed the handwritten parser, the emit/prune/checkpoint machinery, and two validation cross-checks. Kept a single file (splitting would add surface, not remove it). | `git` diff of `tooling/context-loader.js` |
| 5 | Eliminate unnecessary custom parsing | **Applied.** Authored manifests are **JSON** (`JSON.parse`); the ~130-line handwritten YAML-subset parser is deleted. Only a few narrow regexes remain, to read the pre-existing framework YAML files the tool does not own (`VERSION` / `SYNC_STATE` / `SESSION_STATE`). | `context/*.json`; loader `syncCacheState` / `sessionInfo` |
| 6 | Reported metrics must be labelled estimates | **Applied.** `--measure` output is headed "ESTIMATED reduction (byte/4 proxy, NOT a tokenizer count)"; config, §8, ADR-020, CHANGELOG, and release notes all label it an estimate. | `tooling/context-loader.js` measure; `context-loader.config.json` `tokenModel.note` |
| 7 | Keep CI minimal; validation only | **Applied.** The `context-manifest` CI job now runs only `--validate`; the measurement/reporting step is removed from blocking CI. | `.github/workflows/ci.yml` |
| 8 | Reduce documentation duplication | **Applied.** `context/README.md` no longer restates the behaviour table or rationale — it points at §8 / ADR-020 and lists only files + commands. Invalidation semantics and version authority are not copied into the manifests. | `context/README.md` |

## Guarantees maintained (no regressions)

Verified by direct execution at the current revision:

| Guarantee | Preserved by | Evidence |
|---|---|---|
| deterministic loading | pure resolution over JSON manifests | `resolve --workflow <id>` is stable |
| lazy loading | `load: "lazy"` documents resolved on demand | resolve output separates eager/lazy |
| dependency expansion | `depends_on` transitive closure | `documentation` expands 4 → 9 artifacts |
| warm-context reuse | derived from `SESSION_STATE` + `SYNC_STATE` | `preflight` shows 3 warm, 0 cold |
| delta loading | delta = cold set (not-yet-warm) | `documentation` delta = 5 cold after warm boot/evidence |
| cache invalidation | revision equality + boot-document digest | boot warm iff digest matches recorded key |
| automatic inheritance | Pre-flight resolve; rebuild/prune now structural | `preflight.md`, `repository-synchronization.md`, `postflight.md` |
| CI enforcement | `context-manifest` job, `--validate` | job passes; negative test fails as expected |
| backward compatibility | fail-safe: absent manifests ⇒ full load | loader returns fail-safe error path; §1.5 |

## Validation evidence (this revision)

- `node .claude/tooling/context-loader.js --validate` → **Errors: 0** (exit 0). Negative test (a workflow file with no entry) → **exit 1** with the precise finding, confirming the correctness gate bites.
- `node .claude/tooling/context-loader.js --measure` → estimated **~83%** average minimum-load reduction, **~90%** warm-session, across all 19 workflows (byte/4 proxy, explicitly not a tokenizer count).
- `node .claude/tooling/repository-integrity-check.js` → **0 new blocking findings** (exit 0).
- All three `context/*.json` parse with `JSON.parse`; `.github/workflows/ci.yml` is valid YAML.

## No duplicated authority (Consistency Reviewer)

- Version authority: **only** `VERSION.yaml` (manifests no longer carry `framework_version`).
- Invalidation semantics: **only** `CONTEXT_ARTIFACTS.md` §3.2 (manifests no longer carry `invalidated_by`).
- Session / cache validity: **only** `SESSION_STATE.yaml` / `SYNC_STATE.yaml` `cache_state` (no generated projection files exist).
- Gate planning: **only** the workflow files / `LOOP_REGISTRY.yaml` (removed from the execution manifest).

## Security Reviewer note

Process tooling only; no product surface touching authentication, tenant boundaries, or money (Security Principles §11). The loader performs no shell/command construction and only reads repository files under `REPO_ROOT`; JSON parsing replaces handwritten parsing, reducing input-handling surface. CI runs a single deterministic, dependency-free `--validate` with the default read-only token.
