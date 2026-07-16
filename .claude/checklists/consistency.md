# Consistency Checklist

- [ ] `CS-01` Candidate and comparison artifacts are versioned and authority-classified.
- [ ] `CS-02` Terms, actors, statuses, and identifiers match the canonical terminology source.
- [ ] `CS-03` Requirements, rules, examples, and acceptance criteria do not contradict.
- [ ] `CS-04` Each business rule has one canonical definition; references do not duplicate it.
- [ ] `CS-05` Module ownership and boundaries agree across spec, code, registry, and graph.
- [ ] `CS-06` Interface/event/schema names, versions, fields, and errors agree across producers/consumers.
- [ ] `CS-07` Current state, target state, proposals, and historical material are clearly separated.
- [ ] `CS-08` All links, IDs, paths, and cross-references resolve to the intended active artifact.
- [ ] `CS-09` Status/version/approval metadata and supersession relationships agree.
- [ ] `CS-10` Every affected active dependent is updated or recorded as a blocking synchronization item.
- [ ] `CS-11` Repository Integrity Validation (`../tooling/repository-integrity-check.js`, `ART-INTEGRITY-001`) reports zero new (non-baselined) blocking findings — broken markdown links, broken ADR/specification/governance/knowledge/implementation-execution references, broken cross-index references, duplicate authorities, and missing canonical references; any new finding is fixed or recorded in the Specification Issues Register before this check passes.
