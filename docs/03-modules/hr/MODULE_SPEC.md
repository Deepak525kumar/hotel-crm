# Module Specification: `backend-hr`

## Document Control

| Field | Value |
|---|---|
| Spec ID / version | `SPEC-HR-001 / 0.1.0` |
| Status | `REVIEW` (freeze candidate; G2 Specification-Freeze pending — see Review and Change Log) |
| Owner | `unassigned` — reserved human authority (SYNC-001); no `CODEOWNERS` exists and `backend/package.json` author is empty |
| Authors / reviewers | Author: Module Author (documentation workflow). Independent reviewers (architecture, dependency, consistency): **pending** (G4) |
| Repository revision | `b52f9cc75c413a8bb1eb4f87803be009ea5766eb` (`b52f9cc`) |
| Approved by / at | — (G2 freeze requires the named human approver; not yet approved) |
| Supersedes | None — no prior specification exists at this path |

> **Authoring note (not a normative section change).** Behaviour is derived **exclusively** from the two authoritative documents — `docs/00-foundations/CONFIRMED_REQUIREMENTS_REGISTER.md` (**CRR §n**) and `docs/00-foundations/PIVOT_DESIGN_DOCUMENT.md` (**PDD §n**) — plus the current worktree for repository facts. No behaviour is drawn from marketplace-era or `docs/legacy/**` sources. This spec documents the physical code module `backend/src/modules/hr` (registry id `backend-hr`), which currently implements the combined contracts-lifecycle, payroll/payslip-request, and contract-scan document-upload surface as a single Express router/service. See `OD-HR-01` for the docs↔docs module-boundary ambiguity this creates against `docs/03-modules/employee-management/MODULE_SPEC.md` and the near-empty `docs/03-modules/contracts/`, `docs/03-modules/payslips/`, `docs/03-modules/documents/` directories.

## Purpose and Scope

**Outcome:** Generate and hold the legally required handwritten-signature employment contract for each employee, track its lifecycle and expiry (fixed-term → extension → permanent), gate account activation on manager-confirmed signed-contract receipt, and handle the payslip-request-to-manager-email flow — with zero in-system payroll computation (CRR §9, §23; PDD §7.7).

**In scope:**

- Contract generation: producing a pre-filled contract PDF from Personalfragebogen-sourced worker data (name, start date, terms, 1-year fixed term, 6-month probation clause) and making it available to download/print (CRR §9; PDD §7.7).
- Contract status lifecycle: pending (awaiting signature) → signed/active, and the visible "contract pending signature" safeguard status (CRR §9).
- Storing the scanned/photographed hand-signed contract in S3 (EU) once uploaded (CRR §9; PDD §7.7, §9.3).
- The manager-confirmation mechanism (Option A): recording that a manager uploaded the scan and marked it "signed contract received & valid," which is the trusted trigger — the system does not detect, verify, or auto-validate the handwritten signature (CRR §9; PDD §7.7).
- The activation gate: the worker's account cannot activate until a contract file is uploaded **and** marked signed by a manager; this module owns emitting/holding that gating fact for Onboarding/Employee-Management to consume (CRR §9).
- The 1-year expiry clock, its start (on signed/active), the optional +1-year extension (no new probation), and the permanent (open-ended) contract after 2 years (CRR §9).
- Expiry reminders to the responsible manager before the 1-year mark and again before the 2-year mark; no reminders once permanent (CRR §9; PDD §5.6, §7.7).
- Payslip request flow: a worker requests a payslip; the request is recorded and routed for a manager to fulfil by emailing the payslip manually; the worker cannot retrieve the payslip through the system (CRR §23; PDD §7.7).
- The document-upload endpoint (`POST /workers/:worker_id/documents`) exposed by this module, in scope **only** as the mechanical upload mechanism the contract-scan flow uses ("mechanically treated like any other document upload," CRR §9) — see Out of scope for the general document capability this piggybacks on.
- Retention-tier classification of the payroll/tax-adjacent fields this module touches (IBAN, tax ID, payslip-request records, wage records) as Tier 3 / 6 years for the Retention module to execute (CRR §25).
- The current-state stub surface actually present in code today: `POST/GET /contracts`, `POST/GET /payroll`, `POST /workers/:worker_id/documents` under `/api/v1/hr`, gated by `hr:read`/`hr:write` permissions (current worktree; see Evidence and Traceability).

**Out of scope:** (owned elsewhere and referenced, never redefined — Constitution §6)

- In-system payroll/salary/hourly-rate calculation, overtime calculation, bonuses & deductions, and payroll exports for finance — confirmed zero payroll math in the system (CRR §23, Explicit Non-Goals).
- Self-retrievable payslips — the worker cannot fetch a payslip themselves; only the request-and-manager-email flow exists (CRR §23).
- QES/e-signature/Skribble integration — contracts are signed by hand; no signature-capture or e-signature provider exists or is planned (CRR §9, §34; PDD §11, Appendix).
- Signature detection, authenticity verification, or any automated check of the handwritten signature — the system trusts the manager's confirmation alone (CRR §9; PDD §7.7 trust boundary).
- The general document-upload/expiry capability beyond the contract scan (other worker document types, non-EU work-permit documents, expiry tracking of those documents) — owned conceptually by the "Documents" capability referenced in CRR §4, §7; this module's upload endpoint is in scope only as the mechanism the contract-scan use case rides on.
- Employee identity, core employment fields, lifecycle status, skill tags, and the profile-and-history view — owned by employee-management (`docs/03-modules/employee-management/MODULE_SPEC.md`, SPEC-EMP-001), which explicitly places "Contract generation, storage, and the manager-confirmed hand-signed contract lifecycle" and "payslip request flow" out of its own scope and into conceptual "Contracts"/"Payslips" modules (SPEC-EMP-001 Out of Scope; CRR §9, §23). This spec is the code-level home for that conceptual surface — see `OD-HR-01`.
- Onboarding orchestration: the Personalfragebogen self-service form, the document-collection chatbot, application → familiarization sequencing, and the pool/claim hire-approval mechanism (Onboarding module; CRR §6, §8, §10).
- Authentication, RBAC/scope framework itself, and the platform account object (Authentication/User Management; CRR §1, §2).
- Immutable audit-log infrastructure and its retention mechanics (shared platform capability; this module only classifies and emits events into it) (CRR §30).
- Automatic tiered retention deletion execution (Retention module; this module only classifies fields into Tier 3) (CRR §25).
- Special-category field policy and payslip-processor visibility governance for Konfession (Compliance/employee-management-adjacent; this module is a consumer of the "payslip-request processor" audience concept, not its definer) (CRR §27; SPEC-EMP-001 `RULE-EMP-09`).

**Non-goals:** (confirmed out of the platform entirely — CRR §23, Explicit Non-Goals; PDD §11, Appendix Non-goals)

