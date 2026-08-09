# Module Specification: `backend-document-templates`

## Document Control

| Field | Value |
|---|---|
| Spec ID / version | `SPEC-DOCUMENT-TEMPLATES-001 / 0.1.0` |
| Status | `DRAFT` — **NOT FROZEN**. G2 Specification Freeze is reserved human authority (Constitution §12) and has not been sought or granted. This document is written *after* implementation, describing what was built, not a pre-implementation specification frozen ahead of code. |
| Owner | `unassigned` — reserved human authority (`SYNC-001`; no `CODEOWNERS`, empty `backend/package.json` author, consistent with every other module in this repository). |
| Authors / reviewers | Author: implementing session (2026-08-09). No independent G4 review round (architecture/dependency/consistency/security/performance) has been run against this document. |
| Repository revision | Branch `feat/document-templates`, based on `main` at `27da2da`. |
| Approved by / at | — (G2 freeze requires a named human approver; not yet approved) |
| Supersedes | None — no prior specification exists at this path. |

> **Provenance note — read this before treating any requirement below as citable authority.**
>
> Unlike every other module specification in `docs/03-modules/`, **this module's requirements are NOT derived from `docs/00-foundations/CONFIRMED_REQUIREMENTS_REGISTER.md` (CRR) or `docs/00-foundations/PIVOT_DESIGN_DOCUMENT.md` (PDD)**. Neither authoritative document mentions document templates, in-app fillable forms, or signature capture as a capability. CRR §9 in fact explicitly *excludes* the adjacent concepts for the contract use-case ("no signature capture, no signature authenticity verification, no QES/e-signature provider integration"), and `docs/03-modules/documents/MODULE_SPEC.md` carries those same exclusions forward as its own Non-goals.
>
> This capability was **directed in-session by the project owner** (2026-08-09), who requested "in app fillable form templates" plus "digital signature," and supplied a real German employment contract (`Arbeitsvertrag`) as the reference for the document *shape* the model must be able to express. Every `REQ-DOCTPL-*` below is therefore recorded as a **first-party product decision made in that session**, cited to the session decision itself — never dressed up as a pre-existing CRR/PDD citation it does not have.
>
> **Relationship to CRR §9's signature exclusions (important, not glossed over):** what this module implements is *attestation capture* — a drawn signature image plus an audit trail (signer identity from the authenticated session, server timestamp, request IP, and a SHA-256 hash of the exact rendered section content at signing time). It is explicitly **not** a qualified electronic signature, not eIDAS/PAdES-conformant, and performs no cryptographic signing or signature-authenticity verification. This is the same trust level `backend-hr`'s existing `confirmContractSigned()` already operates at (a manager attesting "this was signed," recorded in `AuditLog`), extended to capture a drawn mark rather than only a boolean. The project owner was asked directly whether attestation-level capture was acceptable versus a legally-binding e-signature integration, and confirmed attestation is what is wanted for now. CRR §9's QES exclusion is therefore respected, not contradicted — but a future reviewer should treat the *product* boundary here as owner-set, not CRR-derived.
>
> **Personal-data constraint (permanent).** The reference `Arbeitsvertrag` is a real employee's contract. No real personal data from it — name, address, date of birth, pension/RV-Nummer, or any filled-in value — appears anywhere in this module's code, tests, fixtures, documentation, or commit history. Only *structural* field names (e.g. `employee_name` as a `field_key`) model its shape. The source PDF itself is untracked.

## Purpose and Scope

**Outcome:** Establish Document Templates as the module owning **admin-authored reusable document templates**, **per-worker filled instances of those templates**, **attestation-level signature capture**, and **rendering a completed instance to a final PDF** — so that a document like an employment contract, an appendix, or a policy acknowledgement can be defined once by an admin through the UI (no code change, no redeploy) and then filled and signed in-app by the people it concerns.

**In scope:**

