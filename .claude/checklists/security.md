# Security Checklist

- [ ] `SC-01` Assets, sensitive data, actors, trust boundaries, and attack surface changes are identified.
- [ ] `SC-02` Authentication establishes identity safely; session/token lifecycle and revocation are defined.
- [ ] `SC-03` Authorization is server-enforced, least-privileged, deny-by-default, and object/tenant scoped.
- [ ] `SC-04` Untrusted input is validated and output is safely encoded for its sink.
- [ ] `SC-05` Secrets are externalized, access-controlled, rotatable, redacted, and absent from repository/log evidence.
- [ ] `SC-06` Sensitive data collection, storage, transit, retention, deletion, and audit satisfy approved policy.
- [ ] `SC-07` Errors/logs avoid sensitive leakage while retaining auditable security events.
- [ ] `SC-08` Dependencies/images/services have intentional versions and reviewed vulnerabilities, provenance, and licenses.
- [ ] `SC-09` Abuse cases cover replay, enumeration, injection, privilege escalation, resource exhaustion, and unsafe failure.
- [ ] `SC-10` Findings, mitigations, verification, residual risk, expiry, and human acceptance are recorded.
