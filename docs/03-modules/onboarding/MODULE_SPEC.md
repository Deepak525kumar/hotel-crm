# Onboarding Module — Business Specification

**Platform:** Workforce Operations Platform
**Client:** FHM Hotelservice GmbH (Frankfurt am Main, Germany) · **Vendor:** Zirove · **Market:** Germany only
**Document type:** Business specification (no implementation, no schema, no API, no code)
**Status:** Foundational module specification — derived from authoritative requirements.

---

## Source of Truth & Provenance

This specification is derived **exclusively** from the two authoritative documents:

- `CONFIRMED_REQUIREMENTS_REGISTER.md` (referenced below as **CRR §n**)
- `PIVOT_DESIGN_DOCUMENT.md` (referenced below as **PDD §n**)

No behaviour in this document is derived from any other source.

---

## 1. Module Overview

The Onboarding Module is the system responsible for **new-hire intake, document collection, legal contract execution, and hire approval decisioning**. It orchestrates the journey from first signup through manager approval to the point where the employee becomes active in Employee Management.

The module is customer-facing for workers (self-service signup, Personalfragebogen form, document upload via the Chatbot module, contract download/print for hand signing) and manager-facing for hiring decisioning (contract-scan upload and confirmation, pool/claim review mechanism, approve/reject).

Onboarding produces two critical outputs: (1) a **completed onboarding** for the employee — the Employee-Management-owned employee record (created **Inactive** at signup) is progressed through the onboarding workflow and signalled complete, so Employee Management moves it to **Under Review**; and (2) a **manager decision** (approve/reject) that Employee Management uses to transition the employee to **Active** or **Rejected** (CRR §6–§10; EM §7–§8). Onboarding does **not** create the employee record — Employee Management owns employee creation and all lifecycle transitions (EM §7, §14).

## 2. Purpose

To provide a legally compliant, documented, and auditable new-hire workflow that:

- Captures the **Personalfragebogen** (German onboarding form) during self-service signup, so workers register with German authorities during probation (CRR §6).
- Collects all **required documents and work permits** with AI-guided assistance, ensuring compliance with work-permit regulations for non-EU workers (CRR §7, §8).
- Generates the **pre-filled contract PDF** for download/print, and captures the **manager-confirmed hand-signed contract** (both parties sign on paper, in person; the scan is uploaded and the manager marks it signed & valid) to establish a legally binding fixed-term employment relationship (CRR §9; PDD §7.1).
- Implements a **pool/claim hiring-approval mechanism** so managers can review, claim, and decide on new hires without duplicate simultaneous review (CRR §10).
- Routes hiring decisions to the Employee Management module, which reflects the outcome in employee lifecycle state (CRR §10; EM Module §7).

## 3. Scope

In scope for this module:

- **Personalfragebogen (new-hire form):** a self-service digital form with all confirmed German onboarding fields (CRR §6).
- **Document collection and orchestration:** capturing required documents from workers and orchestrating the collection workflow; geofencing work-permit requirements to non-EU/EEA/Swiss workers (document validation itself is owned by the Documents module) (CRR §7).
- **Chatbot-guided document collection (consumed):** triggering the Chatbot module's (`backend-chatbot`, `SPEC-CHATBOT-001`) AI-agent conversation to query workers for missing documents, and reacting to its completion or fallback-triggered signal; the agent's execution, provider, cost controls, and fallback logic are owned and implemented by the Chatbot module, not by Onboarding (CRR §8; ADR-013).
- **Contract delivery and hand-signing capture:** generating the pre-filled contract PDF for download/print, then capturing the manager-confirmed hand-signed contract (the signed paper scan is uploaded and the manager marks it signed & valid) (CRR §9; PDD §7.1).
- **Pool/claim hiring review:** a shared inbox mechanism where managers claim applications, review materials, and approve/reject new hires (CRR §10).
- **Hire approval decisioning:** manager judgment on probation suitability and contract approval — entirely manual, no rating thresholds or automation (CRR §10).
- **Onboarding progression & completion signal:** advancing the pre-existing (Inactive) employee record through the onboarding workflow and signalling completion so Employee Management transitions it to Under Review; relaying the approval/rejection decision (CRR §10; EM §7, §14).
- **Rejection handling:** capturing and communicating rejection decisions; no re-application mechanics (CRR §10; [OPEN] rework flow — see §20 OPQ-4).

## 4. Out of Scope

**Module boundary (Onboarding / Employee Management / Compliance):**

- **Onboarding** owns **intake workflows, document collection, contract signing, and hire approval decisioning.**
- **Employee Management** owns **resulting employee records and employee state** (identity linkage, core profile fields, lifecycle status, skills).
- **Compliance** owns **policy governance**: retention policy and compliance automation, and consumes Consent for governance/audit purposes only. Consent lifecycle, records, versions, withdrawal, renewal, audit history, and validation are owned by **Consent** (`backend-consent`, target `SPEC-CONSENT-001`), a standalone bounded context (`ADR-015`); Onboarding requests consent only via `IF-CONSENT-*` (see §17.4, OPQ-3).

Owned by other modules and **referenced, never redefined** here:

- **Worker platform account and authentication** — Authentication module (CRR §2).
- **Employee record creation and employee lifecycle state transitions** — Employee Management module; Onboarding requests state changes that EM executes (CRR §6–§10; EM §7).
- **Skills, job titles, and other core employee profile fields** — Employee Management module (EM §9 Employee Profile, §10 Skills).
- **Document storage, expiry tracking, and the non-EU work-permit requirement** (including validation of work-permit documents) — Documents module (CRR §7; EM §4).
- **Contract template ownership, version control, and storage of the manager-confirmed hand-signed contract** — Contracts module (CRR §9; EM §4).
- **Storage of the scanned signed contract in S3 (EU) and the ongoing contract lifecycle (expiry/renewal/permanent) and expiry reminders** — Contracts/HR module (CRR §9; PDD §5.7, §7.7).
- **Chatbot / AI-agent execution** — conversation lifecycle, LLM provider abstraction, prompts, orchestration, context assembly, tool execution, conversation memory, AI sessions, token/cost management, guardrails, and AI audit — Chatbot module (`backend-chatbot`, `SPEC-CHATBOT-001`); Onboarding consumes it through `IF-CHATBOT-*` interface contracts, it does not implement or configure it (CRR §8; ADR-013).
- **Chatbot user data and GDPR subject-rights exports** — the chatbot is reused for subject-rights requests, executed by the Chatbot module; Compliance module owns the subject-rights workflow and data provision (CRR §8, §26; [OPEN] event contract — see §20 OPQ-3).
- **Special-category data handling, retention tiers, and policy enforcement** — Compliance module (CRR §25–§27; PDD §5.4, §5.7).
- **Three-tier automatic deletion jobs** — Retention module (CRR §25).
- **Push notification delivery** — Notifications module (CRR §18).
- **Hotel, Hotel Group, and manager records** — Hotels module (CRR §11).