- **Template authoring:** an admin composes a template from ordered `DocumentTemplateSection`s. Each section carries static prose (`body_template`, with `{{field_key}}` placeholders), zero or more `DocumentTemplateField`s, and zero or more `DocumentTemplateSignatureBlock`s. Six field types: `TEXT`, `DATE`, `NUMBER`, `CHECKBOX`, `SELECT` (admin-defined option list), `INFO_BLOCK` (static text, no input).
- **Template lifecycle:** `DRAFT → PUBLISHED → ARCHIVED`. A `DRAFT` is freely editable in place. A `PUBLISHED` template is structurally immutable — any structural edit **forks** it into a new `DRAFT` (`version + 1`, `parent_template_id` set), so instances already filled against the published version stay bound to exactly the text their signers saw.
- **Instance fill:** a `DocumentInstance` is one worker's filled copy of one template *version*. Field values are upserted per field; a `shared_key` on a field propagates its value to every sibling field in the same template that declares the same `shared_key`, so a value entered once in section 1 pre-fills section 4 without re-entry.
- **Signature capture (attestation):** each `DocumentTemplateSignatureBlock` declares a `signer_role` of `SUBJECT` (the worker the document is about) or `COUNTERSIGNER` (the employer side). A signer draws a signature; the PNG is malware-scanned through the existing `hr/malware-scan.ts` hook, stored through the existing `documents/storage.ts` S3 helper, and recorded with signer id, timestamp, IP, and `content_hash_at_signing`.
- **Rendering:** an instance renders to PDF via headless Chromium (Playwright) — draft preview at any time (unsigned blocks render as empty signature lines), and a final render on `finalize()` once every signature block is signed. The final PDF is stored through the **existing** `documentService.uploadDocument()` under `DocumentCategory.GENERAL`, and referenced from `DocumentInstance.final_document_id`.

**Out of scope:** (owned elsewhere and referenced, never redefined — Constitution §6)

