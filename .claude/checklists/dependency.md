# Dependency Checklist

- [ ] `DP-01` Declared dependencies match repository imports, manifests, contracts, and runtime configuration.
- [ ] `DP-02` Every added/removed/changed edge identifies producer, consumer, owner, and reason.
- [ ] `DP-03` All direct and transitive consumers of changed contracts/events/schemas are inventoried.
- [ ] `DP-04` Compatibility is classified with evidence; unknown is not passed.
- [ ] `DP-05` Breaking changes have staged producer/consumer migration, versioning, and removal criteria.
- [ ] `DP-06` Contract tests cover expected and incompatible behavior.
- [ ] `DP-07` Package version and lock state are intentional and reproducible.
- [ ] `DP-08` New/updated external dependencies pass need, maintenance, license, security, and runtime assessment.
- [ ] `DP-09` No undeclared cycle, duplicate responsibility, or private-internal dependency is introduced.
- [ ] `DP-10` Dependency graph, docs, generated artifacts, rollout, and rollback are synchronized.