- Salary/hourly pay calculation, overtime calculation, bonuses & deductions, and payroll exports for finance.
- Self-retrievable payslips.
- Qualified Electronic Signature (QES) / e-signature integration of any kind (contracts signed by hand).
- Any automated signature detection or document-authenticity verification.

## Evidence and Traceability

| Claim/requirement | Source path, line, revision, or decision | Authority | Status |
|---|---|---|---|
| `REQ-HR-001` System generates a pre-filled contract PDF from Personalfragebogen data and makes it available to download/print | CRR §9 (lines 129-130); PDD §7.7 | Authoritative | Confirmed |
| `REQ-HR-002` Contract signed by hand on paper; no QES/e-signature | CRR §9 (lines 117-119); PDD §11, Appendix | Authoritative | Confirmed |
| `REQ-HR-003` Manager uploads the scanned signed contract and marks "signed contract received & valid"; system trusts this confirmation without verifying the signature | CRR §9 (lines 134-139); PDD §7.7, §8.1 | Authoritative | Confirmed |
| `REQ-HR-004` Account cannot activate until a contract file is uploaded AND marked signed; a visible "contract pending signature" status exists | CRR §9 (lines 137-138); PDD §7.7 | Authoritative | Confirmed |
| `REQ-HR-005` Marking signed starts the 1-year expiry clock and reminder schedule | CRR §9 (line 136); PDD §5.6, §7.7 | Authoritative | Confirmed |
| `REQ-HR-006` Contract lifecycle: 1-year fixed-term with 6-month probation (2-week notice either party during probation) → optional +1-year extension (no new probation) → permanent after 2 years | CRR §9 (lines 141-148) | Authoritative | Confirmed |
| `REQ-HR-007` Manager reminded before 1-year expiry and again before 2-year expiry; no reminders once permanent | CRR §9 (lines 150-153); PDD §5.6 | Authoritative | Confirmed |
| `REQ-HR-008` Signed contracts stored in S3 (EU) | CRR §9 (line 133); PDD §5.7, §7.7 | Authoritative | Confirmed |
| `REQ-HR-009` Worker can request a payslip; manager sends it by email manually; worker cannot self-retrieve | CRR §23 (lines 314-316); PDD §7.7, §4.12 | Authoritative | Confirmed |
| `REQ-HR-010` Zero payroll math performed by the system (no salary/hourly/overtime/bonus/deduction calculation, no finance exports) | CRR §23 (lines 317-321); PDD §4.12 | Authoritative | Confirmed |
| `REQ-HR-011` Contract-scan upload is mechanically treated like any other document upload | CRR §9 (line 132) | Authoritative | Confirmed |
| `REQ-HR-012` Payroll/tax-adjacent fields (IBAN, tax ID, payslip-request records, wage records) retained 6 years, automatic deletion (Tier 3) | CRR §25 (line 335) | Authoritative | Confirmed |
| `REQ-HR-013` Contract storage and payslip-request flow are net-new capabilities (no prior implementation to preserve) | CRR §34 (lines 401, 409) | Authoritative | Confirmed |
| `REQ-HR-014` QES/Skribble integration explicitly removed | CRR §34 (line 410); CRR §9 (line 119) | Authoritative | Confirmed |
| `REQ-HR-015` Application → familiarization (max 2 trial days) → contract sequencing precedes contract conclusion | CRR §9 (lines 121-126); PDD §4.2 | Authoritative | Confirmed |
| Backend code module for this domain is `backend-hr`, currently a stub — every `HrService` method throws `NotImplementedError`; holds no business state | `backend/src/modules/hr/service.ts:5-24`; `.claude/knowledge/DEPENDENCY_GRAPH.yaml:34-36`; `.claude/knowledge/MODULE_REGISTRY.yaml:141-151` | Generated (repo-derived) | Confirmed current-state |
| `NotImplementedError` maps to HTTP 501 | `backend/src/lib/errors.ts:77-82`; `HTTP_STATUS.NOT_IMPLEMENTED` (`backend/src/config/constants.ts:13`) | Generated | Confirmed current-state |
| Routes mounted at `/api/v1/hr`: `GET/POST /contracts` (`hr:read`/`hr:write`), `GET/POST /payroll` (`hr:read`/`hr:write`), `POST /workers/:worker_id/documents` (`hr:write`); all behind `authMiddleware` + `requirePermission` | `backend/src/routes/v1/index.ts:31`; `backend/src/modules/hr/routes.ts:1-30` | Generated (repo-derived) | Confirmed current-state |
| `hr:read`/`hr:write` granted only to `ADMIN` and `MANAGER`; `CHECKER` and `WORKER` hold no `hr:*` permission | `backend/src/config/constants.ts:88-129` (`ROLE_PERMISSIONS`) | Generated (repo-derived) | Confirmed current-state |
| `CreateContractRequest` fields: `worker_id`, `template_id`, `position`, `salary_amount`, `start_date`, `end_date?`; `CreatePayrollRequest` fields: `worker_id`, `pay_period_start`, `pay_period_end`, `gross_salary` | `backend/src/modules/hr/types.ts:1-15` | Generated (repo-derived) | Confirmed current-state (types predate the confirmed model; see `OD-HR-02`) |
| No `Contract`, `Payroll`, `Payslip`, or HR-specific `Document` Prisma model exists; only User, Session, Hotel, HotelWorker, WorkRequest, WorkApplication, WorkerAssignment, Attendance, QualityVerification, Rating, WorkerOverallRating, Notification, AuditLog | `backend/prisma/schema.prisma` (current worktree, grep-confirmed) | Generated (repo-derived) | Confirmed current-state — this module holds no business state today |
| `mobile-worker` is the only discovered client consumer of `/hr`; no `frontend-web` or `mobile-checker` edge to `backend-hr` exists | `.claude/knowledge/DEPENDENCY_GRAPH.yaml:276` (`edge-mobile-worker-hr`) | Generated (repo-derived) | Confirmed current-state; flagged as a gap — see `OD-HR-05` |
| No frozen module specification currently maps to `backend-hr`; `specification: UNKNOWN` in the registry | `.claude/knowledge/MODULE_REGISTRY.yaml:150` | Generated | Confirmed |
| Conceptual "Contracts" and "Payslips" module boundaries are referenced by SPEC-EMP-001 as out of its scope, but no separate code module or frozen spec exists for either | `docs/03-modules/employee-management/MODULE_SPEC.md` lines 40, 45; `docs/03-modules/contracts/.gitkeep`, `docs/03-modules/payslips/.gitkeep`, `docs/03-modules/documents/.gitkeep` (current worktree) | Generated (repo-derived) | Confirmed — see `OD-HR-01` |

## Actors and Terminology