Explicitly excluded from the platform entirely and therefore **never** part of this module:

- Worker-initiated job applications; auto-matching; marketplace workflows.
- Background checks; account lockout; login rate-limiting; CAPTCHA.
- Any process that alters or updates employee records post-hire (that is the responsibility of Employee Management and Compliance).

## 5. Responsibilities

The module is responsible for:

1. **Personalfragebogen capture:** providing a self-service digital form with all confirmed fields, presented during initial signup (CRR §6).
2. **Document collection orchestration:** determining which documents are required based on worker nationality/residency status; requesting them via chatbot and fallback UI (CRR §7, §8).
3. **Chatbot invocation (not execution):** initiating a document-collection conversation through the Chatbot module (`backend-chatbot`) and receiving its completion/fallback signal; Onboarding does not run the conversation, select the provider/model, or manage cost controls, caching, token limits, or fallback logic — those are owned by the Chatbot module (CRR §8; PDD §4.14, §7.1; ADR-013).
4. **Contract generation & presentation:** generating a pre-filled contract PDF from Personalfragebogen data (incl. the 1-year fixed term and 6-month probation clause) and making it available to download/print for hand signing (CRR §9; PDD §7.1).
5. **Hand-signed contract capture:** accepting the scanned/photographed signed paper contract (stored in S3 (EU)) and recording the manager's confirmation that it is "signed & valid"; the system does not capture, verify, or auto-detect the signature (CRR §9; PDD §5.7, §7.1).
6. **Account activation gate:** blocking account activation until all required documents are uploaded AND a contract file is uploaded AND the manager marks it signed & valid; a visible "contract pending signature" status exists until then (CRR §8, §9).
7. **Pool/claim mechanism:** managing a shared inbox of pending applications visible to all Hotel Group managers; supporting claiming, locking, and preventing simultaneous review (CRR §10).
8. **Hire approval:** capturing manager decisions (approve/reject) and probation suitability assessment (CRR §10).
9. **Onboarding completion & decision relay:** signalling Employee Management when the onboarding workflow is complete (so it moves the existing Inactive record to Under Review) and relaying the manager's approval/rejection decision; Employee Management owns the record and executes the transition (CRR §10; EM §7, §14).
10. **Audit trail:** recording all onboarding steps, documents submitted, contract signed & valid confirmation, and approval decisions for compliance and dispute resolution (CRR §30).

## 6. Core Concepts

### 6.1 Personalfragebogen (German New-Hire Form)

**Definition:** A legally required self-service digital form completed by the worker during signup. It captures German identity, tax, banking, and employment-type information required to register the worker with German social-security and tax authorities during the probationary period.

**Confirmed fields** (CRR §6):

- First name (Vorname)
- Last name (Nachname)
- Date of birth (Geburtsdatum)
- Nationality (Staatsangehörigkeit)
- Place of birth (Geburtsort)
- Country of birth (Geburtsland)
- Street + house number (Straße & Hausnummer)
- Postal code & city (PLZ & Ort)
- Bank account holder (Kontoinhaber)
- IBAN
- Tax ID (Steuer-ID)
- Health insurance provider (Krankenkasse)
- Social security number (Sozialversicherungsnummer)
- Employment type: Teilzeit / Minijob
- Work start date (Beginn der Arbeit)
- Signed declaration (Unterschrift + Ort/Datum)

**Constraints:**

- Self-service only — the worker fills it out themselves; managers do NOT enter it on their behalf (CRR §6).
- Digital form, not PDF upload or paper (CRR §6).
- All fields are mandatory.
- Employment type (Teilzeit vs. Minijob) is stored for information purposes only; it does not trigger system logic or warnings (CRR §6).

**Use:** Data is submitted to German authorities to register the worker during their probationary period (CRR §6).

### 6.2 Document Requirements

**Definition:** Work authorisation documents required from non-EU/EEA/Swiss workers to comply with German employment law.

**Rules** (CRR §7):

- EU/EEA/Swiss citizens do NOT require work-permit documents (explicitly confirmed).
- Non-EU workers MUST upload work-permit / residence documents.
- Work-permit requirements are a **mandatory legal obligation** separate from the (rejected) background-check process.
- Document validation is owned by the Documents module; Onboarding orchestrates the collection workflow.

**Chatbot coordination:** The document-collection chatbot (§6.3) queries workers for documents and resubmits missing ones until the requirement is met.

### 6.3 Document Collection Chatbot (Consumed Capability)

**Definition:** An AI agent, owned and executed entirely by the Chatbot module (`backend-chatbot`, `SPEC-CHATBOT-001`), that guides workers through document collection during signup, asking for missing documents until all requirements are satisfied. Onboarding **consumes** this capability; it does not implement, configure, or operate the agent (CRR §8; PDD §4.14, §7.1; ADR-013).

**Onboarding's consumption contract** (execution detail owned and specified by `SPEC-CHATBOT-001`, not restated here):

