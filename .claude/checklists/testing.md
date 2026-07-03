# Testing Checklist

- [ ] `TS-01` Every acceptance criterion and business rule maps to at least one identified test case.
- [ ] `TS-02` Positive, negative, boundary, and authorization behavior is covered where applicable.
- [ ] `TS-03` Integration behavior across affected interfaces is exercised, not only isolated units.
- [ ] `TS-04` Each defect corrected in this change has a regression test that fails without the fix.
- [ ] `TS-05` Required environment, data, and fixtures are identified and reproducible.
- [ ] `TS-06` Tests are deterministic and isolated; order or shared state does not alter results.
- [ ] `TS-07` Flaky or infrastructure-dependent checks are quarantined, not accepted as passing.
- [ ] `TS-08` Each result records exact command, revision, environment, expected, and actual evidence.
- [ ] `TS-09` A coverage matrix links every criterion/rule to its test and status.
- [ ] `TS-10` Untested areas, residual limitations, and unverifiable criteria are stated explicitly.