| Term/actor | Canonical definition | Source |
|---|---|---|
| Contract | The generated employment-contract PDF plus the stored scanned hand-signed copy and its status/lifecycle metadata | CRR §9; PDD §7.7, §9.3 |
| Contract status | `pending` (generated, awaiting upload+manager confirmation) → `signed`/`active` (manager-confirmed) | CRR §9 |
| Manager confirmation (Option A) | The manager's act of uploading the scan and marking it "signed contract received & valid," trusted without signature verification | CRR §9; PDD §7.7 |
| Familiarization period | Up to 2 trial days before any contract is concluded, to assess mutual fit; precedes contract, not a contract state | CRR §9; PDD §4.2, Appendix |
| Probation period | The 6-month clause inside the initial 1-year fixed-term contract; 2-week notice either party during it; not a separate lifecycle status | CRR §9 |
| Contract extension | The optional +1-year continuation at the 1-year mark; carries no new probation | CRR §9 |
| Permanent contract | The open-ended contract offered after 2 years of successful employment; ends expiry reminders | CRR §9 |
| Payslip request | A worker-initiated request recorded by this module and routed to a manager, who fulfils it by emailing the payslip manually | CRR §23; PDD §7.7 |
| Payslip-request processor | The role/context that handles fulfilling payslip requests; referenced by employee-management as part of the Konfession special-category visibility audience | CRR §27; SPEC-EMP-001 `RULE-EMP-09` |
| Contract-scan document upload | The mechanism by which the scanned signed contract enters the system; mechanically identical to any other document upload | CRR §9 (line 132) |
| Worker (Employee) | The permanent staff role whose contract and payslip requests this module tracks | CRR §1, §4, §9 |
| Hotel Manager / Regional Manager | The roles who confirm signed contracts, receive expiry reminders, and fulfil payslip requests | CRR §1, §9, §23 |
| Admin | System-wide role; holds `hr:*` permissions alongside Manager in current-state code | `backend/src/config/constants.ts:88-102` |

## Requirements and Acceptance Criteria

| Requirement | Statement | Priority | Acceptance criteria | Rule IDs |
|---|---|---|---|---|
| `REQ-HR-001` | Generate a pre-filled contract PDF from the worker's Personalfragebogen data (name, start date, terms, 1-year fixed term, 6-month probation clause) and make it available to download/print. | MUST | A contract record exists in `pending` status with a generated PDF referencing the confirmed field set; the PDF is downloadable/printable before any signature step. | `RULE-HR-01` |
| `REQ-HR-002` | Never capture, verify, or require an electronic signature; the contract is signed by hand on paper. | MUST | No signature-capture UI, QES/Skribble call, or auto-detection logic exists anywhere in the contract flow. | `RULE-HR-02` |
| `REQ-HR-003` | Record the manager's upload of the scanned signed contract and their explicit "signed contract received & valid" confirmation as the sole trigger that flips contract status to signed/active. | MUST | Status transitions to `signed`/`active` only on a manager-attributed upload + explicit confirmation action; no automated signature check runs; the confirming manager and timestamp are recorded. | `RULE-HR-02`, `RULE-HR-03` |
| `REQ-HR-004` | Block worker-account activation until a contract file is uploaded and marked signed; expose a visible "contract pending signature" status in the interim. | MUST | Attempting activation with no uploaded file, or an uploaded-but-unconfirmed file, fails/blocks; the pending status is queryable by consumers (e.g., Onboarding, employee-management). | `RULE-HR-03`, `RULE-HR-04` |
| `REQ-HR-005` | Start the 1-year expiry clock and reminder schedule at the moment of signed/active confirmation. | MUST | The expiry timestamp is derived from the confirmation event, not from contract generation or upload time. | `RULE-HR-05` |
| `REQ-HR-006` | Own the fixed-term → extension → permanent contract lifecycle exactly as confirmed, with no additional states. | MUST | Only the states `pending → signed/active (1yr) → extended (1yr, no new probation) → permanent` are reachable; no other lifecycle values exist. | `RULE-HR-05`, `RULE-HR-06` |
| `REQ-HR-007` | Remind the responsible manager before the 1-year expiry and again before the 2-year expiry; never after the contract becomes permanent. | MUST | A reminder job fires once before each of the two expiry points for non-permanent contracts; no reminder fires once `permanent` status is reached. | `RULE-HR-07` |
| `REQ-HR-008` | Store the scanned signed contract in S3 (EU) with no data leaving the EU/EEA. | MUST | Stored object resolves to an EU-region S3 bucket/path; no non-EU storage path exists. | `RULE-HR-08` |
| `REQ-HR-009` | Accept a worker's payslip request and route it for manual manager fulfilment by email; never expose a worker-facing payslip download/view. | MUST | A payslip request is recorded with requester and timestamp; no endpoint returns payslip content to the requesting worker; manager-side email-send action is the only fulfilment path. | `RULE-HR-09` |
| `REQ-HR-010` | Perform zero payroll computation (no salary/hourly/overtime/bonus/deduction math, no finance export). | MUST | No calculation logic exists in this module for gross/net pay, overtime, bonuses, or deductions; no export endpoint to finance systems exists. | `RULE-HR-10` |
| `REQ-HR-011` | Treat the contract-scan upload mechanically like any other document upload (same endpoint/mechanism class), without owning general document-expiry tracking. | MUST | The contract-scan upload uses the same `POST /workers/:worker_id/documents`-class mechanism as other document types; no contract-specific expiry-tracking logic for non-contract documents exists here. | `RULE-HR-11` |
| `REQ-HR-012` | Classify IBAN, tax ID, payslip-request records, and wage records as Tier 3 (6-year, automatic deletion) for the Retention module. | MUST | Each named field/record type carries a Tier 3 classification tag consumable by Retention; this module performs no deletion itself. | `RULE-HR-12` |

## Business Rules