- **Document storage, upload mechanism, and retrieval.** Owned by `backend-documents` (`SPEC-DOCUMENTS-001`, FROZEN). This module *consumes* `generateStorageKey()`/`getStorageClient()` for signature images and `documentService.uploadDocument()`/`getDocument()` for the final PDF. It introduces no second storage mechanism, no new `DocumentCategory` value, and no parallel document table.
- **Contract lifecycle.** Owned by `backend-hr` (`ADR-012`). A template *shaped like* an employment contract is not a `Contract`: this module never writes `Contract` state, never drives contract status, and `Contract.template_id` (a pre-existing opaque string column with no CRUD behind it anywhere in the codebase) is untouched. Whether HR's contract flow should one day be re-expressed on top of this module is an open question deliberately left unanswered here (`OD-DOCTPL-01`).
- **Malware scanning implementation.** Owned by `backend-hr`'s `malware-scan.ts` seam (`ADR-044`), reused as-is including its disclosed pass-through default scanner.
- **Retention tier assignment and the deletion sweep.** Owned by `backend-retention` (sweep execution — that module remains schema-only platform-wide, so no code sweeps anything yet). Tier *mapping* itself is resolved: `DocumentInstance`/`DocumentInstanceFieldValue`/`DocumentInstanceSignature` are Tier 3 (provisional, `ADR-033`'s already-ratified split for employment-contract-adjacent documents) — see Retention/migration below and `OD-DOCTPL-04`'s updated disposition.
- **Audit-log ownership.** `AuditLog` is written through the shared `BaseService.logAudit()` helper; `backend-auth` is its authoritative owner (`ADR-016`).
- **Qualified/legally-binding electronic signature, signature-authenticity verification, timestamp authority, biometric stroke capture.** Excluded by CRR §9 and confirmed excluded by the project owner for this module — see the Provenance note.

**Non-goals:**

- A drag-and-drop visual template designer. Template authoring is structured CRUD over ordered records (`order_index` integers), explicitly not a WYSIWYG builder.
- Proxy-fill of any kind. A worker fills and signs only their own `SUBJECT` fields/blocks; an admin/manager fills and signs only `COUNTERSIGNER` blocks. Neither may act on the other's behalf, by product decision (2026-08-09).
- Conditional/branching field logic, computed fields, or a validation DSL. `DocumentTemplateField.validation` is a loose `Json?` column with no evaluator behind it yet (`OD-DOCTPL-03`).
- Multi-language templates. A template's prose is authored in whichever language the admin types; there is no translation mechanism here (the platform-wide i18n effort is separate and still unscoped).

## Requirements and Acceptance Criteria

Every requirement below is a **first-party product decision from the 2026-08-09 owner session**, not a CRR/PDD citation. All are implemented as of this document's revision unless marked otherwise.

| Requirement | Statement | Priority | Acceptance criteria | Rule IDs |
|---|---|---|---|---|
| `REQ-DOCTPL-001` | An admin can author a multi-section template with per-section prose, fields, and signature blocks, entirely through the API/UI with no code change. | MUST | A template matching the reference `Arbeitsvertrag`'s shape (5 sections, 6 signature blocks, 2 cross-section shared fields, 1 `SELECT` field) is expressible without schema or code modification. | `RULE-DOCTPL-01` |
| `REQ-DOCTPL-002` | Six field types are supported: `TEXT`, `DATE`, `NUMBER`, `CHECKBOX`, `SELECT`, `INFO_BLOCK`. | MUST | Each type round-trips author → fill → render. `SELECT` requires a non-empty `select_options` array at authoring time (enforced in the Zod schema, `types.ts`). | `RULE-DOCTPL-01` |
| `REQ-DOCTPL-003` | Publishing requires at least one section and at least one signature block. | MUST | `publishTemplate()` rejects with `ValidationError` (422) if either is absent. | `RULE-DOCTPL-02` |
| `REQ-DOCTPL-004` | Editing a `PUBLISHED` template forks it to a new `DRAFT` version rather than mutating it. | MUST | Any of `updateTemplate`/`addSection`/`updateSection`/`addField`/`updateField`/`addSignatureBlock` against a `PUBLISHED` template creates a new template row (`version + 1`, `parent_template_id` = original) with a deep copy of all sections/fields/signature blocks, inside one transaction, and applies the edit to the fork. Existing instances remain bound to the original version. | `RULE-DOCTPL-03` |
| `REQ-DOCTPL-005` | An instance may only be created from a `PUBLISHED` template. | MUST | `createInstance()` rejects a `DRAFT`/`ARCHIVED` template with `ConflictError` (409). | `RULE-DOCTPL-04` |
| `REQ-DOCTPL-006` | A worker may create/fill/sign only their own instance; a manager/RM only within their hotel-group scope; an admin unrestricted. | MUST | Enforced in the **service layer** against the loaded instance's `worker_id` (`isSelfScopedRole` / `isWorkerInGroupScope`), not only at route middleware — these routes are keyed by `instance_id`, which `checkWorkerScope()` structurally cannot read. | `RULE-DOCTPL-05` |
| `REQ-DOCTPL-007` | A `SUBJECT` signature block may be signed only by the worker the instance is about; a `COUNTERSIGNER` block only by an in-scope manager/RM or an admin. | MUST | `signBlock()` branches on the block's own `signer_role` and rejects the mismatched actor with `ForbiddenError` (403), independent of the route-level permission token. | `RULE-DOCTPL-06` |
| `REQ-DOCTPL-008` | A value entered into a field carrying a `shared_key` propagates to every other field in the same template declaring that same `shared_key`. | MUST | After `upsertFieldValues()` writes a `shared_key`-bearing field, sibling fields resolve to the same value without a second client call. | `RULE-DOCTPL-07` |
| `REQ-DOCTPL-009` | Each captured signature records signer identity (from the authenticated session, never client-supplied), server timestamp, request IP, and a SHA-256 hash of the rendered section content at signing time. | MUST | `DocumentInstanceSignature` carries all four; `content_hash_at_signing` is computed over that *section's* rendered HTML (not the whole document), so "what did they see when they signed section N" is answerable per signing event. | `RULE-DOCTPL-08` |
| `REQ-DOCTPL-010` | A signature image is malware-scanned before storage and rejected on detection. | MUST | `signBlock()` calls `getMalwareScanner().scan()` and rejects a non-clean result with `ValidationError`, before any storage write or row creation. Inherits `ADR-044`'s disclosed pass-through default scanner. | `RULE-DOCTPL-09` |
| `REQ-DOCTPL-011` | The same signature block cannot be signed twice on the same instance. | MUST | `@@unique([instance_id, signature_block_id])`; the P2002 violation surfaces as `ConflictError` (409), never a 500. | `RULE-DOCTPL-10` |
| `REQ-DOCTPL-012` | A draft PDF preview is available before all signatures are collected. | MUST | `previewInstance()` renders with `draft: true` — unsigned blocks render as an empty signature line, a `DRAFT — NOT YET SIGNED` banner is shown, and unfilled required fields render as a visually-flagged `[Label]` placeholder. | `RULE-DOCTPL-11` |
| `REQ-DOCTPL-013` | Finalizing requires every signature block on the template to be signed. | MUST | `finalize()` rejects with `ValidationError` (422) naming the count of still-unsigned blocks; on success it renders with `draft: false`, uploads through `documentService.uploadDocument()` as `GENERAL`, sets `final_document_id`, `status = COMPLETED`, `completed_at`. | `RULE-DOCTPL-12` |
| `REQ-DOCTPL-014` | Field values cannot be edited, and signatures cannot be added, on a `COMPLETED` or `VOIDED` instance. | MUST | Both `upsertFieldValues()` and `signBlock()` reject with `ConflictError` (409). | `RULE-DOCTPL-13` |
| `REQ-DOCTPL-015` | Interpolated field *values* are HTML-escaped before rendering; admin-authored `body_template` prose is not. | MUST | `escapeHtml()` is applied to every substituted value and to every label/title; `body_template` is trusted admin input by design (an admin authoring a template is already trusted to write the document's text). | `RULE-DOCTPL-14` |

## Business Rules

| Rule | Preconditions | Outcome/invariant | Exceptions/precedence | Owner/source |
|---|---|---|---|---|
| `RULE-DOCTPL-01` | A template is authored | Composed of ordered sections; each section has prose plus 0..N fields and 0..N signature blocks. `@@unique([template_id, order_index])` on sections; `@@unique([section_id, field_key])` on fields | A section with zero fields is valid (an `INFO_BLOCK`-only or signature-only appendix page) | Product decision, 2026-08-09 |
| `RULE-DOCTPL-02` | `publishTemplate()` is called | Requires status `DRAFT`, ≥1 section, ≥1 signature block across all sections | A template with sections but no signature block is rejected — a document nobody signs has no use case in this module | Product decision, 2026-08-09 |
| `RULE-DOCTPL-03` | A structural edit targets a `PUBLISHED` template | The edit is applied to a newly-created `DRAFT` fork (`version + 1`, `parent_template_id` set), never to the published row | An `ARCHIVED` template rejects all edits (`ConflictError`). A `DRAFT` is edited in place with no fork | Product decision, 2026-08-09 (chosen over in-place edit specifically so a signed instance's text can never change retroactively) |
| `RULE-DOCTPL-04` | `createInstance()` is called | Template must be `PUBLISHED` | — | Product decision, 2026-08-09 |
| `RULE-DOCTPL-05` | Any instance read/fill/finalize | Admin unrestricted; self-scoped role must match `instance.worker_id`; scoped manager role must pass `isWorkerInGroupScope()`; every other role denied | Enforcement is service-layer, deliberately mirroring the 2026-08-08 IDOR fix in `documents/service.ts#getDocument` rather than repeating the bug that fix corrected | This module; precedent `SPEC-DOCUMENTS-001` `RULE-DOC-08` |
| `RULE-DOCTPL-06` | `signBlock()` is called | The block's `signer_role` selects the eligible actor class: `SUBJECT` → the subject worker only; `COUNTERSIGNER` → admin, or in-scope manager/RM | No proxy-signing in either direction, by explicit product decision | Product decision, 2026-08-09 |
| `RULE-DOCTPL-07` | A field value is written and that field declares a `shared_key` | Every other field in the same template with the same `shared_key` receives the same value | Propagation is same-template only; `shared_key` is a plain string match, not a cross-template registry | Product decision, 2026-08-09 |
| `RULE-DOCTPL-08` | A signature is captured | `signed_by_id` derives from `req.auth` only; `signed_at` is a server timestamp; `signer_ip` from the request; `content_hash_at_signing` is SHA-256 of that section's rendered HTML | Client-supplied signer identity is never accepted, mirroring `RULE-HR-14`/`RULE-DOC-08` | This module; precedent `SPEC-HR-001` `RULE-HR-14` |
| `RULE-DOCTPL-09` | A signature image is submitted | Malware-scanned via `getMalwareScanner()`; rejected on non-clean result before storage or persistence | Inherits `ADR-044`'s disclosed pass-through default | `ADR-044` (reused mechanism) |
| `RULE-DOCTPL-10` | A signature block already signed on this instance is signed again | Rejected as `ConflictError`; DB-enforced by `@@unique([instance_id, signature_block_id])` | No "re-sign"/amend path exists (`OD-DOCTPL-02`) | Product decision, 2026-08-09 |
| `RULE-DOCTPL-11` | `previewInstance()` is called on a non-finalized instance | Renders with a draft banner; unsigned blocks show an empty signature line; unfilled required fields show a flagged placeholder | Permitted at any status a read is permitted at | Product decision, 2026-08-09 |
| `RULE-DOCTPL-12` | `finalize()` is called | Every signature block defined on the template must have a signature row; then render → upload as `GENERAL` → `COMPLETED` | Rejected on an already-`COMPLETED` or `VOIDED` instance | Product decision, 2026-08-09 |
| `RULE-DOCTPL-13` | Instance is `COMPLETED` or `VOIDED` | No field-value write, no new signature | — | Product decision, 2026-08-09 |
| `RULE-DOCTPL-14` | A section is rendered | Field *values* are HTML-escaped; the admin-authored `body_template` is interpolated as trusted markup | An admin authoring template prose is a trusted actor; a worker filling a value is not | This module |

## Ownership and Boundaries

**Module owner:** `unassigned` (reserved human authority, `SYNC-001`). Code home: `backend/src/modules/document-templates`.

**Owned state** (all net-new; `backend/prisma/schema.prisma`, migration `20260809000000_document_templates_module`):

- `DocumentTemplate` — template header, status, version, fork lineage (`parent_template_id`, self-relation).
- `DocumentTemplateSection` — ordered section with `body_template` prose.
- `DocumentTemplateField` — a field definition (`field_key`, type, required, `shared_key`, `select_options`, `validation`, `help_text`).
- `DocumentTemplateSignatureBlock` — a signature point with `signer_role`.
- `DocumentInstance` — one worker's filled copy of one template version.
- `DocumentInstanceFieldValue` — one value per (instance, field).
- `DocumentInstanceSignature` — one attestation record per (instance, signature block).

Enums: `DocumentTemplateFieldType`, `DocumentTemplateStatus`, `DocumentInstanceStatus`, `SignerRole`.

**Explicitly NOT owned:**

- `WorkerDocument` and all document storage/retrieval — `backend-documents`. This module holds a `final_document_id` *reference* (FK, `onDelete: SetNull`) and nothing more.
- `Contract` / contract lifecycle — `backend-hr` (`ADR-012`). Never written or read by this module.
- `AuditLog` — written via the shared `BaseService.logAudit()` helper; owned by `backend-auth` (`ADR-016`).
- The malware-scan mechanism — `backend-hr`'s `malware-scan.ts` seam (`ADR-044`).

**Consumed (read/called, never redefined):**

| Consumed | From | How |
|---|---|---|
| `generateStorageKey()`, `getStorageClient()` | `backend-documents` (`documents/storage.ts`) | Signature-image upload and presigned-URL resolution |
| `documentService.uploadDocument()`, `.getDocument()` | `backend-documents` | Final signed PDF storage and presigned retrieval |
| `getMalwareScanner()` | `backend-hr` (`hr/malware-scan.ts`) | Signature-image scanning |
| `isSelfScopedRole()`, `isScopedManagerRole()`, `isWorkerInGroupScope()` | `lib/scope.ts` | Service-layer authorization |
| `BaseService.logAudit()` | `lib/base-service.ts` | Audit trail for every mutating operation |
| `User` | `backend-users` | FK references only (`created_by_id`, `worker_id`, `signed_by_id`, `updated_by_id`) |

## Interfaces and Contracts

All routes are mounted at the API root (`backend/src/routes/v1/index.ts`), under `authMiddleware` plus a role gate plus a permission token. Response envelope is the platform standard `{ status, data, meta }` — except `GET .../preview`, which streams raw `application/pdf` bytes.

| Route | Method | Roles | Permission token |
|---|---|---|---|
| `/document-templates` | POST | admin | `document_templates:write` |
| `/document-templates` | GET | admin, manager, regional_manager | `document_templates:read` |
| `/document-templates/:id` | GET | admin, manager, regional_manager | `document_templates:read` |
| `/document-templates/:id` | PATCH | admin | `document_templates:write` |
| `/document-templates/:id/sections` | POST | admin | `document_templates:write` |
| `/document-templates/:id/sections/:sid` | PATCH | admin | `document_templates:write` |
| `/document-templates/:id/sections/:sid/fields` | POST | admin | `document_templates:write` |
| `/document-templates/:id/sections/:sid/fields/:fid` | PATCH | admin | `document_templates:write` |
| `/document-templates/:id/sections/:sid/signature-blocks` | POST | admin | `document_templates:write` |
| `/document-templates/:id/publish` | POST | admin | `document_templates:write` |
| `/document-templates/:id/archive` | POST | admin | `document_templates:write` |
| `/document-instances` | POST | admin, manager, RM, worker | `document_instance:write` / `:fill-own` |
| `/document-instances` | GET | admin, manager, RM, worker | `document_instance:read` / `:read-own` |
| `/document-instances/:id` | GET | admin, manager, RM, worker | `document_instance:read` / `:read-own` |
| `/document-instances/:id/fields` | PATCH | admin, manager, RM, worker | `document_instance:write` / `:fill-own` |
| `/document-instances/:id/preview` | GET | admin, manager, RM, worker | `document_instance:read` / `:read-own` |
| `/document-instances/:id/signature-blocks/:blockId/sign` | POST | admin, manager, RM, worker | `document_instance:write` / `:sign-own` |
| `/document-instances/:id/signatures` | GET | admin, manager, RM, worker | `document_instance:read` / `:read-own` |
| `/document-instances/:id/finalize` | POST | admin, manager, RM, worker | `document_instance:write` / `:fill-own` |
| `/document-instances/:id/document` | GET | admin, manager, RM, worker | `document_instance:read` / `:read-own` |

Where two tokens appear, the route uses a **role-conditional wrapper** (`requireInstanceReadAccess()`, `requireInstanceFillAccess()`, `requireInstanceSignAccess()`) — necessary because `requirePermission()`'s array form is an AND check and cannot express "token A for role X, token B for role Y". Each wrapper carries a `// @requiresPermission ...` annotation so the static D-8 permission-token-hygiene parser (`__tests__/support/route-registry.ts`) can discover its tokens; without that annotation the tokens are invisible to the hygiene test (runtime security is unaffected either way).

**New permission tokens** added to `ROLE_PERMISSIONS` (`backend/src/config/constants.ts`):

| Token | Held by |
|---|---|
| `document_templates:write` | ADMIN |
| `document_templates:read` | ADMIN, MANAGER, REGIONAL_MANAGER |
| `document_instance:write` | ADMIN, MANAGER, REGIONAL_MANAGER |
| `document_instance:read` | ADMIN, MANAGER, REGIONAL_MANAGER |
| `document_instance:fill-own` | WORKER |
| `document_instance:sign-own` | WORKER |
| `document_instance:read-own` | WORKER |

Route-level tokens gate "may this actor class reach this route at all." Per-record authorization (which worker, which signature block) is enforced in the service layer — see `RULE-DOCTPL-05` / `RULE-DOCTPL-06`.

## State and Lifecycle

**Template:** `DRAFT → PUBLISHED` (via `publish`, gated on ≥1 section + ≥1 signature block) `→ ARCHIVED` (via `archive`). A structural edit against `PUBLISHED` produces a *new* `DRAFT` row rather than a transition (`RULE-DOCTPL-03`). `ARCHIVED` is terminal.

**Instance:** `IN_PROGRESS → AWAITING_SIGNATURES` (on first signature) `→ COMPLETED` (on `finalize`). `VOIDED` exists in the enum as a terminal state; **no code path currently sets it** — there is no void/cancel operation in this version (`OD-DOCTPL-05`).

**Invariants:** a `COMPLETED`/`VOIDED` instance accepts no field writes and no new signatures; a signature block is signed at most once per instance (DB-enforced); an instance's `template_id` never changes, so its text is fixed at the version it was created against.

**Retention/migration:** the migration is purely additive (7 tables, 4 enums, one FK from `DocumentInstance` to `WorkerDocument`); it was verified byte-identical to Prisma's own `migrate diff` output, and is paired with a `down.sql` that drops all seven tables leaf-first then the four enums. No pre-existing data is touched.

**Retention tier (2026-08-10, `OD-DOCTPL-04` closed):** applying `ADR-033`'s already-ratified mapping for uploaded/employment-adjacent documents (that ADR's Decision point 1) — `DocumentInstance`, `DocumentInstanceFieldValue`, and `DocumentInstanceSignature` are **Tier 3** (6-year payroll/tax-adjacent, same statutory basis as `backend-hr`'s `Contract`), provisional pending tax-advisor sign-off exactly as every other module's `ADR-033` mapping is. `DocumentTemplate` and its section/field/signature-block children carry no tier — they are the admin-authored blueprint, not personal data. No `RetentionTier` column exists on these tables yet; the assignment is a schema comment only, matching every other module's identical convention today (`backend-retention` remains schema-only platform-wide — no sweep engine exists yet to consume a real column).

## Failure, Security, Privacy, and Performance

**Trust boundaries:** signer identity always derives from `req.auth`, never from the request body (`RULE-DOCTPL-08`). Per-record scope is enforced service-side, deliberately not left to route middleware — `checkWorkerScope()` reads `worker_id` only from `req.params`/`req.body` and these routes are keyed by `instance_id`, so relying on it would have reproduced exactly the IDOR shape fixed in `documents/service.ts` on 2026-08-08.

**Signature trust level (disclosed, not implied):** attestation only. A drawn image plus an audit trail. No cryptographic signing of the content hash, no timestamp authority, no signature-authenticity verification, no eIDAS/PAdES conformance. The UI must carry the disclosure "Recorded for audit purposes; not a qualified electronic signature." `content_hash_at_signing` proves *what content was rendered at signing time*; it does not prove *who* drew the mark beyond the authenticated session that submitted it.

**Upload policy:** signature images are constrained to `image/png`, max 10 MB, single file, memory storage — reusing the constraints the `documents` module already applies rather than declaring a second policy.

**Rendering / performance (the main operational risk in this module):** `renderInstanceToPdf()` launches a headless Chromium process per call, and both `preview` and `finalize` call it synchronously inside the request. This is a heavier per-request cost than anything else in this codebase (~hundreds of ms plus browser memory) and is **not** currently rate-limited, queued, or pooled. The browser is always closed in a `finally`. Signature images are embedded as presigned S3 URLs fetched by the browser (`waitUntil: 'networkidle'`), so a slow or unreachable S3 adds directly to request latency. Flagged as `OD-DOCTPL-06` — acceptable at the expected volume (a handful of contract signings per week), not acceptable if this ever becomes a bulk operation.

**Deployment prerequisite (2026-08-10, closed):** `playwright` is a backend dependency and requires the Chromium binary (~300 MB) to be installed in every environment that runs this code. Previously this was undone anywhere; now: `deploy.sh` runs `npx --no-install playwright install --with-deps chromium` unconditionally on every EC2 deploy (right after `prisma generate`, before the app restarts), and `.github/workflows/ci.yml`'s `ci` job installs the same (cached on `backend/package-lock.json`'s hash) before typecheck/lint/build/test. `GET /api/v1/health/ready`'s `checks.chromium` field (`backend/src/lib/health.ts`) surfaces whether the binary is actually present on a running instance — deliberately **not** part of the overall `status: ready/not_ready` verdict (a missing browser degrades this one feature, not the whole app), so it must be checked explicitly; see `docs/11-deployment/monitoring/DOCUMENT_TEMPLATES_CHROMIUM_RUNBOOK.md` for the full verification procedure, including a real render smoke-test (the executable-path check alone cannot catch a missing system library or a corrupted download).

**Data classification:** the field values a template collects are arbitrary and admin-defined — a template *can* be authored to collect special-category data (CRR §27) with no mechanism here preventing or flagging it. No special-category handling, restricted-visibility tier, or per-view audit entry is implemented for field values (`OD-DOCTPL-07`). Signature images and final PDFs inherit `backend-documents`' storage posture (S3, EU region).

## Risks, Assumptions, and Open Decisions

| ID | Statement | Impact | Disposition |
|---|---|---|---|
| `OD-DOCTPL-01` | Whether `backend-hr`'s contract flow should eventually be re-expressed on top of this module, and what happens to `Contract.template_id` (a bare unused string column) if so. | Two overlapping ways to produce a signed employment contract could coexist indefinitely. | **Open** — deliberately not decided here. Requires an ADR and product input. |
| `OD-DOCTPL-02` | No amend/re-sign/void path exists. A signature is final; a `COMPLETED` instance is immutable; `VOIDED` is unreachable. | A mistake after signing has no in-app remedy — the only recourse is a new instance. | **Open** — product decision needed. |
| `OD-DOCTPL-03` | `DocumentTemplateField.validation` is a loose `Json?` column with no evaluator behind it. Nothing enforces min/max/pattern. | Authors may set validation expecting enforcement that does not happen. | **Open** — either implement an evaluator or remove the column. |
| `OD-DOCTPL-04` | No retention tier was assigned to any of this module's seven tables. | GDPR retention sweep (`backend-retention`) will not touch these rows once it exists. | **Resolved (provisional), 2026-08-10, `ADR-033`** — `DocumentInstance`/`DocumentInstanceFieldValue`/`DocumentInstanceSignature` mapped to Tier 3; `DocumentTemplate` and its children carry no tier (no personal data). Provisional pending tax-advisor sign-off, same as every other module's `ADR-033` mapping — not itself a new open item. |
| `OD-DOCTPL-05` | `DocumentInstanceStatus.VOIDED` is defined but unreachable — no operation sets it. | Dead enum value; readers may assume a void feature exists. | **Open** — implement void, or drop the value. |
| `OD-DOCTPL-06` | PDF rendering launches a Chromium process synchronously per request, unqueued and unthrottled. | Latency and memory spikes; a plausible DoS vector if `preview` is called in a loop by an authenticated user. | **Open** — acceptable at expected volume; needs queueing/rate-limiting before any bulk use. |
| `OD-DOCTPL-07` | A template can be authored to collect special-category data (CRR §27) with no restricted-visibility or per-view audit mechanism on field values. | A compliance gap that authoring choices alone can open. | **Open** — needs either a mechanism or an authoring-time policy control. |
| `OD-DOCTPL-08` | This specification has had no independent G4 review (architecture/dependency/consistency/security/performance) and no G2 freeze. | Status is `DRAFT`; nothing here should be cited as frozen authority. | **Open** — reserved human authority. |
| `OD-DOCTPL-09` | `body_template` is rendered as trusted markup. An admin can inject arbitrary HTML/CSS into a rendered PDF. | Accepted by design (admins author document prose), but it is a real trust assumption worth stating. | **Accepted, disclosed** — revisit if template authoring is ever delegated below admin. |
| `OD-DOCTPL-10` | No automated test exercises the real Playwright renderer — `document-templates-service.test.ts` mocks `renderInstanceToPdf`/`renderSectionHtml` entirely, so a broken Chromium install, a missing system library, or a real rendering regression would never fail CI, only a real deploy. Chromium is now provisioned in CI (2026-08-10, see the Deployment prerequisite note above), which unblocks this but does not itself close it. | A silent rendering failure reaches production undetected until a real user hits Preview/Finalize. | **Open** — build an E2E smoke test (author a minimal template → create an instance → fill → sign → finalize → confirm a real PDF comes back) once Chromium is confirmed available in CI. |

## Validation Plan

| Requirement | Verification | Evidence |
|---|---|---|
| `REQ-DOCTPL-003`, `004` | Unit — publish gating; DRAFT edited in place; PUBLISHED forks with full deep copy; ARCHIVED rejects edits | `backend/src/__tests__/document-templates-service.test.ts` |
| `REQ-DOCTPL-005`, `006` | Unit — worker cannot create for another; manager out-of-scope denied; RM with no scope claim denied; admin bypass | same |
| `REQ-DOCTPL-007` | Unit — manager cannot sign a `SUBJECT` block; worker cannot sign a `COUNTERSIGNER` block; worker cannot sign another worker's `SUBJECT` block; in-scope manager can countersign | same |
| `REQ-DOCTPL-008` | Unit — value written to a `shared_key` field propagates to its sibling in another section | same |
| `REQ-DOCTPL-010`, `011` | Unit — non-clean scan rejects before persistence; P2002 surfaces as `ConflictError` | same |
| `REQ-DOCTPL-013`, `014` | Unit — finalize rejected with unsigned blocks; succeeds and uploads as `GENERAL` when complete; `COMPLETED` instance rejects further edits/signatures | same |
| Route gates, all tokens | Route-level — role/permission matrix per route, unauthenticated 401, non-actor role 403, multipart PNG-only enforcement | `backend/src/__tests__/document-templates-authz.test.ts` |
| Token hygiene (D-8) | Static — every new token is checked by ≥1 route and held by ≥1 role; wrapper annotations discovered | `permission-token-hygiene.test.ts`, `route-registry-parser.test.ts` |
| Migration correctness | Differential — hand-authored SQL verified byte-identical to `prisma migrate diff` output; up/down pairing | `scripts/migrate-harness.sh check-pairs` |

**Not yet verified (disclosed):** no test exercises the real Playwright renderer (it is mocked in the service suite) — the PDF path has no automated coverage, including the Chromium-availability failure mode. No end-to-end run has authored a full `Arbeitsvertrag`-shaped template through the UI and driven it to a signed PDF. Both are required before this module carries real documents.

## Review and Change Log

| Version | Date | Change | Author |
|---|---|---|---|
| `0.1.0` | 2026-08-09 | Initial authoring, written after implementation. Documents the as-built module: 7 models, 4 enums, 20 routes, 7 permission tokens, 41 tests. Explicitly product-owner-directed rather than CRR/PDD-derived — see the Provenance note. No G4 review, no G2 freeze. | Implementing session |
| `0.1.1` | 2026-08-10 | PR #398 review follow-up (Chromium/Playwright treated as a merge blocker, correctly): (1) `deploy.sh` and `.github/workflows/ci.yml` now provision the Chromium binary unconditionally; (2) `GET /health/ready`'s `checks.chromium` field (non-blocking) surfaces availability, with a full verification runbook at `docs/11-deployment/monitoring/DOCUMENT_TEMPLATES_CHROMIUM_RUNBOOK.md`; (3) `OD-DOCTPL-04` (retention tier) closed by applying `ADR-033`'s already-ratified mapping (Tier 3, provisional) rather than leaving it open indefinitely; (4) `OD-DOCTPL-10` added for the still-genuinely-open E2E smoke test, now unblocked but not yet built. Still `DRAFT`, still no G4/G2. | Review follow-up |
