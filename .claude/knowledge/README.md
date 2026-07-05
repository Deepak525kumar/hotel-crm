# Project Knowledge Adapter

This directory is the only project-specific layer of the reusable platform. It contains revision-bound indexes, not a competing source of truth.

## Files

- `PROJECT_PROFILE.md` — repository identity, active surfaces, authoritative-source map, and commands.
- `MODULE_REGISTRY.yaml` — observed modules, paths, owners, and lifecycle status.
- `DEPENDENCY_GRAPH.yaml` — machine-readable module, contract, event, state, and dependency relationships.
- `TERMINOLOGY.md` — approved project terms, aliases, and deprecations.
- `DECISION_INDEX.md` — index of decisions; decision records remain in the project documentation tree.
- `SYNC_STATE.yaml` — last verified revisions and known drift.
- `LOOP_REGISTRY.yaml` — framework-scoped index classifying every workflow as a bounded loop (see `../constitution/LOOP_CONTROL.md`).
- `CAPABILITY_REGISTRY.yaml` — framework-scoped index of platform capabilities mapped to responsible agents, inputs, outputs, workflows, gates, and authority.
- `IMPROVEMENT_LOG.yaml` — deterministic improvement records produced by the learning workflow (`../workflows/learning.md`).

`LOOP_REGISTRY.yaml` and `CAPABILITY_REGISTRY.yaml` index reusable framework workflows and capabilities; they are co-located here for discoverability and travel with the framework rather than with project-specific entries.

## Rules

1. Every entry cites a repository source or approved decision.
2. `unknown` is valid; an invented value is not.
3. Indexes summarize sources and never outrank them.
4. Bind generated summaries to a repository revision and invalidate them when relevant files change.
5. Update canonical source before updating an index.
6. For another project, retain the schemas/instructions and replace repository-specific entries during initial pre-flight.

## Minimum Context Package

Each package contains objective, revision, frozen inputs, relevant excerpts/paths, direct dependencies, criteria, exclusions, output contract, and return condition. Do not send this whole directory when only one indexed slice is needed.