| Rule | Preconditions | Outcome/invariant | Exceptions/precedence | Owner/source |
|---|---|---|---|---|
| `RULE-HR-01` | Worker's Personalfragebogen data is available (Onboarding-owned) | Contract PDF generated in `pending` status, pre-filled with confirmed fields | Data source and validation owned by Onboarding; this module only consumes it | This module generates; Onboarding owns source data (CRR §6, §9) |
| `RULE-HR-02` | Any contract signature event | Signature is always handwritten-on-paper; no e-signature/QES path exists; the system never attempts to verify authenticity | None — explicitly and permanently excluded (CRR §34 line 410) | This module (CRR §9) |
| `RULE-HR-03` | Manager uploads scanned signed contract and confirms "signed & valid" | Contract status flips `pending → signed/active`; confirmation is trusted without verification | No other actor or automated process may flip this status | This module (CRR §9; PDD §7.7 trust boundary) |
| `RULE-HR-04` | Account-activation attempted | Activation permitted only if a contract file exists AND is marked signed; otherwise blocked with a visible "contract pending signature" status | Enforcement point (account activation itself) is owned by Onboarding/employee-management; this module supplies the gating fact | This module supplies fact; Onboarding/employee-management enforce (CRR §9) |
| `RULE-HR-05` | Contract status becomes `signed/active` | 1-year expiry clock starts from that moment; reminder schedule begins | N/A | This module (CRR §9) |
| `RULE-HR-06` | 1-year fixed-term contract reaches expiry and both parties wish to continue | Extended one additional year; no new probation applied | If either party does not wish to continue, contract lapses (offboarding owned elsewhere — see `OD-HR-03`) | This module (CRR §9) |
| `RULE-HR-07` | Contract is non-permanent and approaching its 1-year or 2-year mark | Manager reminded once before each mark | No reminder once contract is `permanent` | This module (CRR §9; PDD §5.6) |
| `RULE-HR-08` | Scanned signed contract file received | Stored in S3 (EU region only) | No non-EU storage path permitted | This module / shared storage infrastructure (CRR §9; PDD §5.7) |
| `RULE-HR-09` | Worker submits a payslip request | Request recorded; routed to responsible manager; manager fulfils by manual email | Worker never receives payslip content through the system itself | This module (CRR §23) |
| `RULE-HR-10` | Any payroll-adjacent computation is contemplated | Rejected — this module performs no salary/hourly/overtime/bonus/deduction calculation and no finance export | None — confirmed non-goal | This module (CRR §23, Explicit Non-Goals) |
| `RULE-HR-11` | Contract-scan file is uploaded | Uses the same upload mechanism class as any other worker document | General document-type expiry tracking (e.g., work permits) is out of scope here | This module uses mechanism; Documents (conceptual) owns general capability (CRR §9 line 132; CRR §7) |
| `RULE-HR-12` | IBAN, tax ID, payslip-request record, or wage record is stored | Classified Tier 3 (6-year retention, automatic deletion) | Deletion execution owned by Retention module | This module classifies; Retention deletes (CRR §25) |

## Ownership and Boundaries

**Module owner:** `unassigned` — accountable owner assignment is reserved human authority (SYNC-001, blocked: no `CODEOWNERS`, empty `backend/package.json` author). Code-level home is the `backend-hr` module (`backend/src/modules/hr`), currently a stub whose service methods throw `NotImplementedError` (`backend/src/modules/hr/service.ts:5-24`; `.claude/knowledge/DEPENDENCY_GRAPH.yaml:34-36`). This spec is the proposed docs↔code mapping for `backend-hr`; it is not asserted as final — see Proposed Knowledge Deltas and `OD-HR-01`.

**Owned state:**

- The contract record: generated PDF reference, scanned signed-contract file reference (S3 EU), status (`pending` / `signed`-`active` / `extended` / `permanent`), and the manager-confirmation event (who, when).
- Contract lifecycle timers: 1-year expiry, +1-year extension expiry, and the flag that a contract is now permanent (no further reminders).
- Contract expiry-reminder scheduling state (before-1-year, before-2-year, sent/not-sent).
- Payslip requests: requester, timestamp, and fulfilment status (fulfilled-by-manager-email / outstanding).
- Retention-tier classification metadata for the payroll/tax-adjacent fields it touches (IBAN, tax ID, payslip-request records, wage records).

**Consumed state (owned elsewhere, referenced, never redefined):** Personalfragebogen-sourced personal data used to pre-fill the contract PDF (Onboarding); the employee/worker identity and account record that activation ultimately gates (employee-management / Authentication-User Management); general document storage/expiry mechanics for non-contract document types (conceptual Documents capability); the payslip-request-processor and Admin visibility audience for Konfession (Compliance/employee-management-governed policy, this module does not define it); role/scope for `hr:read`/`hr:write` (Authentication/Authorization).

**Permitted writes:** only to this module's owned state above, and only through its own interfaces. This module never writes the employee/employment record, the account/activation flag itself (it exposes the gating *fact*; the actual activation write belongs to Onboarding/employee-management), Personalfragebogen data, or general (non-contract) document records.

**Boundary/non-responsibilities:** this module does **not** perform Onboarding orchestration, chatbot document collection, hire-approval pool/claim, general document-type management or expiry tracking beyond the contract scan, employee lifecycle-status writes, RBAC/scope enforcement itself, audit-log infrastructure, or retention-deletion execution. It holds only the contract-lifecycle and payslip-request state described above and the read/write surface other modules consume. The conceptual "Contracts" and "Payslips" module names used elsewhere in `docs/03-modules/` are **not** separate code modules from `backend-hr` — see `OD-HR-01`.

## Interfaces and Contracts

For each API, command, query, event, job, or UI contract:

> The authoritative documents describe a modular monolith with synchronous service calls (PDD §5.1-§5.2) but **do not enumerate a formal interface schema** for this module. Current-state code exposes the endpoints below (verified in `backend/src/modules/hr/routes.ts`), which are stubs (`NotImplementedError`, HTTP 501) and whose request/response shapes predate the confirmed contract/payslip model (see `OD-HR-02`). Target-state contracts implied by confirmed behaviour are also listed. Direction is relative to this module.

