# Database Schema Reference

**Generated from `backend/prisma/schema.prisma` at `8626256` (2026-08-23).**
34 models, 26 enums, 65 migrations.

> **Derived, not authoritative.** `schema.prisma` is the contract. Where this file disagrees with
> it, the schema is right and this file is stale (`ADR-008`). State *ownership* — which module may
> write a table — is governed by the ADRs cited below and by
> [`.claude/knowledge/STATE_OWNERSHIP_INDEX.yaml`](../../.claude/knowledge/STATE_OWNERSHIP_INDEX.yaml).
>
> It exists because `docs/06-database/` held nothing but `.gitkeep` files.

## Reading this safely

Three things about this schema are easy to get wrong:

1. **`JobRequest` maps to the physical table `WorkRequest`** (`@@map("WorkRequest")`). The model was
   renamed by Epic 9 PR 9.4 with zero data migration; raw SQL must still say `"WorkRequest"`.
2. **`HotelWorker` is dormant, not live.** `ADR-022` retired the module in code only — by explicit
   human decision there was no `DROP TABLE` and no backfill into `EmploymentRecord`. Nothing reads
   it except a read-only reporting script. Do not treat it as the roster.
3. **`AuditLog` is shared-write but single-owner.** Eight-plus modules write it via
   `BaseService.logAudit`, but `ADR-016` assigns `backend-auth` as authoritative writer and makes
   `backend-compliance` a read-only consumer.

## Models by owning module

| Model | Fields | Authoritative writer / ownership |
|---|---|---|
| `Attendance` | 22 | backend-attendance |
| `AuditLog` | 13 | backend-auth (writer, ADR-016); backend-compliance reads only |
| `CalendarAbsence` | 10 | backend-calendar |
| `CalendarEntry` | 12 | backend-assignments (ADR-021 boundary) |
| `ConsentRecord` | 8 | backend-consent (ADR-015) |
| `Contract` | 23 | backend-hr (ADR-012) |
| `DailyShiftSummary` | 15 | backend-calendar |
| `EmployeeBlocklistEntry` | 9 | employee-management |
| `EmploymentRecord` | 34 | employee-management |
| `EmploymentStatusHistory` | 10 | employee-management (append-only) |
| `Hotel` | 37 | backend-crm (ADR-011) |
| `HotelGroup` | 16 | backend-crm (ADR-023) |
| `HotelManagerAssignmentHistory` | 12 | backend-crm |
| `HotelWorker` | 15 | **dormant** — retired by ADR-022, schema retained, no DROP |
| `JobRequest` → table `WorkRequest` | 27 | backend-job-requests |
| `JobRequestSkillSlot` | 9 | backend-job-requests |
| `Notification` | 15 | backend-notifications |
| `OutboxEvent` | 19 | backend-notifications (ADR-029) |
| `PasswordResetToken` | 7 | backend-auth |
| `PayslipRequest` | 12 | backend-hr (ADR-014) |
| `PushToken` | 8 | backend-notifications |
| `QualityVerification` | 18 | backend-quality |
| `Rating` | 14 | backend-quality |
| `RegionalManagerAssignmentHistory` | 12 | backend-crm |
| `RetentionAuditEntry` | 6 | backend-retention |
| `RetentionCategory` | 6 | backend-retention |
| `RetentionLog` | 7 | backend-retention |
| `RoomsCompletedEntry` | 13 | backend-assignments (ADR-028 — no room-task layer) |
| `Session` | 8 | backend-auth |
| `User` | 66 | backend-auth (authoritative writer, ADR-017); backend-users writes non-security profile fields only |
| `WorkerAssignment` | 34 | backend-assignments |
| `WorkerDocument` | 15 | backend-documents |
| `WorkerGeoCheckin` | 12 | backend-geo |
| `WorkerOverallRating` | 13 | backend-quality |

## Enums

26 enums. The ones that carry business rules rather than simple status vocabulary:
`EmploymentStatus` (permanent and non-terminal since the 2026-08-06 lifecycle rework — see
`ADR-030` note ³), `NotificationType` (additive-only; each new value ships its own migration),
`DeactivationReason`, `VerificationStatus`, and `OutboxStatus` (`ADR-029`).

| Enum | Values |
|---|---|
| `AssignmentStatus` | 6 |
| `AttendanceStatus` | 14 |
| `CalendarAbsenceKind` | 2 |
| `ConsentDecision` | 4 |
| `ContractStatus` | 32 |
| `DeactivationReason` | 3 |
| `DocumentCategory` | 108 |
| `EmploymentStatus` | 5 |
| `EmploymentType` | 2 |
| `HotelWorkerStatus` | 4 |
| `ManagerVacancyReason` | 6 |
| `NotificationChannel` | 5 |
| `NotificationType` | 484 |
| `OutboxAggregateType` | 1 |
| `OutboxEventType` | 1 |
| `OutboxSourceModule` | 77 |
| `OutboxStatus` | 5 |
| `OutboxTransport` | 4 |
| `PayslipRequestStatus` | 16 |
| `PushApp` | 2 |
| `PushPlatform` | 2 |
| `RetentionTier` | 3 |
| `SkillTag` | 4 |
| `UserRole` | 45 |
| `VerificationStatus` | 3 |
| `WorkRequestStatus` | 6 |

## Migrations

65 migrations, and **all 65 carry a `down.sql`** — rollback coverage is complete as of this
revision. Keep it that way: a missing `down.sql` is a rollback gap, not a style issue. See
[`docs/11-deployment/ci-cd/MIGRATION_ROLLBACK_HARNESS.md`](../11-deployment/ci-cd/MIGRATION_ROLLBACK_HARNESS.md).

Migrations that dropped or renamed something, and are therefore the ones to know about:

| Migration | What it did |
|---|---|
| `20260809000000_document_templates_module` | Created 7 document-template tables and 4 enums |
| `20260813000000_contracts_and_review_routing` | **Dropped all 7 of them plus the 4 enums**, when the module was retired in favour of the HR contract flow. Anyone reading the earlier migration in isolation will believe those tables still exist. |
| `20260815002604_drop_calendar_entry_unique_constraint` | Removed a uniqueness assumption on `CalendarEntry` |
| `20260816000000_user_preferred_language` | Added the nullable `User.preferred_language` (`SPEC-I18N-001`) |
| `20260818120000_add_rework_assignment_link` | Rework as a linked assignment (`ADR-069`) |
| `20260821000000_add_login_throttle` | `User.login_locked_until` (`ADR-070`) |

Full list: `backend/prisma/migrations/`.

## Not in this document

Field-level detail, indexes, and constraints. `schema.prisma` is heavily commented — many decisions
are recorded inline there and nowhere else (for example, why `User.preferred_language` has no column
default). Read it directly rather than trusting a summary for field-level work.

## Regenerating

Parsed from `backend/prisma/schema.prisma`. Re-derive against the schema rather than hand-editing.