- **What Onboarding provides:** the worker's required-document context (which documents are outstanding, driven by nationality/residency status per §6.2) at conversation start, through the Chatbot module's `IF-CHATBOT-*` interface.
- **What Onboarding receives:** a completion signal (all required documents uploaded) or a fallback-triggered signal (the Chatbot module's own cost/token guardrails were hit), which advances or diverts the onboarding workflow (§7 state 4 "Document collection in progress"); Onboarding does not itself decide when to fall back — the Chatbot module owns that guardrail.
- **What Onboarding does not own:** the agent's provider/model selection, prompt construction, conversation-loop behavior, token/cost budgets, caching strategy, and conversation-memory/session state — all owned by the Chatbot module.
- **Secondary use:** The same agent is reused for GDPR subject-rights requests, executed by the Chatbot module under a workflow owned by Compliance (CRR §8, §26); this is a separate consumer of the Chatbot module, not an Onboarding responsibility.
- **Conversation state:** [OPEN] whether conversation history is persisted for the worker, or discarded after onboarding completion — this is a Chatbot-module decision (see §20 OPQ-3).

### 6.4 Familiarization Period (Trial Work)

**Definition:** An optional short trial-work period that may take place after a complete application (Personalfragebogen + valid documents) and **before** an employment contract is concluded, so both parties can determine whether the working relationship is suitable.

**Rules** (CRR §9):

- Occurs only after the applicant has submitted a **complete application with all required and valid documents**.
- **Maximum of two trial days**, and always complies with applicable legal requirements.
- **Sole purpose:** mutual suitability assessment — it is not itself the hiring decision and carries no automation.
- An employment contract is **concluded only if both parties agree to proceed** after the familiarization period.
- Typically the hand signing of the contract happens on-site during these familiarization days, since the worker is present in person (§6.5).

### 6.5 Employment Contract (Hand-Signed, Manager-Confirmed)

**Definition:** A fixed-term employment contract signed **by hand** (physical/handwritten, wet-ink) and confirmed by the manager — the **manager-confirmed hand-signed contract** (EM §4). There is **no e-signature integration**; QES is explicitly rejected (CRR §9, §34).

**Specifications** (CRR §9; PDD §7.1, §5.7):

- The contract is the **same document** used at signup and after probation (one document, not two). If differences are needed in future, they are introduced later through a separate process.
- **Generation:** The system generates a **pre-filled contract PDF** from the worker's Personalfragebogen data (name, start date, the **1-year fixed term**, the **6-month probation clause**, etc.).
- **Download/print:** The pre-filled contract is made available to **download/print** and is shown to the worker to review.
- **Hand signing:** **Both parties sign on paper, in person** (typically during the familiarization days, §6.4). The system does NOT capture, verify, or auto-detect the handwritten signature.
- **Scan upload:** The signed paper contract is **scanned/photographed and uploaded** back into the app (mechanically like any other document upload) and stored in **S3 (EU)**.
- **Manager confirmation (Option A):** The **manager uploads the scan and marks it "signed contract received & valid."** The system **trusts the manager's confirmation**. This action activates the account and starts the 1-year expiry clock.
- **Legal note:** A **handwritten (wet-ink) signature satisfies the German written-form requirement** for the contract; QES / eIDAS electronic-signature law does not apply here.
- **Contract ownership:** Contract template, versioning, and storage of the manager-confirmed hand-signed contract (scan in S3 (EU)) are owned by the **Contracts module** (EM §4); Onboarding coordinates generation, presentation, scan upload, and captures the manager's confirmation.
- **Account activation gate:** The account does NOT activate until a contract file is **uploaded** AND the **manager marks it signed & valid** (CRR §8, §9). Until then a visible **"contract pending signature"** status exists so unsigned contracts are not forgotten.

**Contract lifecycle** (CRR §9): The initial contract is a **fixed-term 1-year contract with a 6-month probation period**; during probation either party may terminate with **two weeks' notice**. The **ongoing** lifecycle — the contract expires at the end of year 1, may be **extended by one additional year (no new probation)**, and after **two years** the employee is offered a **permanent (open-ended) contract** — together with **contract-expiry reminders** (manager reminded before the 1-year expiry, again before the end of a second year, and no further reminders once permanent) is owned by the **Contracts/HR module** (PDD §5.6, §7.7). Onboarding owns only the **initial signing and activation** and references the ongoing lifecycle; it does not duplicate that ownership.

**Resolved questions** (CRR §9):

- **[RESOLVED]** **Probation legal shape:** a **fixed-term 1-year contract with a 6-month probation clause, signed by handwritten signature** (no e-signature) (OPQ-6; CRR §9).
- **[RESOLVED]** **Contract expiry/renewal length:** **1 year initial, extendable by 1 additional year, permanent (open-ended) after 2 years** (OPQ-7; CRR §9).

### 6.6 Pool/Claim Hiring Mechanism

**Definition:** A shared-inbox workflow where completed applications appear for all Hotel Group managers; the first manager to open it "claims" it, preventing duplicate simultaneous review.

**Specifications** (CRR §10):

- **Visibility:** Completed applications (Personalfragebogen + documents + contract signed) appear in a shared inbox visible to **all managers in the Hotel Group**.
- **Claiming:** The first manager to open an application "claims" it; it locks to that manager.
- **Locked view:** Other managers see "Under review by [manager name]" and cannot claim the same application.
- **Actions:** The claiming manager approves or rejects.
- **No simultaneous review:** The lock prevents two managers from reviewing the same application at the same time.

### 6.7 Hire Approval Decision

**Definition:** A manager's judgment decision on whether to approve or reject a new hire.

**Specifications** (CRR §10):

- **Suitability assessment:** The manager marks a worker as "suitable" (approve) or rejects them.
- **Probation judgment:** entirely manual manager judgment — no system timer, no rating-threshold automation, no probation clock.
- **Scope of review:** Manager has full access to the Personalfragebogen, uploaded documents, and signed contract.
- **No re-application:** [OPEN] how rejected applicants are handled; whether they can reapply (see §20 OPQ-4).

## 7. Onboarding Lifecycle

The onboarding lifecycle progresses through the following states:

1. **Signup initiated** — Worker creates platform account; Employee Management creates the corresponding employee record in **Inactive** status (EM §7, §14). The worker enters the onboarding flow.
2. **Personalfragebogen in progress** — Worker fills out the form.
3. **Personalfragebogen completed** — Form submitted.
4. **Document collection in progress** — Chatbot guides worker through required documents.
5. **Documents collected** — All required documents uploaded (or worker exempted due to EU status).
6. **Familiarization period** — Optional trial work of **at most two trial days** for mutual suitability; a contract is concluded only if both parties agree afterward (CRR §9). This step precedes contract conclusion.
7. **Contract generated & presented** — A pre-filled contract PDF (incl. 1-year fixed term and 6-month probation clause) is generated from Personalfragebogen data and made available to download/print for hand signing.
8. **Contract signed & confirmed** — Both parties sign the paper contract by hand, in person; the scan is uploaded (stored in S3 (EU)) and the **manager marks it "signed & valid."** Account is now activated and the 1-year expiry clock starts. Until this point the contract carries a **"contract pending signature"** status.
9. **Awaiting manager review** — Onboarding signals completion; Employee Management transitions the employee record from **Inactive** to **Under Review** (EM §7, §14). The application appears in the pool for manager claiming.
10. **Under manager review** — Manager has claimed the application and is reviewing.
11. **Approved** — Manager approves; Employee Management transitions the employee record from **Under Review** to **Active** (EM §14).
12. **Rejected** — Manager rejects; Employee Management transitions the employee record from **Under Review** to **Rejected** (EM §14); worker is notified; application is archived.
13. **Onboarding complete** — For an approved hire, the employee record is now **Active** in Employee Management and Onboarding's involvement ends; the record continues under the Employee Management lifecycle thereafter (EM §7 Employee Lifecycle; §8 Employee Status Model).

**Account activation gate:** States 1–8 result in an activated platform account. Account is **blocked** until state 8 is reached — i.e., until a contract file is uploaded AND the manager marks it signed & valid (CRR §8, §9).

## 8. State Transitions

Valid transitions:

```
Signup initiated → Personalfragebogen in progress
Personalfragebogen in progress → Personalfragebogen completed
Personalfragebogen completed → Document collection in progress
Document collection in progress → Documents collected
Documents collected → Familiarization period
Documents collected → Contract generated & presented   (familiarization is optional and may be skipped)
Familiarization period → Contract generated & presented
Contract generated & presented → Contract signed & confirmed
Contract signed & confirmed → Awaiting manager review
Awaiting manager review → Under manager review
Under manager review → Approved   (Employee Management: Under Review → Active)
Under manager review → Rejected   (Employee Management: Under Review → Rejected)
```

**Employee-status mapping (owned by Employee Management, EM §8/§14):** the employee record is created **Inactive** at *Signup initiated*; it becomes **Under Review** at *Awaiting manager review* (onboarding complete); **Active** on *Approved*; **Rejected** on *Rejected*. The states above are Onboarding **workflow** states only — Employee Management owns the employee statuses and their transitions.

**No backwards transitions:** once a state is left, it cannot be re-entered within the same application.

**Rejection final:** Rejected applications do not re-enter the flow; workers must re-signup to try again (or follow [OPEN] rework rules — OPQ-4).

## 9. Permissions & Authorization

**Personalfragebogen & document upload:** Only the applicant (the worker themselves) can fill out the form and upload documents (CRR §6).

**Pool/claim review:** Only **Hotel Group managers** can access the pool and claim applications. Specifically:

- Hotel Manager: Can claim and review applications for employees they will manage.
- Regional Manager: Can claim and review applications for any hotel in their Hotel Group.
- Admin: Can claim and review applications across the system.
- Staff (Worker) and Checker: No access to the pool.

**Approval decision:** Only the manager who claimed the application can approve or reject it (lock prevents others from interfering).

## 10. Events Produced

Onboarding produces the following events for consumption by other modules:

1. **`OnboardingStarted`** — Worker has initiated signup.
   - Payload: Worker ID, timestamp.
   - Consumers: Analytics, Audit.

2. **`PersonalfragebogenSubmitted`** — Worker has completed and submitted the form.
   - Payload: Worker ID, form data (structure [OPEN]).
   - Consumers: Audit, Compliance (for data-protection audit).

3. **`DocumentsCollected`** — All required documents have been uploaded (or worker is EU/EEA/Swiss exempt).
   - Payload: Worker ID, document list, exemption status if applicable.
   - Consumers: Audit, Documents module (for validation).

4. **`ContractSigned`** — The manager has uploaded the scanned signed paper contract and marked it "signed & valid" (the account activates and the 1-year expiry clock starts).
   - Payload: Worker ID, Manager ID, confirmation timestamp, reference to the scanned signed contract stored in S3 (EU).
   - Consumers: Audit, Contracts module.

5. **`ApplicationReadyForReview`** — Completed application (Personalfragebogen + documents + contract signed) is now in the pool.
   - Payload: Application ID, Worker ID.
   - Consumers: Employee Management module (transitions employee Inactive → Under Review, EM §14), Notifications (manager notification), Pool/Claim system.

6. **`ApplicationClaimed`** — Manager has claimed the application for review.
   - Payload: Application ID, Manager ID.
   - Consumers: Audit, other managers in the pool (for "Under review" status).

7. **`HireApproved`** — Manager has approved the hire.
   - Payload: Application ID, Worker ID, Manager ID, approval timestamp.
   - Consumers: Employee Management module (transitions employee Under Review → Active, EM §14), Notifications (worker notification).

8. **`HireRejected`** — Manager has rejected the hire.
   - Payload: Application ID, Worker ID, Manager ID, rejection reason (optional), timestamp.
   - Consumers: Employee Management module (transitions employee Under Review → Rejected, EM §14), Notifications (worker notification), Audit.

**Event contract** [OPEN]: Whether events are transactional (exactly-once) or best-effort; retry/idempotency semantics (see §20 OPQ-3).

## 11. Events Consumed

Onboarding consumes events from other modules:

1. **`EmployeeRecordCreated`** (from Employee Management) — Employee Management has created the employee record in **Inactive** status at signup (EM §7, §14).
   - Expected at the start of onboarding, immediately following signup.
   - Action: Onboarding associates its workflow with this existing Inactive employee record and begins document collection.

**[OPEN] Document validation events** (from Documents module) — whether Documents module publishes validation status (CRR §7; coordination required — see §20 OPQ-2).

## 12. Security

**Data classification:** Personalfragebogen and document data are **sensitive personal data** requiring protection; special-category protection under GDPR applies to the CRR §27 fields (Konfession, disability, health) (CRR §27).

**Transmission:**
- Document uploads: transmitted over TLS (HTTPS) in transit, terminated at the platform edge (PDD §5.2).
- Chatbot conversations: transmitted over TLS (HTTPS) in transit; not end-to-end encrypted (PDD §5.2) — transport and input-validation guardrails for the conversation itself (injection defense, accepted-upload-type enforcement) are owned and implemented by the Chatbot module (`backend-chatbot`), not by Onboarding (ADR-013).

**Contract signing:** The contract is signed **by hand on paper**, not electronically; there is no e-signature provider. The scanned signed contract is stored in **S3 (EU)** and owned by the Contracts module; Onboarding records only the manager's "signed & valid" confirmation (Manager ID, timestamp) and a reference to the stored scan. The system does not capture, verify, or auto-detect the handwritten signature.

**Manager access control:** Pool/claim interface requires Hotel Manager role or above. The pool is scoped to the manager's Hotel Group (Hotel Manager sees only their hotel; Regional Manager sees all hotels in their group).

**Session security:** When manager reviews a claimed application, session timeout rules apply per CRR §2 (auto-logout after 7 days; MFA for managers).

## 13. GDPR & Data Protection

**Personalfragebogen fields:** All Personalfragebogen fields are **personal data** that is sensitive and must be protected; however, per CRR §27 and EM §9, the ordinary Personalfragebogen fields are **ordinary personal data, not GDPR special-category data**. Field-by-field sensitivity:

- Nationality, place of birth, date of birth: identity markers (ordinary personal data).
- Tax ID, Social Security Number: quasi-identifiers (ordinary personal data).
- Bank account (IBAN, account holder): **financial/payroll data** — not GDPR special-category.
- Health insurance provider (Krankenkasse): personal data — the insurer name is not itself a health record and is not GDPR special-category.
- **GDPR special-category data** is restricted to the CRR §27 set only: **Konfession (religion), disability status, and health data (sick notes)**. Konfession is **NOT** part of the confirmed §6.1 Personalfragebogen field list (not collected on this form; flagged in CRR §27).

**Retention:** Personalfragebogen data **spans two retention tiers** (CRR §25; EM §19). General personal/profile fields (name, date of birth, nationality, address, etc.) fall under **Tier 2 (general personal/profile data): 5 years**, while payroll/tax-adjacent fields (IBAN, Tax ID) fall under **Tier 3 (payroll/tax-adjacent fields): 6 years** per German tax/payroll retention law (§41 EStG / §257 HGB / §147 AO) ([OPEN] tax-advisor sign-off — OPQ-1).

**Subject-rights:** Workers can request data export via button or chatbot (§6.3); Compliance module owns fulfilment, coordinating with Onboarding to retrieve Personalfragebogen and documents (CRR §26).

**Document storage:** Documents are stored by the Documents module; Onboarding maintains only references to them. Documents follow CRR §25 retention tiers.

**Contract:** The scanned hand-signed contract (stored in S3 (EU)) is owned by the Contracts module; Onboarding maintains only a reference plus the manager's "signed & valid" confirmation.

**Audit trail:** All Onboarding actions (form submission, document upload, claiming, approval/rejection) are logged for audit and dispute resolution (CRR §30).

## 14. Audit & Compliance

Every Onboarding action produces an audit log entry:

- Worker signup initiated (timestamp, device/IP [OPEN]).
- Personalfragebogen submitted (timestamp, field-by-field changes [OPEN]).
- Each document uploaded (timestamp, document type, file hash [OPEN]).
- Chatbot conversation started/ended (timestamp, [OPEN] conversation transcript retention).
- Contract presented (timestamp).
- Contract generated (timestamp) and manager confirmation "signed & valid" (timestamp, manager ID, reference to scanned signed contract in S3 (EU)).
- Application entered pool (timestamp).
- Application claimed by manager (timestamp, manager ID).
- Application approved (timestamp, manager ID, decision narrative [OPEN]).
- Application rejected (timestamp, manager ID, rejection reason).

**Audit access:** Audit logs are accessible to Admin and Regional Manager (scoped to their Hotel Group). [OPEN] whether Checkers have access.

**Audit retention:** Logs are retained for dispute and legal-compliance purposes; classified under CRR §25 **Tier 2 (5 years)**.

## 15. Validation & Error Handling

### 15.1 Personalfragebogen Validation

- **Mandatory fields:** All fields in §6.1 are mandatory; form cannot be submitted with missing fields.
- **Field formats:**
  - Date of birth: valid date, worker is 18+ years old [OPEN] (verify statutory minimum).
  - IBAN: valid IBAN format (ISO 13616).
  - Tax ID: valid German tax-ID format.
  - Social Security Number: valid format (CRR §6).
  - Nationality: must match a list of valid country codes.
- **Error presentation:** On validation failure, user is shown which field failed and is asked to correct it.

### 15.2 Document Validation

- **Document type:** Chatbot specifies which document types it will accept (e.g., PDF, JPG); system rejects unsupported types.
- **File size:** [OPEN] maximum file size per document.
- **Non-EU work-permit requirement:** The **Documents module** owns the work-permit requirement rule and its validation — non-EU/EEA/Swiss nationals require a work-permit document; EU/EEA/Swiss nationals are exempt (CRR §7; EM §4). Onboarding supplies the worker's Nationality (from the Personalfragebogen) and orchestrates collection; it does not independently define the rule. The rule is deterministic (Nationality vs. EU/EEA/Swiss list); no manual override.
- **Missing documents:** If required documents are missing, chatbot re-prompts; account cannot activate (§7, gate).

### 15.3 Contract Signing Validation

- **Contract generated:** The pre-filled contract PDF is generated from Personalfragebogen data and made available to download/print for review.
- **Scan upload:** After both parties sign on paper, the signed contract scan is uploaded and stored in S3 (EU); a contract file must be present before it can be confirmed.
- **Manager confirmation:** The manager marks the uploaded contract "signed & valid"; only then does the account activate. Until then the contract carries a "contract pending signature" status.
- **Missing/unsigned contract:** If no signed contract scan is uploaded and confirmed, the account remains inactive and the application does not proceed to pool.

### 15.4 Pool/Claim Validation

- **Application completeness:** Manager can only claim applications where Personalfragebogen + documents + contract are all marked complete.
- **Incomplete applications:** Applications missing any component do NOT appear in the pool (remain in "Document collection" or earlier state).
- **Double-claim prevention:** Lock mechanism prevents second manager from claiming an already-claimed application (database-level constraint).

### 15.5 Approval Decision Validation

- **Decision required:** Manager must select either "Approve" or "Reject"; cannot claim without deciding.
- **Approval triggers:** Once approved, Employee Management transitions the employee record from Under Review to Active (EM §14).
- **Rejection captures:** Rejection reason is optional but recommended for documentation; rejection is final (no re-entry unless worker re-signups).

## 16. Error Scenarios & Recovery

### 16.1 Chatbot Fallback Signal Received

**Scenario:** Worker is in the document-collection conversation; the Chatbot module's own token/cost guardrail is triggered (budget or per-conversation limit exceeded — mechanism owned and enforced by `backend-chatbot`, not Onboarding).

**Behavior:** Onboarding receives the Chatbot module's fallback-triggered signal and renders a **static checklist UI** listing all required documents, with manual upload. Worker continues with fallback UI until documents are complete. Onboarding does not itself decide when fallback occurs; it only reacts to the signal.

**Recovery:** No error message shown; seamless transition to fallback.

### 16.2 Contract Scan Upload Fails

**Scenario:** The manager attempts to upload the scanned/photographed signed paper contract, but the upload to S3 (EU) fails (network error, storage error, or the file is rejected as an unsupported type).

**Behavior:**
- The manager is shown "Contract upload failed; please try again in a moment."
- Onboarding retains the contract-pending state; the manager can retry the upload within [OPEN] retry window (OPQ-8).
- Account remains inactive until a contract file is uploaded AND marked "signed & valid."

**Recovery:** [OPEN] Whether the upload auto-retries, or the manager must manually re-upload (OPQ-8).

### 16.3 Manager Claims, Then Logs Out

**Scenario:** Manager claims an application; session times out; manager never approves/rejects.

**Behavior:** [OPEN] Whether claim automatically expires after [OPEN] duration (e.g., 24 hours), releasing the application back to the pool (OPQ-9).

**Recovery:** [OPEN] claim-expiry policy and notification (OPQ-9).

### 16.4 Duplicate Signup Attempt

**Scenario:** Worker tries to sign up a second time with the same email/identity.

**Behavior:** Platform rejects as duplicate account (Authentication module concern); user is directed to log in if they already have an account.

**Recovery:** Worker logs in to existing account; if onboarding was incomplete, they resume from the last step (or restart per [OPEN] OPQ-5).

### 16.5 Network Failure During Personalfragebogen Submission

**Scenario:** Worker fills out form; network fails during submission.

**Behavior:** [OPEN] whether form is persisted (partial save) or lost (OPQ-5).

**Recovery:** [OPEN] retry/resume behavior (OPQ-5).

## 17. Edge Cases

### 17.1 EU/EEA/Swiss Citizen (No Work Permit Required)

A worker with Nationality = Austria, Poland, etc., is exempt from the work-permit document requirement. Applying the Documents-module-owned requirement rule (EM §4), Onboarding does NOT request work-permit documents for this worker (CRR §7).

### 17.2 Personalfragebogen Data Mismatch

Worker fills Personalfragebogen with Name = "Max Müller" but later uploads an ID showing Name = "Maxim Mueller". [OPEN] Whether system flags discrepancy or accepts both (OPQ-11).

### 17.3 Manager Approves, Employee Management Cannot Activate

[Hypothetical] Manager approves the hire; Employee Management receives the `HireApproved` event but cannot transition the employee from Under Review to Active (e.g., the record is in an unexpected state).

**Behavior:** [OPEN] escalation and resolution path (OPQ-12).

### 17.4 Worker Declines Consent During Onboarding

Engaging the chatbot requires a GDPR data-processing consent gate (e.g., before chatbot-guided document collection). Per `ADR-015`, this gate is owned and implemented entirely by `backend-consent`/`SPEC-CONSENT-001`, exposed to Onboarding via `IF-CONSENT-*`; Onboarding requests consent through that interface and reacts to its outcome, but does not own the gate, its logic, or its state. **RESOLVED `GD-17`/`ADR-037`, 2026-07-28** (OPQ-3): a decline does NOT block onboarding — it routes the worker to a manual/non-chatbot onboarding path instead.

## 18. Dependencies

**Module dependencies** (modules Onboarding consumes):

1. **Authentication:** Login, account creation, password reset, MFA (CRR §2).
2. **Employee Management:** Owns the employee record and lifecycle — creates the Inactive record at signup and transitions it (Inactive → Under Review → Active/Rejected) in response to Onboarding's completion signal and approval/rejection decisions (CRR §6–§10; EM §7, §14).
3. **Documents:** Stores uploaded documents; validates non-EU work-permit requirements (CRR §7).
4. **Contracts/HR:** Manages the contract template and versioning, stores the manager-confirmed hand-signed contract, and owns the ongoing contract lifecycle (expiry at 1yr → optional +1yr with no new probation → permanent after 2yr) and expiry reminders (CRR §9; PDD §5.6, §7.7).
5. **Compliance:** Owns data retention and special-category handling; Onboarding defers to it (CRR §25–§27).
5a. **Consent (`backend-consent`, target `SPEC-CONSENT-001`):** Owns the consent lifecycle (records, versions, withdrawal, renewal, audit history, validation), including any data-processing consent gate for chatbot engagement; consumed by Onboarding only through `IF-CONSENT-*` interfaces — Onboarding owns no consent gate/logic/state of its own (`ADR-015`; see §17.4, OPQ-3).
6. **Hotels:** Hotel Group context for pool/claim scope (managers see applications for their Hotel Group) (CRR §11).
7. **Chatbot (`backend-chatbot`, `SPEC-CHATBOT-001`):** Powers the document-collection AI-agent conversation, consumed through `IF-CHATBOT-*` interfaces; Onboarding does not integrate with the Claude API directly — that integration, and the agent's execution, are owned by the Chatbot module (CRR §8; PDD §4.14, §7.1; ADR-013).
8. **S3 (EU) storage:** Holds uploaded documents and the scanned hand-signed contract; no data leaves the EU/EEA (storage owned by the Documents/Contracts module) (CRR §9; PDD §5.7).
9. **Notifications:** Sends notifications to managers and workers (application ready, approval, rejection) (CRR §18).

**Outbound dependencies** (modules that consume Onboarding):

1. **Employee Management:** Creates the Inactive employee record at signup (publishing `EmployeeRecordCreated`); consumes Onboarding's completion signal (`ApplicationReadyForReview`) and `HireApproved`/`HireRejected` to transition the record (Inactive → Under Review → Active/Rejected) (CRR §6–§10; EM §7, §14).
2. **Audit/Compliance:** Consumes all onboarding events for audit and legal compliance.
3. **Analytics:** Consumes `OnboardingStarted`, `HireApproved`, `HireRejected` for hiring metrics.

## 19. Future Extensibility

**Planned** (may be added in subsequent phases, out of scope for v1):

- Re-application after rejection (decide policy: auto-allow, manager-initiated, or disallowed).
- Bulk import of onboarding candidates (CSV upload of pre-filled forms, then individual signing).
- Approval workflow escalation (e.g., require Regional Manager sign-off for first hires).
- Probation clock and auto-graduation (currently entirely manual).
- Nationality/residency change during employment (currently one-time at signup).

**Not planned** (explicitly excluded):

- Background-check integration (CRR §3).
- Multiple contract templates per employee.
- Renegotiation or amendment workflows mid-employment (only possible after onboarding).

## 20. Open Questions

The following genuine unknowns are unresolved and will block final implementation. All are confirmed as genuine gaps, not placeholders.

**OPQ-1: Tax-advisor sign-off on 6-year retention tier** [ACTION]
- 6-year retention for payroll-adjacent data is based on German tax law; should be validated by client's tax advisor before final lock-in.
- Owner: Client's tax advisor.
- Status: Pending.

**OPQ-2: Document validation event contract** [DESIGN]
- Should Documents module publish validation-status events (e.g., "Document is valid work permit"), or is synchronous API-call validation sufficient?
- Impacts: Chatbot knows when to stop requesting documents.

**OPQ-3: Chatbot conversation persistence & consent** — **RESOLVED (consent portion) by `ADR-015`**
- Are chatbot conversations (with worker) persisted for future reference / subject-rights export, or discarded after onboarding? This is a Chatbot-module (`backend-chatbot`) decision per `ADR-013`; Onboarding only consumes the outcome. This portion remains open (tracked at `SIR-CHAT-008`).
- Does engaging the chatbot require explicit data-processing consent? **Resolved by `ADR-015`** (authority) **and concretely decided by `GD-17`/`ADR-037`, 2026-07-28** (outcome): yes, chatbot engagement requires explicit consent. A decline does **not** block onboarding — it routes the worker to a manual/non-chatbot onboarding path instead (see §17.4). Onboarding owns no consent gate, logic, or state of its own; it consumes this outcome via `IF-CONSENT-*`.
- Impacts: Compliance/audit trail (Compliance consumes Consent for governance/audit only, per `ADR-015` — it is not the consent owner); GDPR subject-rights scope.

**OPQ-4: Rejected applicant re-application**
- Can a rejected applicant re-apply immediately, or is there a cooldown?
- Is rejection permanent (worker must contact HR to appeal), or can rejection be overturned?
- Impacts: Worker UX; HR process definition.

**OPQ-5: Form persistence during network failure**
- If worker fills Personalfragebogen and network fails before submission, is the form auto-saved?
- Can worker resume from where they left off?
- Impacts: Worker UX; data-loss prevention.

**OPQ-6: Probation legal shape** `[RESOLVED]`
- Resolved: the initial contract is a **fixed-term 1-year contract with a 6-month probation clause, signed by handwritten (wet-ink) signature** (no e-signature) (CRR §9).
- Aligns with EM §26 OPQ-1 (probation legal shape). Probation remains a manual manager marking, not a distinct automated status.

**OPQ-7: Contract expiry/renewal length** `[RESOLVED]`
- Resolved: **1 year initial, extendable by 1 additional year (no new probation), permanent (open-ended) after 2 years** of successful employment (CRR §9). Expiry reminders are owned by the Contracts/HR module.

**OPQ-8: Contract scan upload retry policy**
- On upload failure of the scanned signed contract, does the system auto-retry, or does the manager manually re-upload?
- Retry window / backoff strategy?
- Impacts: Manager UX; error handling.

**OPQ-9: Manager-claimed application expiry**
- If manager claims an application but never approves/rejects, does the claim auto-release after a duration?
- Auto-release duration?
- Notification to manager before auto-release?
- Impacts: Pool/claim fairness; fallback paths.

**OPQ-10: Personalfragebogen submission persistence (sync vs. async)**
- Are form submissions stored synchronously (immediate acknowledgment), or asynchronously (queue-based)?
- If async, how long is the worker informed of submission status?
- Impacts: Worker UX; confirmation messaging.

**OPQ-11: Personalfragebogen vs. ID document mismatch**
- If worker fills "Max Müller" but ID shows "Maxim Mueller", does system flag as discrepancy or accept both variants?
- Is fuzzy-matching applied (Soundex, Levenshtein)?
- Manual review flag?
- Impacts: Data quality; manager review burden.

**OPQ-12: Employee Management activation-transition failure**
- Manager approves hire; Employee Management fails to transition the employee from Under Review to Active (e.g., the record is in an unexpected state).
- What is the recovery path? Does Onboarding mark the application as "Pending Activation" and retry the signal?
- Is manager / worker notified of the failure?
- Impacts: Data consistency; error handling.

## 21. Refactoring Summary

**Status:** This is the first foundational Onboarding module specification. No prior specification exists to refactor.

**Design decisions:**

- **Self-service Personalfragebogen only:** Worker fills form themselves; no manager entry or PDF-upload-after-the-fact.
- **Chatbot with cost controls (consumed):** AI-guided document collection with hard budget caps and fallback; execution and cost controls are owned by the Chatbot module (`backend-chatbot`), Onboarding only triggers and reacts to it (`ADR-013`).
- **Hand-signed, manager-confirmed contract:** The contract is signed by hand on paper (wet-ink); the manager uploads the scan and marks it "signed & valid," which activates the account. There is no e-signature integration.
- **Pool/claim mechanism:** Prevents duplicate simultaneous review; simple, auditable, no auto-assignment logic.
- **Manual approval, no automation:** Probation suitability is purely manager judgment; no rating thresholds or system gates.
- **No re-application logic:** Rejected workers must explicitly re-signup (may be relaxed in future phases).

**Relationship to Employee Management module:**

Onboarding progresses the Employee-Management-owned employee record (created **Inactive** at signup) and drives its EM-owned lifecycle transitions by signalling onboarding completion (Inactive → Under Review) and relaying the approval/rejection decision (Under Review → Active/Rejected) (EM §7, §14). Onboarding does NOT duplicate EM responsibilities:

- EM owns employee records, lifecycle states, and field definitions.
- Onboarding owns intake, documents, contract, and hire-approval decisioning.

The runtime event exchange is **bidirectional**: Employee Management publishes `EmployeeRecordCreated` at signup, which Onboarding consumes to attach its workflow (§11); Onboarding in turn emits its completion signal and `HireApproved`/`HireRejected`, which Employee Management consumes to transition the record. Ownership is non-overlapping — Onboarding owns intake/approval, Employee Management owns the employee record and every lifecycle transition — so there is no cyclic *ownership*, even though the event handshake is two-way.

---

## Index of Cross-Module References

| Module | Reference | Reason |
|--------|-----------|--------|
| Employee Management | §6–§10 (employee lifecycle) | EM owns the employee record (created Inactive at signup) and all lifecycle transitions; Onboarding progresses it and relays approval/rejection |
| Documents | §7 (work-permit requirement) | Documents module owns document storage, expiry, and the non-EU work-permit requirement/validation |
| Contracts/HR | §9 (contract template, hand-signed contract, lifecycle) | Contracts/HR module owns the contract template, versioning, storage of the manager-confirmed hand-signed contract, and the ongoing lifecycle/expiry reminders |
| Compliance | §13–14, §25–27 (GDPR, audit, retention) | Compliance owns retention policy and special-category handling; consumes Consent for governance/audit only (not owner, `ADR-015`) |
| Consent | §17.4, §20 OPQ-3 (chatbot data-processing consent gate) | Consent module (`backend-consent`, target `SPEC-CONSENT-001`) owns consent lifecycle/records/versions/withdrawal/renewal/audit/validation; Onboarding consumes via `IF-CONSENT-*` only, owns no consent gate/logic/state (`ADR-015`) |
| Authentication | §9, §5 (login, MFA for managers) | Auth module owns account creation and session management |
| Hotels | §5, §9, §10 (Hotel Group scope) | Hotels module owns Hotel and Hotel Group records |
| Notifications | §10 (notifications to managers/workers) | Notifications module owns push delivery |
| Chatbot | §6.3 (chatbot invocation) | Chatbot module (`backend-chatbot`/`SPEC-CHATBOT-001`) owns AI-agent execution (provider, model, prompts, cost controls, conversation state); Onboarding consumes it via `IF-CHATBOT-*` interfaces, it does not integrate with Claude API directly (ADR-013) |
| S3 (EU) storage | §9 (scanned signed contract) | Documents/Contracts module stores uploaded documents and the scanned hand-signed contract in S3 (EU); no data leaves the EU/EEA |

---

## 22. Change Log

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-07-01 | Initial foundational Onboarding module specification. |
| 1.1 | 2026-07-12 | Boundary correction per `ADR-013`: removed first-person Chatbot/AI-agent execution-ownership claims (§3, §5 item 3, §6.3, §18, Cross-Module References table) and reframed them as consumption of the Chatbot module (`backend-chatbot`/`SPEC-CHATBOT-001`) via `IF-CHATBOT-*` interface contracts; added an explicit Out-of-Scope disclaimer (§4) naming the Chatbot/AI-execution capability; reattributed the chatbot conversation's transport/input-validation guardrails (§12) and token/cost fallback behavior (§16.1) to the Chatbot module. No onboarding-workflow-owned responsibility (intake, document-collection orchestration, contract coordination, pool/claim, hire approval, business rules) changed. Resolves `SIR-GLOB-015`. |
| 1.2 | 2026-07-15 | Fast Documentation Workflow (Package B, `AUDIT-REPO-2026-07-14` `AUDIT-L3`): this Change Log lagged the document's own body, which already cites and applies `ADR-015` (Accepted, 2026-07-13; Consent standalone bounded context) in §20 OPQ-3 and the Index of Cross-Module References' Consent row, with no corresponding Change Log entry. Added this row to record that `ADR-015` correction: OPQ-3's consent-requirement sub-question is resolved (Consent is a standalone bounded context owned by `backend-consent`/`SPEC-CONSENT-001`; Onboarding owns no consent gate, logic, or state of its own and consumes the decision via `IF-CONSENT-*`); the chatbot-persistence sub-question remains open, tracked at `SIR-CHAT-008`, unaffected by `ADR-015`. No further body text changed by this pass — §20 OPQ-3 and the Cross-Module References Consent row already carried the correct `ADR-015` content; only this Change Log's own completeness gap is corrected. |

---

**Document version:** 1.2  
**Last updated:** 2026-07-15  
**Authority:** CONFIRMED_REQUIREMENTS_REGISTER.md, PIVOT_DESIGN_DOCUMENT.md, `ADR-013`, `ADR-015`  
**Status:** Foundational specification — ready for downstream module specifications to reference as authority on Onboarding boundary.
