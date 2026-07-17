# Context Management Layer (`.claude/context/`)

Executable mechanism operationalizing [Context Artifacts](../constitution/CONTEXT_ARTIFACTS.md) **§8** (canonical policy) — introduced framework 1.5.0 (see [ADR-020](../../docs/14-governance/architecture-decisions/ADR-020-context-management-layer.md)). Rationale, behaviour, and guarantees live in §8 and ADR-020 and are **not** restated here; this file only names the files and how to run the tool.

## Files

| File | Kind |
|---|---|
| `BOOT_MANIFEST.json` | authored: minimum boot document set |
| `EXECUTION_MANIFEST.json` | authored: minimum artifact set per workflow (one entry per `.claude/workflows/*.md`) |
| `ARTIFACT_DEPENDENCIES.json` | authored: artifact dependency graph + cache scopes (§2/§3.1) |
| [`../tooling/context-loader.js`](../tooling/context-loader.js) | the single deterministic engine (`resolve` / `--measure` / `--validate`) |
| [`../tooling/context-loader.config.json`](../tooling/context-loader.config.json) | repository-specific paths + token-estimate model |

Manifests are **JSON** (parsed with `JSON.parse`; no custom parser). The layer holds **no persistent generated state**: warm/cold and the load delta are derived at call time from the authoritative [`../knowledge/SESSION_STATE.yaml`](../knowledge/SESSION_STATE.yaml) and [`../knowledge/SYNC_STATE.yaml`](../knowledge/SYNC_STATE.yaml) `cache_state`, so there is nothing to store, rebuild, or prune.

## Commands

```sh
node .claude/tooling/context-loader.js resolve --workflow preflight   # minimum load set + warm reuse + delta
node .claude/tooling/context-loader.js --measure                      # ESTIMATED reduction (byte proxy, not a tokenizer count)
node .claude/tooling/context-loader.js --validate                     # correctness (CI job context-manifest; G4 sub-check)
```

`--validate` is the only Context-Management step in CI (`../../.github/workflows/ci.yml`, job `context-manifest`); measurement is a human-facing estimate and is not run in blocking CI. Absent the manifests or the loader, the platform degrades to pre-1.5.0 behaviour — read every authoritative document (§1.5 fail-safe).
