# Notification & Email Trigger Audit — 2026-08-26

Answers two questions asked during worker-app device testing: **where are push
notifications actually triggered, and where should they also be triggered?**
Same for email.

Derived by enumerating every `notificationService.enqueue(...)` call site in
`backend/src` (excluding tests) and reading the `transports` each one declares.
Method is reproducible; see "How this was produced" at the end.

## How delivery works

`enqueue()` writes one `Notification` row plus one `OutboxEvent` **per
transport** the call site names. There is no central routing table and no user
preference layer — **the transports are hardcoded at each call site**. A type
that names only `PUSH` can never send email, regardless of the recipient or
the urgency.

`PUSH` payloads carry `{ type: notification.type, ...notification.data }`
(`outbox-transport.ts:378`), which is what lets the apps deep-link on tap.

## What fires today

27 call sites. **22 push-only, 2 email-only, 3 both.**

| Event | Transports | Source |
|---|---|---|
| `ACCOUNT_CREATED` | EMAIL | `users/service.ts` |
| `SYSTEM` (password reset) | EMAIL | `auth/service.ts` |
| `HOTEL_ACTIVATED` | EMAIL + PUSH | `crm/service.ts` |
| `HOTEL_DEACTIVATED` | EMAIL + PUSH | `crm/service.ts` |
| `HR_PAYSLIP_REQUESTED` | EMAIL + PUSH | `hr/service.ts` |
| `ASSIGNMENT_CONFIRMED` | PUSH | `assignments/service.ts` |
| `ASSIGNMENT_CANCELLED` | PUSH | `assignments/service.ts` |
| `ATTENDANCE_VERIFIED` | PUSH | `attendance/service.ts` |
| `WORKER_NO_SHOW` | PUSH | `attendance/service.ts` |
| `CALENDAR_ABSENCE_MARKED` | PUSH | `calendar/service.ts` |
| `CALENDAR_ABSENCE_MARKED_FOR_WORKER` | PUSH | `calendar/service.ts` |
| `CONSENT_DECLINED` | PUSH | `consent/service.ts` |
| `HR_CONTRACT_LAPSED` | PUSH | `hr/service.ts` |
| `HR_CONTRACT_EXPIRY_REMINDER` | PUSH | `hr/service.ts` |
| `HR_CONTRACT_EXPIRY_WORKER_REMINDER` | PUSH | `hr/service.ts` |
| `HR_PAYSLIP_FULFILLED` | PUSH | `hr/service.ts` |
| `JOB_REQUEST_BROADCAST` | PUSH | `job-requests/service.ts` |
| `JOB_REQUEST_CLOSED` | PUSH | `job-requests/service.ts` |
| `WORK_REQUEST_PUBLISHED` | PUSH | `job-requests/service.ts` |
| `RATING_RECEIVED` | PUSH | `quality/service.ts` |
| `QUALITY_RATING_WARNING_*` | PUSH | `quality/service.ts` |
| `REWORK_REQUIRED` | PUSH | `quality/service.ts` |
| `REWORK_COMPLETED` | PUSH | `quality/service.ts` |
| `REWORK_OVERDUE` | PUSH | `quality/rework-escalation-job.ts` |
| `ONBOARDING_SUBMITTED` | PUSH | `employee-management/service.ts` |
| `ONBOARDING_APPROVED` | PUSH | `employee-management/service.ts` |
| `ONBOARDING_REJECTED` | PUSH | `employee-management/service.ts` |
| `ACCOUNT_DEACTIVATED` | PUSH | `employee-management/service.ts` |
| `ACCOUNT_REACTIVATED` | PUSH | `employee-management/service.ts` |
| `REPEATED_FAILED_LOGINS` | PUSH | `auth/service.ts` |

## Declared but never sent

Nine members of `NotificationType` exist in `schema.prisma` and are referenced
by **no** code path. They are declared intent, not behaviour:

`WORK_REQUEST_CANCELLED` · `WORK_REQUEST_EXPIRING_SOON` ·
`APPLICATION_RECEIVED` · `APPLICATION_ACCEPTED` · `APPLICATION_REJECTED` ·
`APPLICATION_WITHDRAWN` · `SHIFT_REMINDER` · `CHECK_IN_REMINDER` ·
`HR_PAYSLIP_REQUEST_ESCALATED`

`SHIFT_REMINDER` and `CHECK_IN_REMINDER` are the most consequential: both are
described in the schema as worker-facing pre-shift prompts, and no scheduler
emits them. `APPLICATION_ACCEPTED` / `APPLICATION_REJECTED` mean a worker who
applies for a job is never told the outcome by the system.

## Where notifications *should* also be sent

Not implemented — these are recommendations, and each is a scope decision.

**1. Money- and job-critical events need email, not just push.**
`ASSIGNMENT_CANCELLED` is the clearest: a cancelled shift is a lost day's pay,
and push is best-effort — it is silently dropped when APNs/FCM is
unconfigured (see below), when the token is stale, or when the worker has
notifications turned off. `ASSIGNMENT_CONFIRMED`, `HR_CONTRACT_LAPSED` and
`HR_CONTRACT_EXPIRY_WORKER_REMINDER` are in the same category: employment and
contract facts want a durable record the worker can find later.

**2. `ACCOUNT_DEACTIVATED` is push-only.** A deactivated account is the least
likely to have a working push session, and it is exactly the event the person
most needs to receive.

**3. `ONBOARDING_APPROVED` / `ONBOARDING_REJECTED` are push-only.** These end a
waiting period that can last days. Email is the natural channel.

**4. The gaps above** — at minimum `SHIFT_REMINDER` and the `APPLICATION_*`
outcomes.

## Two silent-failure modes worth knowing

Both were found while investigating "upload and download are broken", and both
report success while doing nothing:

- **Push**: with no APNs *and* no FCM credentials, `selectPushHandler` returns
  `LoggingNoopTransportHandler` (`outbox-transport.ts:475`). Every notification
  above is recorded as sent and reaches nobody. APNs additionally needs a
  bundle id per app — the key trio alone silently skips every iOS device.
- **Storage**: with `S3_BUCKET` unset, uploads are no-ops and presigned URLs
  are null.

`/api/v1/health/ready` now reports both (`storage`, `push`). Neither gates the
readiness verdict — the deploy workflow waits on that endpoint, and a
notification degradation must not refuse a rollout for everything else.

## How this was produced

```bash
grep -rn "notificationService.enqueue" backend/src --include='*.ts' | grep -v __tests__
```

then reading each call site's `type` and `transports`. The declared-but-unsent
list is the `NotificationType` enum in `backend/prisma/schema.prisma` minus
every identifier appearing anywhere under `backend/src`.

**Caveat:** static analysis only. Nothing here was verified by sending a real
notification, and this says nothing about whether delivery *succeeds* in
production — only about what the code attempts.