| Contract ID/version | Direction | Input | Output | Errors | Auth | Compatibility |
|---|---|---|---|---|---|---|
| `IF-HR-GenerateContract / v0` | Inbound (command; target-state, no current route) | Worker id (Personalfragebogen data read from Onboarding/employee-management) | Contract record in `pending` status + generated PDF reference | Missing Personalfragebogen data `[OPEN]` (`OD-HR-02`) | Manager/Admin (candidate — `hr:write`) | New — not yet implemented |
| `IF-HR-ListContracts / v0 (current-state stub)` | Inbound (query) | Query filters (shape unspecified in code) | 501 Not Implemented today; target: contract records | None implemented; target errors `[OPEN]` | `hr:read` (ADMIN, MANAGER only) | Existing route, stub implementation (`backend/src/modules/hr/routes.ts:10-12`) |
| `IF-HR-CreateContract / v0 (current-state stub)` | Inbound (command) | Current code shape: `worker_id, template_id, position, salary_amount, start_date, end_date?` (`types.ts:1-8`) — does **not** match the confirmed generate→scan-upload→manager-confirm model (`OD-HR-02`) | 501 Not Implemented today | None implemented | `hr:write` (ADMIN, MANAGER only) | Existing route, stub implementation; **request shape requires redesign** (`OD-HR-02`) |
| `IF-HR-UploadSignedContract / v0` | Inbound (command; target-state) | Worker id, scanned/photographed file, manager identity | Contract file stored (S3 EU); status still `pending` until confirmed | Missing/unreadable file → manual re-upload (CRR §9) | Manager, Admin | New — current `uploadDocument` stub is the generic mechanism candidate (`backend/src/modules/hr/controller.ts:57-68`) |
| `IF-HR-ConfirmContractSigned / v0` | Inbound (command; target-state, no current route) | Worker id, confirming manager identity | Contract status → `signed`/`active`; 1-year clock starts; account-activation gating fact flips to satisfied | Confirmation without an uploaded file → rejected (CRR §9 safeguard) | Manager, Admin | New — not yet implemented |
| `IF-HR-GetContractStatus / v0` | Inbound (query; target-state, no current route) | Worker id | Contract status incl. "contract pending signature" visible state, expiry dates | Not found; scope denied | Manager/Regional Manager (their scope), Admin, Onboarding/employee-management (internal read) | New — not yet implemented |
| `IF-HR-UploadDocument / v0 (current-state stub)` | Inbound (command) | `worker_id` (path param); file — current code passes an empty `Buffer.alloc(0)` placeholder, not the actual uploaded file (`controller.ts:59`) | 501 Not Implemented today; target: stored document reference (contract scan is one document type among others per CRR §9's "mechanically treated like any other document upload") | None implemented; target errors `[OPEN]` | `hr:write` (ADMIN, MANAGER only) | Existing route, stub implementation; **current controller does not wire the actual file body** — flagged (`OD-HR-06`) |
| `IF-HR-RequestPayslip / v0` | Inbound (command; target-state, no current route) | Worker id | Payslip-request record (outstanding, routed to manager) | None specified | Worker (self), and readable by Manager/Admin | New — not yet implemented |
| `IF-HR-ListPayroll / v0 (current-state stub)` | Inbound (query) | Query filters (shape unspecified) | 501 Not Implemented today; **no confirmed "payroll listing" capability exists in CRR/PDD — only payslip *requests*** (`OD-HR-02`) | None implemented | `hr:read` (ADMIN, MANAGER only) | Existing route; **scope mismatch against confirmed requirements** (`OD-HR-02`) |
| `IF-HR-CreatePayroll / v0 (current-state stub)` | Inbound (command) | Current code shape: `worker_id, pay_period_start, pay_period_end, gross_salary` (`types.ts:10-15`) — implies payroll computation, which is a confirmed non-goal (CRR §23) | 501 Not Implemented today | None implemented | `hr:write` (ADMIN, MANAGER only) | Existing route; **directly conflicts with the zero-payroll-math non-goal** (`OD-HR-02`, high-impact) |
| `IF-HR-FulfilPayslipRequest / v0` | Inbound (command; target-state, no current route) | Payslip-request id, manager action (marks emailed) | Request status → fulfilled | Request not found | Manager, Admin | New — not yet implemented |
| `IF-HR-ContractExpiryReminder / v0` | Outbound (scheduled job → Notifications) | Contract nearing 1-year or 2-year mark | Reminder notification to responsible manager | Contract already permanent → no reminder sent | Internal (scheduled job) | New — target-state (PDD §5.6) |

## Events

> No event bus, message broker, or publish/subscribe mechanism exists in the repository (`.claude/knowledge/DEPENDENCY_GRAPH.yaml:409-416`; `MODULE_REGISTRY.yaml` records `published_events: none-observed` / `consumed_events: none-observed` for `backend-hr`). The following are business-level domain events implied by owned state changes; concrete event contract/transport is an open decision (`OD-HR-04`).

| Event ID/version | Publisher | Trigger | Payload source | Consumers | Delivery/idempotency |
|---|---|---|---|---|---|
| `EVT-HR-ContractGenerated / v0` | backend-hr | Contract PDF generated (`pending`) | Worker id, contract id | Onboarding, Audit | `[OPEN]` (`OD-HR-04`) |
| `EVT-HR-ContractSigned / v0` | backend-hr | Manager confirms "signed & valid" | Worker id, contract id, confirming manager | Onboarding, employee-management (account activation gate), Notifications, Audit | `[OPEN]` |
| `EVT-HR-ContractExtended / v0` | backend-hr | Both parties continue at 1-year mark | Worker id, contract id, new expiry | Notifications, Audit | `[OPEN]` |
| `EVT-HR-ContractMadePermanent / v0` | backend-hr | 2 years reached, offer accepted | Worker id, contract id | Notifications, Audit | `[OPEN]` |
| `EVT-HR-ContractExpiryReminderDue / v0` | backend-hr | Scheduled job hits 1-year or 2-year pre-mark | Worker id, manager id, contract id | Notifications, Audit | `[OPEN]` |
| `EVT-HR-PayslipRequested / v0` | backend-hr | Worker requests a payslip | Worker id, request id | Notifications (manager), Audit | `[OPEN]` |
| `EVT-HR-PayslipFulfilled / v0` | backend-hr | Manager marks request emailed | Request id, manager id | Audit | `[OPEN]` |

**Consumed events** (contract `[OPEN]`, `OD-HR-04`): Onboarding — Personalfragebogen completion signal to trigger contract generation (CRR §6, §9); employee-management/Onboarding — worker identity/account context needed to gate activation (CRR §9). No events are currently consumed in code (`published_events: none-observed`, `consumed_events: none-observed` for `backend-hr`, `.claude/knowledge/MODULE_REGISTRY.yaml:148-149`).

## Dependencies

| Dependency/edge | Reason | Contract | Compatibility | Failure behavior |
|---|---|---|---|---|
| Onboarding | Supplies Personalfragebogen data for PDF pre-fill; signals application → familiarization → contract sequencing | `IF-HR-GenerateContract` (candidate) | conditional (schema `[OPEN]`, `OD-HR-04`) | No source data → contract cannot be generated |
| Employee-management (`docs/03-modules/employee-management/MODULE_SPEC.md`, `backend-hr` docs↔code overlap) | Consumes this module's contract-signed gating fact to permit account activation; SPEC-EMP-001 lists "Contract, storage... lifecycle" as consumed/referenced state it does not own | `IF-HR-GetContractStatus` (candidate) | conditional | No signed contract → employee cannot activate (CRR §9) |
| Documents (conceptual capability, CRR §4/§7; no code module or frozen spec exists) | Contract-scan upload rides the same mechanism as general document upload | shared upload mechanism (candidate, unified with `IF-HR-UploadDocument`) | conditional — no frozen contract exists to compare against | Upload mechanism unavailable → scan cannot be attached |
| Authentication / Authorization (`auth-middleware`, `permissions-middleware`) | `authMiddleware` + `requirePermission('hr:read'/'hr:write')` gate every route | `auth-middleware`, `permissions-middleware` (reused) | compatible (reuse) | No auth/permission → all `/hr` routes return 401/403 |
| `base-service` (Prisma access + audit logging) | `HrService extends BaseService` for shared Prisma client and audit hooks | `base-service` (reused) | compatible (reuse) | Standard platform failure modes |
| Notifications | Delivery of expiry-reminder and payslip-request notifications to managers | `notification-service` (candidate; not yet wired — `backend-hr` has zero outbound edges today) | conditional | Reminder/notification undelivered; contract/payslip state unaffected |
| Retention | Executes automatic Tier 3 (6-year) deletion of classified payroll/tax-adjacent fields | classification metadata (this module) | conditional | Fields not deleted on schedule (compliance risk) |
| Compliance / employee-management (Konfession policy) | Defines the "payslip-request processor" audience this module's fulfilment role participates in | referenced (policy owned elsewhere) | conditional | Special-category visibility audience incomplete without that definition |
| `mobile-worker` (Employee App) | Only discovered client consumer of `/hr` (`edge-mobile-worker-hr`) | consumes-api (observed) | unknown (`.claude/knowledge/DEPENDENCY_GRAPH.yaml:276`) | No manager-facing (`frontend-web`) consumer edge is recorded even though CRR §9/PDD §7.7/§8.1 describe manager actions (uploading scan, marking signed, emailing payslips) — see `OD-HR-05` |
| Platform/infrastructure | PostgreSQL system of record, Express/TS monolith, immutable audit log, Winston, AWS, S3 (EU) object storage | shared infrastructure (`base-service`, `prisma-schema`) | compatible (reuse) | Standard platform failure modes |

## State and Lifecycle

**States (contract-level, owned here):**

- **(none) → Pending** — contract PDF generated from Personalfragebogen data; awaiting print, hand-signature, scan upload, and manager confirmation (CRR §9).
- **Pending (visible "contract pending signature")** — file may or may not yet be uploaded; account activation blocked throughout (CRR §9 safeguard).
- **Signed / Active** — manager has uploaded the scan and confirmed "signed contract received & valid"; 1-year expiry clock and reminder schedule start; this is what unblocks account activation (CRR §9).
- **Extended** — at the 1-year mark, both parties continue; +1 year added; no new probation (CRR §9).
- **Permanent (open-ended)** — after 2 years of successful employment; no further expiry reminders (CRR §9).

**States (payslip-request-level, owned here):**

- **Requested** — worker submits a request.
- **Fulfilled** — manager marks the request as emailed to the worker.

**Transitions (each arises from a confirmed event; audit-logging expectation per Constitution §11, mirrored from `RULE-EMP-11`-style practice — concrete implementation `[OPEN]`, `OD-HR-04`):**

- `(none) → Pending` — contract PDF generated (triggered by Onboarding completion signal, `[OPEN]` transport, `OD-HR-04`).
- `Pending → Signed/Active` — manager uploads scan + confirms "signed & valid"; system does not verify the signature itself (CRR §9).
- `Signed/Active → Extended` — both parties agree to continue at the 1-year mark; **the mechanism for capturing "both parties agree" is unspecified (`OD-HR-07`)**.
- `Extended → Permanent` — after 2 years of successful employment, permanent contract offered; **the trigger/decision mechanism is unspecified (`OD-HR-07`)**.
- `Requested → Fulfilled` (payslip) — manager marks the request emailed.

**Invariants:** no contract may reach `Signed/Active` without both an uploaded file and an explicit manager confirmation action (CRR §9 safeguard); no reminder is sent once a contract is `Permanent`; the system never writes a payroll computation result anywhere in this state (CRR §23); a worker-facing payslip-content read path must never exist (CRR §23).

**Concurrency:** not addressed in the authoritative documents for this module specifically; PDD §7.2 describes an atomicity pattern (single transaction) for a different module (Calendar/sick-vacation) that may be an analogous concern here but is not confirmed as applying to contract confirmation — labelled unknown (Constitution §6, `OD-HR-08`).

**Retention/migration:** payroll/tax-adjacent fields (IBAN, tax ID, payslip-request records, wage records) are Tier 3, retained 6 years then automatically deleted by Retention (CRR §25). No prior `Contract`/`Payroll`/`Payslip` data exists in the current schema to migrate — this is entirely net-new capability, built pre-launch with no production data (CRR §34; PDD §10).

## Failure, Security, Privacy, and Performance

**Failure modes/recovery:**

- Contract confirmation attempted without an uploaded file → rejected; account stays un-activatable (CRR §9 safeguard).
- Uploaded scan is bad/blurry/unreadable → manual re-upload required; no automated quality check exists (PDD §7.7 failure modes).
- Manager attempts to mark signed without having actually reviewed the paper contract → the system cannot detect this; it is an accepted trust boundary, not a failure mode the system guards against (CRR §9; PDD §7.7 trust boundary).
- Payslip request submitted but manager never fulfils it → no confirmed escalation/reminder behaviour exists for this case — labelled unknown (`OD-HR-09`).
- Current-state: every route returns HTTP 501 (`NotImplementedError`) because no business logic exists yet (`backend/src/modules/hr/service.ts:5-24`).

**Trust boundaries/authorization:** the system does **not** capture, verify, or auto-detect the handwritten signature — it records only the manager's confirmation and the stored evidence file (CRR §9; PDD §7.7 trust boundary, Constitution §11 applies: this is the single most important trust-boundary statement for this module and must not be silently strengthened or weakened by implementation). Deny-by-default authorization on role: current code grants `hr:read`/`hr:write` only to `ADMIN` and `MANAGER` roles; `CHECKER` and `WORKER` hold no `hr:*` permission at all (`backend/src/config/constants.ts:88-129`). This means a worker cannot, under current-state RBAC, even read their own contract status or submit a payslip request through the `hr:*`-gated routes — **this is a gap against confirmed behaviour** (CRR §9's implicit need for worker-side contract visibility during signing, and CRR §23's explicit "worker can REQUEST a payslip") and is recorded as `OD-HR-10`, not silently resolved.

Permission matrix (against the reused five-role RBAC model; deny-by-default; current-state code only distinguishes `ADMIN`/`MANAGER` vs. others for `hr:*` — Regional Manager scope narrowing within `MANAGER`/`hr:*` is not separately modeled in code today):

| Capability | Staff (Worker) | Checker | Hotel Manager | Regional Manager | Admin |
|---|---|---|---|---|---|
| View own contract status ("pending signature" / signed / expiry) | `[OPEN]` — no `hr:*` permission granted today (`OD-HR-10`) | — | ✅ (their hotel's workers) | ✅ (their group) | ✅ |
| Upload scanned signed contract | — (CRR §9: manager uploads) | — | ✅ | ✅ | ✅ |
| Confirm "signed contract received & valid" | — | — | ✅ | ✅ | ✅ |
| Receive expiry reminders (1yr / 2yr) | — | — | ✅ (responsible manager) | ✅ | ✅ |
| Request a payslip | `[OPEN]` — no `hr:*` permission granted today (`OD-HR-10`); CRR §23 confirms worker CAN request | — | — | — | — |
| Fulfil (email) a payslip request | — | — | ✅ | ✅ | ✅ |
| View/list contracts, payroll records (current-state routes) | — | — | ✅ (`hr:read`) | ✅ (`hr:read`) | ✅ |

**Data classification/retention:** Germany-only; scanned contracts and any photo evidence stored in EU/EEA S3 — no data leaves the EU/EEA (CRR §9; PDD §5.7). Retention tiers touched by this module: Tier 3 — payroll/tax-adjacent fields (IBAN, tax ID, payslip-request records, wage records) — 6 years, automatic deletion (CRR §25). Contract documents themselves are not explicitly assigned a retention tier in CRR/PDD; treating them as Tier 2 (general personal/profile data, 5 years) or Tier 3 is unresolved — see `OD-HR-11`. Special-category adjacency: Konfession visibility for the "payslip-request processor" role is governed by employee-management/Compliance policy, not defined here (CRR §27; SPEC-EMP-001 `RULE-EMP-09`) — this module must not independently redefine that audience.

**Performance budgets/workload:** no explicit SLO is defined in the authoritative documents for contract generation, upload, or payslip-request handling. Design intent: contract-expiry reminder and payslip-request volume scale with employee headcount, not with request rate (low-frequency, per-employee-per-year events). Concrete budgets are deferred to implementation and are not asserted here (labelled unknown, Constitution §6).

**Observability/audit:** every contract-status transition, manager confirmation, and payslip-request/fulfilment action should be logged immutably via the existing audit framework, consistent with the platform-wide "every important action is logged" rule (CRR §30) — no HR-specific audit behaviour beyond that is confirmed, and current-state code has no audit calls implemented (`backend/src/modules/hr/service.ts` throws before any logic executes). No admin-facing log-viewer screen exists platform-wide (CRR §30).

## Rollout and Compatibility

This module is entirely net-new capability within the marketplace → Workforce Operations Platform forward refactor (CRR §34 lines 401, 409; PDD Phase 3, Milestone M4). It is pre-launch with no production employee, contract, or payslip data, so no dual-run migration is needed (PDD §10). Sequence: this module's capabilities are built in PDD Phase 3 ("Compliance & onboarding"), depending on Phase 1 foundation realignment (Regional Manager role/scope, response-envelope centralization) already assumed complete for RBAC checks to function (PDD §10 Phase 1, Phase 3; roadmap M1, M4).

**Feature flags:** each new capability (contract generation, manager-confirmation flow, expiry reminders, payslip-request flow) sits behind the existing `FEATURE_*` env-flag convention so partial deploys are safe (PDD §10).

**Backward compatibility:** the current-state `CreateContractRequest`/`CreatePayrollRequest` types and the `/contracts`, `/payroll` routes do not match the confirmed target model (see `OD-HR-02`) and carry no production data or external contract to preserve — replacing them is not a breaking change against any live consumer (`mobile-worker` currently receives only 501 responses from these routes).

**Rollback:** because this is additive, pre-launch work, rollback is disabling the relevant feature flag and redeploying the prior (stub) build (PDD §10).

**Removal criteria:** not applicable — contract lifecycle and payslip-request handling are confirmed, permanently-owned legal/compliance capabilities (CRR §9, §23).

## Validation Plan

| Criterion | Test level/check | Environment/data | Evidence required |
|---|---|---|---|
| Contract PDF generated in `pending` status from confirmed field set (`REQ-HR-001`) | Unit + fixture | Seed Personalfragebogen data | Generated PDF reference + field-presence check |
| No e-signature/QES code path exists anywhere in the contract flow (`REQ-HR-002`) | Static/code-presence check | Codebase scan | Absence of QES/Skribble/signature-capture calls |
| Status flips to signed/active only via manager upload + explicit confirmation; no auto-verification (`REQ-HR-003`) | Unit + integration | Manager-role fixture | Transition trace showing manager attribution; absence of signature-detection call |
| Activation blocked without uploaded+confirmed contract; "pending signature" status visible (`REQ-HR-004`) | Integration | Unsigned / signed contract fixtures | Blocked-activation assertion; visible status field in query response |
| 1-year clock starts exactly at confirmation event (`REQ-HR-005`) | Unit | Confirmation timestamp fixture | Expiry date derivation check |
| Only confirmed lifecycle states reachable; no additional states (`REQ-HR-006`) | Unit (state machine) | Full lifecycle fixture | Transition-table coverage incl. negative cases |
| Reminder fires once before 1yr and once before 2yr; none once permanent (`REQ-HR-007`) | Unit (scheduled job) | Contract-age fixtures at each boundary | Reminder-fired/not-fired assertions per state |
| Scanned contract stored only in EU S3 region (`REQ-HR-008`) | Integration/config check | Storage config | Bucket-region assertion |
| Payslip request recorded; no worker-facing payslip-content read path exists (`REQ-HR-009`) | Integration + route-absence check | Payslip-request fixture | Request record; absence of worker-facing content-return route |
| No payroll computation logic exists anywhere in the module (`REQ-HR-010`) | Static/code-presence check | Codebase scan | Absence of salary/overtime/bonus/deduction calculation code and finance-export route |
| Contract-scan upload uses the same mechanism class as other document uploads (`REQ-HR-011`) | Integration | Multi-document-type fixture | Shared-mechanism evidence |
| IBAN/tax ID/payslip-request/wage-record fields carry Tier 3 classification (`REQ-HR-012`) | Unit (classification) | Field catalog | Tier-mapping table verified |

## Risks, Assumptions, and Open Decisions

| ID | Type | Description | Evidence/impact | Owner | Resolution/status |
|---|---|---|---|---|---|
| `OD-HR-01` | Open decision | Docs↔docs module-boundary mismatch: `docs/03-modules/employee-management/MODULE_SPEC.md` treats "Contracts" and "Payslips" as separate conceptual modules out of its own scope, and `docs/03-modules/contracts/`, `docs/03-modules/payslips/`, `docs/03-modules/documents/` exist as separate near-empty directories — but there is exactly one physical code module, `backend-hr`, implementing this combined surface, documented here at `docs/03-modules/hr/`. | No ratified separate code module exists for "Contracts" or "Payslips"; this spec documents the actual code boundary. Renaming/merging the docs directories is not authorized here. | Human (SYNC-001-adjacent) | Open — not resolved by this spec; recorded for human synchronization decision, not silently resolved by renaming or merging directories |
| `OD-HR-02` | Open decision | Current-state code types/routes (`CreateContractRequest` implies template/salary fields; `CreatePayrollRequest` implies gross-salary/pay-period computation) do not match the confirmed target model (generate→scan-upload→manager-confirm contract flow; payslip *request*-only, zero payroll math). | High impact: `IF-HR-CreatePayroll`/`IF-HR-ListPayroll` as currently typed directly conflict with the confirmed zero-payroll-math non-goal (CRR §23) if implemented as-is. | Architecture/Human | Open — blocks any implementation from the current stub types without a redesign pass |
| `OD-HR-03` | Open decision | Contract lapse / non-renewal / offboarding workflow when a party does not wish to continue at the 1-year or 2-year mark is undefined in CRR/PDD. | Affects `RULE-HR-06` exception handling and any downstream employee-lifecycle deactivation trigger (mirrors SPEC-EMP-001 `OD-EMP-04`). | Product/Human | Open — blocks full acceptance of the extension/permanent transitions' negative path |
| `OD-HR-04` | Open decision | No formal domain-event/interface contract or transport exists (no event bus in the repository). Interfaces and Events sections here are candidate-level only. | Affects Interfaces and Contracts, Events sections; mirrors SPEC-EMP-001 `OD-EMP-09`. | Architecture/Human | Open — affects every cross-module signal this module needs to send/receive |
| `OD-HR-05` | Open decision | No `frontend-web` (manager-facing web app) or `mobile-checker` consumer edge to `backend-hr` is recorded in `DEPENDENCY_GRAPH.yaml`, even though CRR §9/PDD §7.7/§8.1 describe manager actions (uploading scans, confirming signatures, sending payslip emails) that a manager-facing client would need to perform. Only `mobile-worker` consumes `/hr` today. | Gap between confirmed manager-driven behaviour and discovered client integration; manager-side flows may not yet exist in any client codebase. | Architecture/Human | Open — flagged as a client-integration gap, not resolved by this spec |
| `OD-HR-06` | Open decision | The current `uploadDocument` controller method hardcodes `Buffer.alloc(0)` instead of the actual request body/file (`backend/src/modules/hr/controller.ts:59`), meaning even if the service were implemented, no real file would ever be persisted. | Current-state code defect noted for downstream implementation/architecture review; not a requirements gap. | Architecture/Human | Open — flagged as a repo fact, not remediated by this documentation pass |
| `OD-HR-07` | Open decision | The mechanism for capturing "both parties wish to continue" (at the 1-year mark) and "employee offered permanent contract" (at 2 years) — e.g., a manager action, a worker confirmation, or both — is not specified in CRR/PDD. | Affects `RULE-HR-06` and the `Signed/Active → Extended → Permanent` transitions in State and Lifecycle. | Product/Human | Open — blocks precise transition-trigger acceptance criteria |
| `OD-HR-08` | Open decision | Concurrency behavior for contract confirmation (e.g., two managers acting on the same worker's contract simultaneously) is not addressed in CRR/PDD for this module specifically. | Low-probability but unaddressed race condition; no confirmed mitigation exists to cite (unlike the broadcast-slot-lock pattern documented for Job Dispatch). | Architecture/Human | Open — labelled unknown per Constitution §6, not assumed |
| `OD-HR-09` | Open decision | No escalation/reminder behaviour is confirmed for a payslip request that a manager never fulfils. | Affects Failure modes/recovery completeness for `REQ-HR-009`. | Product/Human | Open |
| `OD-HR-10` | Open decision | Current-state RBAC (`ROLE_PERMISSIONS` in `backend/src/config/constants.ts`) grants `hr:read`/`hr:write` only to `ADMIN`/`MANAGER`; `WORKER` and `CHECKER` hold no `hr:*` permission. This appears to conflict with CRR §23's explicit "worker can REQUEST a payslip" and the general need for a worker to see their own "contract pending signature" status. | Permission matrix above marks the worker-facing rows `[OPEN]`; a worker cannot exercise `REQ-HR-009`'s confirmed capability under current-state RBAC as coded. | Architecture/Human | Open — high-impact gap between confirmed requirement and current-state authorization; not silently resolved by granting or withholding a permission here |
| `OD-HR-11` | Open decision | No CRR/PDD retention tier is explicitly assigned to the contract document/PDF/scan itself (only to IBAN/tax ID/payslip-request/wage records, Tier 3). Whether the contract document is Tier 2 (5yr) or Tier 3 (6yr) is unstated. | Affects Data classification/retention completeness. | Product/Human | Open |
| `OD-HR-12` | Assumption | Owner unassigned | No `CODEOWNERS`; empty `backend/package.json` author (SYNC-001) | Human | Open — freeze requires a named owner/approver |

## Proposed Knowledge Deltas

- **`MODULE_REGISTRY.yaml`:** on freeze, set `specification` for `backend-hr` to `SPEC-HR-001`. Do **not** flip `implementation_status` away from its verified `active-no-tests`/stub state, and do **not** change `lifecycle` from `active`, without human confirmation (SYNC-001) — this spec documents target-state behaviour for a module that is presently a stub.
- **`DEPENDENCY_GRAPH.yaml`:** propose (not apply) the candidate consumer/producer edges implied here — Onboarding → `backend-hr` (Personalfragebogen data read, contract-generation trigger), `backend-hr` → employee-management (contract-signed gating fact), `backend-hr` → Notifications (expiry reminders, payslip-request notifications), `backend-hr` → Retention (Tier 3 classification metadata) — each marked `compatibility: conditional` until interface schemas resolve (`OD-HR-04`). Flag the missing `frontend-web`/`mobile-checker` consumer edges as an open item rather than adding them speculatively (`OD-HR-05`). Do not alter the `stub_but_registered` entry for `backend-hr` without human confirmation.
- **`TERMINOLOGY.md`:** propose, on human confirmation, canonical terms **Contract status (pending/signed-active/extended/permanent)**, **Manager confirmation (Option A)**, **Familiarization period**, **Payslip request**, **Payslip-request processor**; note that the documentation module name `hr` (this path) must not be silently merged into or confused with the near-empty `contracts/`, `payslips/`, or `documents/` directories, nor with `employee-management` — see `OD-HR-01`.
- **`DECISION_INDEX.md`:** register the open decisions `OD-HR-01`, `OD-HR-02`, `OD-HR-03`, `OD-HR-04`, `OD-HR-05`, `OD-HR-07`, `OD-HR-08`, `OD-HR-09`, `OD-HR-10`, `OD-HR-11` as pending decision records.
- **`SYNC_STATE.yaml`:** record this spec as `REVIEW` pending G4 independent reviews and G2 human approval; owner assignment remains blocked (SYNC-001); flag `OD-HR-01` and `OD-HR-10` as requiring cross-spec coordination with SPEC-EMP-001.

## Review and Change Log

| Version | Date | Change | Findings resolved | Approver |
|---|---|---|---|---|
| 0.1.0 | 2026-07-08 | Initial canonical-template authoring from CRR/PDD for the `backend-hr` code module (contracts lifecycle, payroll/payslip-request stub, contract-scan document upload). No prior specification exists at this path. Freeze candidate submitted for G4 independent review (architecture, dependency, consistency) and G2 human approval. Author cannot self-approve blocking findings (Constitution §12); **FROZEN status is withheld pending human approval and disposition of open decisions `OD-HR-01..12`, most notably the docs↔docs module-boundary question (`OD-HR-01`) and the current-state RBAC/requirement conflict (`OD-HR-10`).** | — (none dispositioned yet) | — (pending) |
