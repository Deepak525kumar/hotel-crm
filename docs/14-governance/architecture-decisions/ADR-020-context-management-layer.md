# ADR-020: Context Management Layer — Deterministic Minimum-Context Loading over the Existing Context Artifacts

- **Status:** Proposed — pending human ratification (Engineering Constitution §20), consistent with the ADR-001..010 precedent and the framework-1.2.0 Context Artifacts (§6–§7) and framework-1.4.0 (ADR-019) precedents.
- **Date:** 2026-07-16
- **Scope:** Engineering operating system (`.claude/`) — framework 1.5.0. Introduces one new top-level directory (`.claude/context/`) and one deterministic engine (`.claude/tooling/context-loader.js`) in the existing `.claude/tooling/` directory, plus one CI job (`.github/workflows/ci.yml`, job `context-manifest`).
- **Supersedes:** none (additive; operationalizes the existing [Context Artifacts](../../../.claude/constitution/CONTEXT_ARTIFACTS.md) policy rather than introducing a new gate or workflow).
- **Change class:** Non-constitutional framework addition. No `constitution/*` file's normative rules are rewritten: `CONTEXT_ARTIFACTS.md` gains one additive section (§8) and `REVIEW_GATES.md`'s Applicability Rules gain one entry, in the same additive shape as the ADR-019 Repository Integrity row. Recorded as a Decision Record per Constitution §6/§7 because it introduces a new artifact class (`ART-MANIFEST`) and a new top-level `.claude/` directory, mirroring the ADR-010/ADR-019 precedent.

## Problem

Framework 1.2.0 defined the reusable, revision-bound **Context Artifacts** (Boot Context, Evidence Package, Dependency Context, Context Package, Module Memory, Finding/Correction/Review Packages) and the discover-once / reference-over-copy / invalidate-by-digest invariants ([CONTEXT_ARTIFACTS.md](../../../.claude/constitution/CONTEXT_ARTIFACTS.md) §1–§7). It did **not** specify *which* artifacts a given workflow must load. That decision was left to each workflow file's prose ("Context Packages", "Inputs", "Agent I/O Contracts"), so:

- the minimum context package (CLAUDE.md §Context Assembly) was re-derived, in prose, once per workflow — the exact per-agent re-derivation the Context Artifacts were meant to eliminate at the artifact level;
- there was no deterministic, tool-checkable answer to "what is the minimum authoritative set for workflow X at revision R?", and therefore no way to *measure* whether loading was in fact minimised or to *enforce* that a workflow's declared inputs still resolve;
- delta loading, warm-context reuse, revision-aware invalidation, checkpointing, and pruning existed as *policy* (§3, §6) but had no executable implementation — every session performed them by hand, inconsistently.

## Decision

1. **No new workflow or gate is introduced.** The Context Management Layer is an *executable mechanism* that operationalizes the existing Context Artifacts policy. It adds one additive constitutional section ([CONTEXT_ARTIFACTS.md](../../../.claude/constitution/CONTEXT_ARTIFACTS.md) §8) and one [REVIEW_GATES.md](../../../.claude/constitution/REVIEW_GATES.md) Applicability entry (Context Manifest Validation), both marked Proposed pending ratification.
2. **A declarative load plan (JSON)** lives in a new `.claude/context/` directory:
   - `BOOT_MANIFEST.json` — the minimum boot document set (projection of the Boot Context, §2.1);
   - `EXECUTION_MANIFEST.json` — the minimum artifact set per workflow (the concern previously implicit in prose);
   - `ARTIFACT_DEPENDENCIES.json` — the artifact dependency graph + cache scopes (projection of §2 and §3.1).
   These files **reference** canonical artifact IDs and document paths; they restate no policy. Invalidation *semantics* stay solely in §3.2 and the *version* authority solely in `VERSION.yaml` — the manifests carry neither (no duplicated authority). JSON so the loader needs no parser. The per-workflow document/artifact set is the one input not derivable from existing metadata without parsing prose; everything derivable is omitted (the workflow file is derived from the id; gate planning stays with the workflow / `LOOP_REGISTRY.yaml`). On conflict `CONTEXT_ARTIFACTS.md` wins.
3. **One deterministic engine, two callers.** `.claude/tooling/context-loader.js` is a dependency-free Node script — as runnable by a human contributor or CI as by an AI session. It `resolve`s the minimum load set for a workflow (expanding artifact dependencies, reusing warm Repository-Session artifacts, and reporting the load delta as the cold set, all derived at call time), `--measure`s the reduction (a labelled estimate), and `--validate`s the manifests. It is invoked by (a) the AI framework at Pre-flight, and (b) CI (`context-manifest` job, `--validate` only) on every pull request. Neither caller restates the logic (Constitution §17).
4. **No persistent generated state.** The loader writes no files. Warm/cold and the load delta are **derived at call time** from the authoritative [`SESSION_STATE.yaml`](../../../.claude/knowledge/SESSION_STATE.yaml) (§6) and [`SYNC_STATE.yaml`](../../../.claude/knowledge/SYNC_STATE.yaml) `cache_state` (§3.3), so there is nothing to store, rebuild, or prune. The framework-version-scoped Boot Context is keyed by a **content digest of its boot documents** (a blob-digest form §3.1 already permits), not the version string — reducing invalidation scope so a version bump that changes no boot document does not invalidate it.
5. **A new artifact identity, `ART-MANIFEST`,** is registered in [`.claude/workflows/README.md`](../../../.claude/workflows/README.md)'s Artifact ID Prefixes table, produced by the tool rather than authored per candidate — mirroring `ART-INTEGRITY` (ADR-019).
6. **The `context-manifest` validation is enforced two symmetric ways** (the ADR-019 pattern): a Consistency-Reviewer sub-check at G4 (reused at G6/G9) and, independently, a CI job on every pull request regardless of authorship. It validates correctness only — it fails on a missing referenced file, a `.claude/workflows/*.md` with no manifest entry (or a duplicate), an undeclared/unknown artifact reference, or a dependency edge to an undeclared node. Measurement (`--measure`) is a labelled estimate and is deliberately kept out of blocking CI.
7. **The engine is added to the existing `.claude/tooling/`** directory established by ADR-019 for reusable, executable framework tooling — no new tooling category is created.

## Alternatives Considered

- **Parse the load set from each workflow's prose at runtime** — rejected: brittle, non-deterministic, and it would make the workflows' natural-language sections load-bearing machine input, coupling documentation wording to tool behaviour.
- **A new top-level `context-management` workflow** — rejected per Constitution §3.5 "single responsibility": loading is a cross-cutting mechanism every workflow inherits at Pre-flight, not a lifecycle stage with its own entry/exit gate.
- **Persist `SESSION_CONTEXT` / `CACHE_STATE` checkpoint files** (the shape of the first 1.5.0 draft) — rejected on refinement: any persisted form either duplicates the authority of `SESSION_STATE.yaml` / `SYNC_STATE.yaml` `cache_state` (if checked in) or is dead weight to rebuild and prune (if generated). Warm/cold and the delta are fully derivable from those authoritative records at call time, so no persistent state is kept — the smallest maintenance surface.
- **YAML manifests parsed by a handwritten parser** (the first 1.5.0 draft) — rejected on refinement: a ~130-line custom parser is avoidable maintenance and a determinism risk. The authored manifests are JSON (`JSON.parse`); only a few narrow regexes read the pre-existing framework YAML files the tool does not own (`VERSION` / `SYNC_STATE` / `SESSION_STATE`).
- **Derive the per-workflow load set from workflow prose** — rejected: brittle and non-deterministic. The load set is the one irreducible authored input; everything genuinely derivable (workflow file path, gates) is omitted from the manifest instead.

## Compatibility

Strictly additive. No existing gate, finding schema, confidence rule, loop bound, or specialist boundary is changed. `CONTEXT_ARTIFACTS.md` gains §8; `REVIEW_GATES.md` gains one Applicability entry; `LOOP_REGISTRY.yaml`'s `preflight` / `repository-synchronization` / `postflight` entries gain one `produced_artifacts` item each, matching the ADR-019 precedent for wiring a deterministic tool into the same workflows. Absent the manifests or the loader, the platform behaves exactly as framework 1.4.0 (read every authoritative document).

## Migration

None required for existing knowledge, documentation, or governance artifacts. The layer is opt-in by construction: workflows that do not invoke the loader are unaffected; those that do load strictly less.

## Reversibility

Deleting `.claude/context/`, `.claude/tooling/context-loader.js` (+ its config), the `context-manifest` CI job, and the `CONTEXT_ARTIFACTS.md` §8 / `REVIEW_GATES.md` / `LOOP_REGISTRY.yaml` / workflow-file references added by this change returns the platform to 1.4.0 semantics. No data is uniquely stored in the layer; every resolution it reports is reproducible by re-running it against the same revision.

## Validation

`context-loader.js --validate` is clean against the authored manifests; `--measure` gives an **estimated** average minimum-load reduction of ~83% (and ~90% on a warm session) versus a naive full load across all 19 workflows — a deterministic byte proxy for relative comparison, explicitly not a tokenizer count; `repository-integrity-check.js` reports zero new blocking findings for the added files. Self-reviewed by the Lead Architect against Constitution §5/§6/§7/§17/§19 and the Independent Review Protocol given this change's scope (process tooling, not product behaviour touching authentication, tenant boundaries, or money).

## Consequences

- **Positive:** the minimum context package becomes deterministic, measurable, and tool-enforced; delta/warm/lazy loading, checkpointing, revision-aware invalidation, and pruning gain a single implementation every workflow inherits with no duplicated logic; the load plan is reviewable in one place instead of scattered across 19 workflow files.
- **Negative / cost:** a new engine and three manifests to keep in step with the workflow set (mitigated: `--validate` fails CI the moment a workflow lacks an entry, a reference breaks, or the framework version drifts).

## Human Decision Required

Ratify (Proposed → Accepted) this Decision Record, and the accompanying `CONTEXT_ARTIFACTS.md` §8 and `REVIEW_GATES.md` Applicability additions, per Constitution §20 — consistent with the ADR-001..010 and framework-1.2.0/1.4.0 precedent.
