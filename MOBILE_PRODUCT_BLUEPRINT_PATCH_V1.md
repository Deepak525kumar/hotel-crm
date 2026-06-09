# Mobile Product Blueprint — Patch V1
## Marketplace Alignment Review

**Document type**: Architectural patch against `MOBILE_PRODUCT_BLUEPRINT.md`
**Reviewer role**: Principal Mobile Architect
**Marketplace source of truth**: Hotel → HotelWorker → WorkRequest → WorkApplication → WorkerAssignment → Attendance → QualityVerification → Rating
**Frozen removals**: Room · Task · TaskPhoto · DailyOperation

---

## SECTION 1 — Marketplace Alignment Audit

### 1.1 Legacy Entity Scan

Full scan of `MOBILE_PRODUCT_BLUEPRINT.md` for all references to removed entities:

| Line(s) | Entity | Context | Verdict |
|---------|--------|---------|---------|
| L25 | Task | Screen: "Task Detail" `/tasks/[id]` — Task description, room info, photo upload | **REMOVE screen** |
| L22 | Task | Assignment Detail description: "Shift info, **tasks list**, check-in/out controls" | **PATCH description** |
| L24 | Task | Check-Out description: "**Task completion** summary, clock-out confirm" | **PATCH description** |
| L42 | Task / Room | Checker Assignment Detail: "Worker **task context, room info**, photos submitted by worker" | **PATCH description** |
| L41 | Task | Checker Queue description: "List of completed **worker tasks** awaiting verification" | **PATCH description** |
| L75 | Task | Navigation route: `tasks/[taskId]` under assignments | **REMOVE route** |
| L112 | Task | Checker tab badge: "**tasks** pending verification (unread)" | **PATCH label** |
| L150 | DailyOperation | Assignment Detail API note: "Includes tasks via WorkRequest → **DailyOperation**" | **PATCH note** |
| L153 | Task | API row: `GET /crm/tasks/:id` — Room + description | **REMOVE row** |
| L154 | TaskPhoto | API row: `POST /crm/tasks/:id/photos` | **REMOVE row** |
| L165 | Task | Checker queue API note: "**Tasks** awaiting verification" | **PATCH note** |
| L166 | Task | Checker Assignment Detail API note: "Worker info + **task photos**" | **PATCH note** |
| L167 | Task | Verification payload: `{ **task_id**, score, notes, status }` | **PATCH payload** |
| L168 | Task | Rating payload: `{ **task_id**, worker_id, score, comment }` | **PATCH payload** |
| L313 | Task / Room | Push event `TASK_READY_FOR_VERIFICATION` body: "**Room {room}** completed by {worker}" | **REMOVE event** |
| L315 | Room | Push event `VERIFICATION_SUBMITTED` body: "scored {score}/100 on **Room {room}**" | **PATCH body** |
| L316 | Task / Room | Push event `NEEDS_REWORK` body: "**Room {room}** needs attention" + deep link `/tasks/{taskId}` | **REMOVE event** |
| L308 | — | Push event `SHIFT_AVAILABLE` — does not match required name `WORK_REQUEST_AVAILABLE` | **RENAME** |
| L311 | — | Push event `SHIFT_REMINDER` — does not match required name `CHECK_IN_REMINDER` | **RENAME** |
| L314 | — | Push event `VERIFICATION_SUBMITTED` — required name is `QUALITY_VERIFIED` | **RENAME** |
| L368 | Task | Offline strategy row: "Task Detail — Show cached task; queue photo upload" | **REMOVE row** |
| L369 | TaskPhoto | Offline strategy row: "Photo Upload — Store locally, upload on reconnect" | **REMOVE row** |
| L392 | TaskPhoto | Offline `ActionType`: `"PHOTO_UPLOAD"` | **REMOVE value** |
| L408 | Task | Conflict resolution: "Verification/Rating: `task_id` uniqueness constraint" | **PATCH note** |
| L439 | Task | MVP Worker scope: P1 "**Task Detail + Photo Upload**" | **REMOVE row** |
| L452 | Task | Checker MVP: P0 "Assignment Detail — See worker's **photos** + context" | **PATCH description** |
| L502 | Task | Milestone M5: "Ratings screen + **photo upload**" / Screens: "Ratings, **Task Detail**" | **PATCH milestone** |
| L516 | TaskPhoto | Role matrix row: "Upload task photos" | **REMOVE row** |
| L489 | TaskPhoto | MVP dependency: Expo Image Picker — "**Task** photo capture" | **REMOVE dependency** |

**Total violations found: 26**

Missing marketplace events (required but absent from blueprint):
- `ASSIGNMENT_CREATED` — not present
- `CHECK_OUT_REMINDER` — not present
- `ATTENDANCE_VERIFIED` — not present

**Verdict**: Blueprint requires patches across 6 sections. Navigation, state management architecture, and offline infrastructure strategy are structurally sound and require only targeted edits — no redesign needed.

---

## SECTION 2 — Screen Inventory Patch

### 2.1 Worker App

#### Change 1 — Remove "Task Detail" screen

| Field | Content |
|-------|---------|
| **Existing design** | Screen: "Task Detail" · Route: `/tasks/[id]` · Description: "Task description, room info, photo upload" |
| **Problem** | Task, Room, and TaskPhoto are all removed from MVP. This screen has no valid entity to display. |
| **Replacement** | **REMOVED.** No replacement screen. Evidence of work completion is captured through the check-out flow on the Assignment Detail screen, not through a separate task-linked screen. |
| **Impact** | Worker App screen count: 16 → **15**. |

#### Change 2 — Patch "Assignment Detail" description

| Field | Content |
|-------|---------|
| **Existing design** | "Shift info, tasks list, check-in/out controls" |
| **Problem** | "tasks list" implies a Task entity relationship that no longer exists in MVP. |
| **Replacement** | "Shift info, attendance status, check-in/out controls" |
| **Impact** | Description only; no route change. |

#### Change 3 — Patch "Check-Out" description

| Field | Content |
|-------|---------|
| **Existing design** | "Task completion summary, clock-out confirm" |
| **Problem** | "Task completion" references the removed Task entity. |
| **Replacement** | "Assignment completion summary, Attendance record confirm, clock-out confirm" |
| **Impact** | Description only. |

---

### 2.2 Checker App

#### Change 4 — Patch "Assignments Queue" description

| Field | Content |
|-------|---------|
| **Existing design** | "List of completed worker tasks awaiting verification" |
| **Problem** | "worker tasks" implies Task entity. The queue is over WorkerAssignments. |
| **Replacement** | "List of completed WorkerAssignments awaiting quality verification" |
| **Impact** | Description only. |

#### Change 5 — Patch "Assignment Detail" description

| Field | Content |
|-------|---------|
| **Existing design** | "Worker task context, room info, photos submitted by worker" |
| **Problem** | "task context", "room info", and "photos submitted by worker" (TaskPhoto) all reference removed entities. |
| **Replacement** | "Worker assignment context: shift date, hotel, position, attendance timestamps, checker notes" |
| **Impact** | Description only. Checker sees assignment-level data, not room or task-level data. |

---

### 2.3 Patched Screen Inventory

#### Worker App (patched — 15 screens)

| Screen | Route | Description |
|--------|-------|-------------|
| Splash / Onboarding | `/onboarding` | First-launch brand screen |
| Login | `/auth/login` | Email + password login |
| Register | `/auth/register` | Worker self-registration |
| Forgot Password | `/auth/forgot-password` | Password reset via email |
| Home / Dashboard | `/(tabs)/home` | Summary: active assignment, upcoming shifts, rating snapshot |
| Browse Work | `/(tabs)/browse` | List of open WorkRequests filterable by date, hotel, position |
| Work Detail | `/browse/[id]` | Full shift details, apply CTA |
| My Applications | `/(tabs)/applications` | All submitted WorkApplications with status badges |
| Application Detail | `/applications/[id]` | Single WorkApplication timeline |
| My Assignments | `/(tabs)/assignments` | Upcoming + past WorkerAssignments |
| Assignment Detail | `/assignments/[id]` | Shift info, Attendance status, check-in/out controls |
| Check-In | `/assignments/[id]/check-in` | GPS-gated or QR-gated clock-in, creates Attendance record |
| Check-Out | `/assignments/[id]/check-out` | Assignment completion summary, Attendance record confirm, clock-out confirm |
| My Ratings | `/(tabs)/ratings` | Star breakdown, per-assignment history, leaderboard rank |
| Profile | `/(tabs)/profile` | Personal info, documents, contract view |
| Notifications | `/notifications` | Push notification inbox |

**Total: 15 screens** *(was 16; Task Detail removed)*

#### Checker App (patched — 11 screens, descriptions corrected)

| Screen | Route | Description |
|--------|-------|-------------|
| Splash / Onboarding | `/onboarding` | First-launch brand screen |
| Login | `/auth/login` | Email + password login |
| Home / Dashboard | `/(tabs)/home` | Pending verifications count, today's workload summary |
| Assignments Queue | `/(tabs)/assignments` | List of completed WorkerAssignments awaiting quality verification |
| Assignment Detail | `/assignments/[id]` | Worker assignment context: shift, hotel, position, attendance timestamps |
| Quality Verification Form | `/assignments/[id]/verify` | Score slider (0–100), pass/needs-rework toggle, notes |
| Rating Form | `/assignments/[id]/rate` | 1–5 star selector, comment field |
| Verification History | `/(tabs)/history` | Past QualityVerifications with scores and outcomes |
| Leaderboard | `/(tabs)/leaderboard` | Worker ranking by hotel and global |
| Profile | `/(tabs)/profile` | Checker info, hotel assignments |
| Notifications | `/notifications` | Push notification inbox |

**Total: 11 screens** *(count unchanged; descriptions corrected)*

---

## SECTION 3 — Navigation Patch

### 3.1 Worker App Navigation

#### Change 6 — Remove `tasks/[taskId]` route

| Field | Content |
|-------|---------|
| **Existing design** | Under `/assignments/[id]`: child route `tasks/[taskId]` — Stack: Task Detail |
| **Problem** | Task entity removed from MVP. This route is a dead branch. |
| **Replacement** | Route removed. The check-out flow at `check-out` is the terminal point of the assignment execution path. |
| **Impact** | One route removed from the Worker App route tree. |

#### Change 7 — Patch Checker tab badge label

| Field | Content |
|-------|---------|
| **Existing design** | `Assignments: tasks pending verification (unread)` |
| **Problem** | "tasks" implies Task entity. |
| **Replacement** | `Assignments: assignments pending verification (unread)` |
| **Impact** | Label/comment only. |

---

### 3.2 Patched Navigation Trees

#### Worker App (patched)

```
Root Stack (Expo Router)
├── /onboarding                    (no auth required)
├── /auth/login                    (no auth required)
├── /auth/register                 (no auth required)
├── /auth/forgot-password          (no auth required)
└── /(tabs)                        (auth required — protected layout)
    ├── home                       Tab 1 — Dashboard
    ├── browse                     Tab 2 — Browse Work
    │   └── [id]                   Stack: Work Detail
    │       └── (modal) apply      Modal: Apply Confirmation
    ├── applications               Tab 3 — My Applications
    │   └── [id]                   Stack: Application Detail
    ├── assignments                Tab 4 — My Assignments
    │   └── [id]                   Stack: Assignment Detail
    │       ├── check-in           Stack: Check-In (creates Attendance)
    │       └── check-out          Stack: Check-Out (closes Attendance)
    ├── ratings                    Tab 5 — My Ratings
    └── profile                    Tab 6 — Profile
        └── /notifications         Shared stack: Notification Inbox
```

*Removed: `tasks/[taskId]` branch*

#### Checker App (patched — no structural change, badge label corrected)

```
Root Stack (Expo Router)
├── /onboarding                    (no auth required)
├── /auth/login                    (no auth required)
└── /(tabs)                        (auth required — protected layout)
    ├── home                       Tab 1 — Dashboard
    ├── assignments                Tab 2 — Assignments Queue
    │   └── [id]                   Stack: Assignment Detail
    │       ├── verify             Stack: Quality Verification Form
    │       └── rate               Stack: Rating Form
    ├── history                    Tab 3 — Verification History
    ├── leaderboard                Tab 4 — Leaderboard
    └── profile                    Tab 5 — Profile
        └── /notifications         Shared stack: Notification Inbox
```

**Tab badge counts (patched):**
- Assignments: **assignments** pending verification (unread)

---

## SECTION 4 — API Patch

### 4.1 Worker App API

#### Change 8 — Remove Task Detail endpoint

| Field | Content |
|-------|---------|
| **Existing design** | `GET /crm/tasks/:id` — Room + description |
| **Problem** | Task and Room entities removed from MVP. |
| **Replacement** | **Row removed.** No replacement. |
| **Impact** | 1 row removed from Worker API table. |

#### Change 9 — Remove Upload Task Photo endpoint

| Field | Content |
|-------|---------|
| **Existing design** | `POST /crm/tasks/:id/photos` — `multipart/form-data` |
| **Problem** | TaskPhoto entity removed from MVP. |
| **Replacement** | **Row removed.** Evidence upload is out of MVP scope. Post-MVP: evidence can be attached at the WorkerAssignment level if the entity is introduced then. |
| **Impact** | 1 row removed from Worker API table. |

#### Change 10 — Patch Assignment Detail API note

| Field | Content |
|-------|---------|
| **Existing design** | Note: "Includes tasks via WorkRequest → DailyOperation" |
| **Problem** | DailyOperation is a removed entity. The relationship chain is wrong. |
| **Replacement** | Note: "Includes Attendance record via WorkerAssignment; check-in/out timestamps derived from Attendance" |
| **Impact** | Note only. |

#### Change 11 — Align Check-In endpoint

| Field | Content |
|-------|---------|
| **Existing design** | `POST /staffing/assignments/:id/start` — Body: `{ location?, timestamp }` |
| **Problem** | The marketplace model has a dedicated Attendance entity that records check-in. The endpoint and payload must reflect that. |
| **Replacement** | `POST /staffing/assignments/:id/check-in` — Body: `{ location?, checked_in_at }` → creates Attendance record with status `CHECKED_IN` |
| **Impact** | Endpoint path change + payload key rename. Backend must be updated to match. |

#### Change 12 — Align Check-Out endpoint

| Field | Content |
|-------|---------|
| **Existing design** | `POST /staffing/assignments/:id/complete` — Body: `{ timestamp }` |
| **Problem** | "complete" conflates assignment completion with attendance check-out. Attendance is a first-class entity. |
| **Replacement** | `POST /staffing/assignments/:id/check-out` — Body: `{ checked_out_at }` → updates Attendance record with status `CHECKED_OUT`; transitions WorkerAssignment status to `COMPLETED` |
| **Impact** | Endpoint path change + payload key rename. Backend must be updated. |

---

### 4.2 Checker App API

#### Change 13 — Patch Assignments Queue API note

| Field | Content |
|-------|---------|
| **Existing design** | Note: "Tasks awaiting verification" |
| **Problem** | "Tasks" implies Task entity. The queue is WorkerAssignments. |
| **Replacement** | Note: "WorkerAssignments with status=COMPLETED and no QualityVerification record" |
| **Impact** | Note only. |

#### Change 14 — Patch Assignment Detail API note

| Field | Content |
|-------|---------|
| **Existing design** | Note: "Worker info + task photos" |
| **Problem** | "task photos" references TaskPhoto, a removed entity. |
| **Replacement** | Note: "Worker info + Attendance timestamps + WorkRequest context" |
| **Impact** | Note only. |

#### Change 15 — Patch Submit Verification payload

| Field | Content |
|-------|---------|
| **Existing design** | `POST /quality/verifications` — `{ task_id, score, notes, status }` |
| **Problem** | `task_id` references the removed Task entity. QualityVerification must anchor to WorkerAssignment in the marketplace model. |
| **Replacement** | `POST /quality/verifications` — `{ worker_assignment_id, score, notes, status: "verified" \| "needs_rework" }` |
| **Impact** | Payload key change. Backend schema must replace `task_id` FK with `worker_assignment_id` FK on QualityVerification. |

#### Change 16 — Patch Submit Rating payload

| Field | Content |
|-------|---------|
| **Existing design** | `POST /quality/ratings` — `{ task_id, worker_id, score, comment }` |
| **Problem** | `task_id` references the removed Task entity. Rating must anchor to WorkerAssignment. |
| **Replacement** | `POST /quality/ratings` — `{ worker_assignment_id, worker_id, score, comment }` |
| **Impact** | Payload key change. Backend schema must replace `task_id` FK with `worker_assignment_id` FK on Rating. |

---

### 4.3 Patched API Tables

#### Worker App — Screen → Endpoint Map (patched)

| Screen | Method | Endpoint | Notes |
|--------|--------|----------|-------|
| Browse Work | `GET` | `/staffing/work-requests?status=OPEN&date=&position=` | Paginated, filter by hotel/date |
| Work Detail | `GET` | `/staffing/work-requests/:id` | Full WorkRequest + hotel detail |
| Apply | `POST` | `/staffing/work-requests/:id/apply` | Creates WorkApplication *(new endpoint needed)* |
| My Applications | `GET` | `/staffing/applications?worker_id=me` | WorkApplications *(new endpoint needed)* |
| Application Detail | `GET` | `/staffing/applications/:id` | Single WorkApplication |
| My Assignments | `GET` | `/staffing/assignments?worker_id=me` | Filter: upcoming, past WorkerAssignments |
| Assignment Detail | `GET` | `/staffing/assignments/:id` | Includes Attendance record; check-in/out timestamps |
| Check-In | `POST` | `/staffing/assignments/:id/check-in` | Body: `{ location?, checked_in_at }` — creates Attendance |
| Check-Out | `POST` | `/staffing/assignments/:id/check-out` | Body: `{ checked_out_at }` — closes Attendance, completes WorkerAssignment |
| My Ratings | `GET` | `/quality/ratings?worker_id=me` | Per-assignment Rating history |
| Leaderboard rank | `GET` | `/quality/leaderboard` | Global or per-hotel |
| Notifications | `GET` | `/notifications` | *(confirm endpoint)* |

#### Checker App — Screen → Endpoint Map (patched)

| Screen | Method | Endpoint | Notes |
|--------|--------|----------|-------|
| Assignments Queue | `GET` | `/staffing/assignments?status=COMPLETED&verified=false&hotel_id=` | WorkerAssignments without QualityVerification |
| Assignment Detail | `GET` | `/staffing/assignments/:id` | Worker info + Attendance timestamps + WorkRequest context |
| Submit Verification | `POST` | `/quality/verifications` | `{ worker_assignment_id, score, notes, status }` |
| Submit Rating | `POST` | `/quality/ratings` | `{ worker_assignment_id, worker_id, score, comment }` |
| Verification History | `GET` | `/quality/verifications?checker_id=me` | Paginated QualityVerifications |
| Leaderboard | `GET` | `/quality/leaderboard` | Global |
| Hotel Leaderboard | `GET` | `/quality/leaderboard/by-hotel/:hotel_id` | Per-hotel |
| Notifications | `GET` | `/notifications` | — |

#### New Endpoints Required (patched — gap list)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/staffing/work-requests` (worker-scoped) | `GET` | Open WorkRequests visible to WORKER role |
| `/staffing/work-requests/:id/apply` | `POST` | Worker submits WorkApplication |
| `/staffing/applications` | `GET` | List worker's own WorkApplications |
| `/staffing/applications/:id` | `GET` | Single WorkApplication detail |
| `/staffing/assignments/:id/check-in` | `POST` | Create Attendance record (check-in) |
| `/staffing/assignments/:id/check-out` | `POST` | Close Attendance record (check-out) |
| `/quality/verifications?checker_id=me` | `GET` | Checker's own QualityVerification history |
| `/notifications` | `GET` | Notification inbox |
| `/notifications/:id/read` | `PUT` | Mark notification read |

---

## SECTION 5 — Notification Patch

### 5.1 Events to Remove

#### Change 17 — Remove `TASK_READY_FOR_VERIFICATION`

| Field | Content |
|-------|---------|
| **Existing design** | Event: `TASK_READY_FOR_VERIFICATION` · Body: "Room {room} completed by {worker}" · Deep link: `/assignments/{assignmentId}` |
| **Problem** | Event name, body, and trigger are all anchored to the Task/Room model. No Task or Room entity exists in MVP. |
| **Replacement** | Replaced by `ASSIGNMENT_CREATED` — see Section 5.2 additions. The trigger is WorkerAssignment status transition to `COMPLETED`, not task completion. |
| **Impact** | 1 event removed. Checker is now notified via `ASSIGNMENT_CREATED` when a new WorkerAssignment is ready for verification. |

#### Change 18 — Remove `NEEDS_REWORK`

| Field | Content |
|-------|---------|
| **Existing design** | Event: `NEEDS_REWORK` · Body: "Room {room} needs attention — see checker notes" · Deep link: `/tasks/{taskId}` |
| **Problem** | Body references Room. Deep link routes to Task screen (removed). No Task entity exists. Rework logic is out of MVP scope with no Task or Room to re-assign. |
| **Replacement** | **Removed from MVP.** The QualityVerification `status: "needs_rework"` field is preserved in the data model for post-MVP rework flows. Push notification deferred until rework screens are designed. |
| **Impact** | 1 event removed. No immediate replacement. |

### 5.2 Events to Rename

#### Change 19 — Rename `SHIFT_AVAILABLE` → `WORK_REQUEST_AVAILABLE`

| Field | Content |
|-------|---------|
| **Existing design** | `SHIFT_AVAILABLE` |
| **Problem** | Name does not match the canonical marketplace entity `WorkRequest`. |
| **Replacement** | `WORK_REQUEST_AVAILABLE` |
| **Impact** | Event name change. Deep link unchanged: `/browse/{workRequestId}`. |

#### Change 20 — Rename `SHIFT_REMINDER` → `CHECK_IN_REMINDER`

| Field | Content |
|-------|---------|
| **Existing design** | `SHIFT_REMINDER` · Body: "{position} at {hotel} — check in when you arrive" |
| **Problem** | Name does not match required marketplace event catalogue. |
| **Replacement** | `CHECK_IN_REMINDER` · Body unchanged (already correct intent) |
| **Impact** | Event name change only. |

#### Change 21 — Rename `VERIFICATION_SUBMITTED` → `QUALITY_VERIFIED`

| Field | Content |
|-------|---------|
| **Existing design** | `VERIFICATION_SUBMITTED` · Body: "You scored {score}/100 on Room {room}" |
| **Problem** | Event name does not match required catalogue. Body references Room entity. |
| **Replacement** | `QUALITY_VERIFIED` · Body: "You scored {score}/100 for your shift at {hotel} on {date}" |
| **Impact** | Event name change + body copy change. |

### 5.3 Events to Add

#### Change 22 — Add `ASSIGNMENT_CREATED`

| Field | Content |
|-------|---------|
| **Existing design** | Not present |
| **Problem** | Checkers have no notification when a new WorkerAssignment is ready for verification. This is the marketplace trigger replacing `TASK_READY_FOR_VERIFICATION`. |
| **Replacement** | New event: `ASSIGNMENT_CREATED` · Recipient: Checkers at the relevant hotel · Title: "Assignment Ready for Review" · Body: "{worker} completed their shift at {hotel}" · Deep link: `/assignments/{assignmentId}` |
| **Impact** | New event added. |

#### Change 23 — Add `CHECK_OUT_REMINDER`

| Field | Content |
|-------|---------|
| **Existing design** | Not present |
| **Problem** | Required by marketplace event catalogue. Workers with an open Attendance record (checked in but not checked out) near their shift end time need a prompt. |
| **Replacement** | New event: `CHECK_OUT_REMINDER` · Recipient: Worker with active Attendance · Title: "Don't Forget to Check Out" · Body: "Your shift at {hotel} ends at {shift_end_time} — tap to check out" · Deep link: `/assignments/{assignmentId}/check-out` |
| **Impact** | New event added. Requires scheduled job on backend (fire N minutes before `shift_end_time`). |

#### Change 24 — Add `ATTENDANCE_VERIFIED`

| Field | Content |
|-------|---------|
| **Existing design** | Not present |
| **Problem** | Required by marketplace event catalogue. Worker needs confirmation that their Attendance record (check-in/out) has been accepted. |
| **Replacement** | New event: `ATTENDANCE_VERIFIED` · Recipient: Worker · Title: "Attendance Confirmed" · Body: "Your attendance for {hotel} on {date} has been recorded" · Deep link: `/assignments/{assignmentId}` |
| **Impact** | New event added. Triggered when Attendance record is marked verified by system or manager. |

### 5.4 Patch `APPLICATION_REJECTED` deep link

#### Change 25 — Minor body patch on `APPLICATION_REJECTED`

| Field | Content |
|-------|---------|
| **Existing design** | Body: "The {date} shift at {hotel} has been filled" |
| **Problem** | Body implies rejection reason is always "filled" — could also be cancelled or declined directly. |
| **Replacement** | Body: "Your application for {hotel} on {date} was not accepted" |
| **Impact** | Body copy only. |

---

### 5.5 Patched Notification Event Table

| Event | Recipient | Title | Body | Deep Link |
|-------|-----------|-------|------|-----------|
| `WORK_REQUEST_AVAILABLE` | Workers (matching position) | "New Shift Available" | "{position} at {hotel} on {date}" | `/browse/{workRequestId}` |
| `APPLICATION_ACCEPTED` | Worker | "Application Accepted" | "You're confirmed for {hotel} on {date}" | `/assignments/{assignmentId}` |
| `APPLICATION_REJECTED` | Worker | "Update on Your Application" | "Your application for {hotel} on {date} was not accepted" | `/applications/{applicationId}` |
| `ASSIGNMENT_CREATED` | Checkers at hotel | "Assignment Ready for Review" | "{worker} completed their shift at {hotel}" | `/assignments/{assignmentId}` |
| `CHECK_IN_REMINDER` | Assigned worker | "Shift in 1 Hour" | "{position} at {hotel} — check in when you arrive" | `/assignments/{assignmentId}/check-in` |
| `CHECK_OUT_REMINDER` | Worker (active Attendance) | "Don't Forget to Check Out" | "Your shift at {hotel} ends at {shift_end_time} — tap to check out" | `/assignments/{assignmentId}/check-out` |
| `ATTENDANCE_VERIFIED` | Worker | "Attendance Confirmed" | "Your attendance for {hotel} on {date} has been recorded" | `/assignments/{assignmentId}` |
| `QUALITY_VERIFIED` | Worker | "Your Work Was Reviewed" | "You scored {score}/100 for your shift at {hotel} on {date}" | `/ratings` |
| `RATING_RECEIVED` | Worker | "New Rating" | "{checker} rated your work {stars}★ at {hotel}" | `/ratings` |

**Removed**: `SHIFT_AVAILABLE`, `SHIFT_REMINDER`, `TASK_READY_FOR_VERIFICATION`, `VERIFICATION_SUBMITTED`, `NEEDS_REWORK`
**Added**: `ASSIGNMENT_CREATED`, `CHECK_OUT_REMINDER`, `ATTENDANCE_VERIFIED`
**Renamed**: `SHIFT_AVAILABLE` → `WORK_REQUEST_AVAILABLE`, `SHIFT_REMINDER` → `CHECK_IN_REMINDER`, `VERIFICATION_SUBMITTED` → `QUALITY_VERIFIED`

---

## SECTION 6 — Offline Queue Patch

### 6.1 Strategy Table

#### Change 26 — Remove "Task Detail" offline row

| Field | Content |
|-------|---------|
| **Existing design** | Row: "Task Detail — Cache-first — Show cached task; queue photo upload" |
| **Problem** | Task screen removed from MVP. |
| **Replacement** | **Row removed.** |
| **Impact** | 1 row removed from offline strategy table. |

#### Change 27 — Remove "Photo Upload" offline row

| Field | Content |
|-------|---------|
| **Existing design** | Row: "Photo Upload — Queue — Store locally, upload on reconnect" |
| **Problem** | TaskPhoto entity removed from MVP. No photo upload action exists. |
| **Replacement** | **Row removed.** |
| **Impact** | 1 row removed from offline strategy table. |

### 6.2 ActionType Enum

#### Change 28 — Remove `PHOTO_UPLOAD` from ActionType

| Field | Content |
|-------|---------|
| **Existing design** | `type ActionType = "CHECK_IN" \| "CHECK_OUT" \| "PHOTO_UPLOAD" \| "VERIFICATION_SUBMIT" \| "RATING_SUBMIT" \| "APPLY_TO_SHIFT"` |
| **Problem** | `PHOTO_UPLOAD` only existed to support TaskPhoto upload. Entity removed. |
| **Replacement** | `type ActionType = "CHECK_IN" \| "CHECK_OUT" \| "VERIFICATION_SUBMIT" \| "RATING_SUBMIT" \| "APPLY_TO_SHIFT"` |
| **Impact** | Enum narrowed by 1 value. |

### 6.3 Conflict Resolution

#### Change 29 — Patch conflict resolution note

| Field | Content |
|-------|---------|
| **Existing design** | "Verification/Rating: `task_id` uniqueness constraint — same safe behaviour" |
| **Problem** | `task_id` removed. Uniqueness constraint now sits on `worker_assignment_id`. |
| **Replacement** | "Verification/Rating: `worker_assignment_id` uniqueness constraint on QualityVerification and Rating — server rejects duplicate, client silently discards 409 error" |
| **Impact** | Comment only. Backend constraint target updated. |

---

### 6.4 Patched Offline Strategy Table

| Screen | Strategy | Offline Behaviour |
|--------|----------|--------------------|
| Browse Work | Cache-first (SWR) | Show stale data with "last updated" label |
| Work Detail | Cache-first | Show cached; disable Apply if offline |
| My Assignments | Cache-first | Show cached WorkerAssignments list |
| Assignment Detail | Cache-first | Show cached; queue check-in/out |
| **Check-In** | **Queue + retry** | Accept action, store in `offlineStore`, sync on reconnect |
| **Check-Out** | **Queue + retry** | Same as check-in |
| Checker Queue | Cache-first | Show stale queue with label |
| **Verification Submit** | **Queue + retry** | Store draft in `verificationStore`, auto-submit on reconnect |
| **Rating Submit** | **Queue + retry** | Same as verification |
| Leaderboard | Cache-first | Show stale; no stale label needed |

### 6.5 Patched ActionType

```ts
type ActionType =
  | "CHECK_IN"
  | "CHECK_OUT"
  | "VERIFICATION_SUBMIT"
  | "RATING_SUBMIT"
  | "APPLY_TO_SHIFT"
```

### 6.6 Patched Conflict Resolution

```
Check-in/out: idempotent — server rejects duplicate, client silently discards error
Verification/Rating: worker_assignment_id uniqueness constraint — server returns 409 on
  duplicate, client silently discards; draft cleared from verificationStore
```

---

## SECTION 7 — MVP Scope Patch

### 7.1 Worker App MVP Scope

#### Change 30 — Remove "Task Detail + Photo Upload" from Worker MVP

| Field | Content |
|-------|---------|
| **Existing design** | P1: "Task Detail + Photo Upload — Work quality evidence" |
| **Problem** | Task and TaskPhoto removed from MVP. This row has no corresponding entity. |
| **Replacement** | **Row removed.** Work quality evidence is expressed through QualityVerification score and Rating, not photo uploads. |
| **Impact** | Worker MVP P1 items reduced by 1. |

#### Change 31 — Patch Milestone M5

| Field | Content |
|-------|---------|
| **Existing design** | M5: "Ratings screen + photo upload" / Screens: "Ratings, Task Detail" |
| **Problem** | "photo upload" and "Task Detail" reference removed entities. |
| **Replacement** | M5: "Ratings screen + leaderboard" / Screens: "Ratings, Leaderboard" |
| **Impact** | Milestone description updated. No new screens added; leaderboard was already P2. |

#### Change 32 — Remove "Upload task photos" from role matrix

| Field | Content |
|-------|---------|
| **Existing design** | Role matrix row: "Upload task photos — WORKER: ✅" |
| **Problem** | TaskPhoto removed from MVP. |
| **Replacement** | **Row removed.** |
| **Impact** | 1 row removed from role matrix. |

### 7.2 Technical Dependencies

#### Change 33 — Remove Expo Image Picker dependency

| Field | Content |
|-------|---------|
| **Existing design** | Dependency: `expo-image-picker` — "Task photo capture" |
| **Problem** | TaskPhoto removed from MVP. No photo capture flow exists. |
| **Replacement** | **Dependency removed from MVP list.** Post-MVP note: re-introduce when evidence capture is scoped against WorkerAssignment or a new Evidence entity. |
| **Impact** | 1 dependency removed from MVP technical dependencies table. |

---

### 7.3 Patched Worker App MVP Screens

| Priority | Screen | Rationale |
|----------|--------|-----------|
| P0 | Login | Required to access anything |
| P0 | Browse Work | Core discovery flow — WorkRequest listing |
| P0 | Work Detail + Apply | Core conversion — WorkApplication creation |
| P0 | My Assignments | Worker must see confirmed WorkerAssignments |
| P0 | Assignment Detail | Context for check-in; Attendance status |
| P0 | Check-In | Creates Attendance record |
| P0 | Check-Out | Closes Attendance record; completes WorkerAssignment |
| P1 | My Applications | Transparency on WorkApplication status |
| P1 | My Ratings | Motivation + feedback loop via Rating entity |
| P2 | Profile | Account management |
| P2 | Register | Self-serve onboarding |
| Post-MVP | Forgot Password | Handle via email link |
| Post-MVP | Notifications Inbox | Push banners cover MVP need |

### 7.4 Patched Checker App MVP Screens

| Priority | Screen | Rationale |
|----------|--------|-----------|
| P0 | Login | Required |
| P0 | Assignments Queue | Core checker function — completed WorkerAssignments |
| P0 | Assignment Detail | WorkerAssignment context: Attendance timestamps, worker, hotel, position |
| P0 | Quality Verification Form | Creates QualityVerification anchored to worker_assignment_id |
| P0 | Rating Form | Creates Rating anchored to worker_assignment_id |
| P1 | Verification History | QualityVerification self-review for checker |
| P2 | Leaderboard | Motivational; not critical |
| Post-MVP | Notifications Inbox | Push banners sufficient |
| Post-MVP | Profile | Not blocking core flow |

### 7.5 Patched Backend Work Required

| Item | Effort | Notes |
|------|--------|-------|
| `GET /staffing/work-requests` scoped to WORKER role | S | — |
| `POST /staffing/work-requests/:id/apply` | S | Creates WorkApplication |
| `GET /staffing/applications` (worker-scoped) | S | — |
| Implement `StaffingService` stubs | L | — |
| Implement `QualityService` stubs | M | **Replace `task_id` FK with `worker_assignment_id`** |
| `POST /staffing/assignments/:id/check-in` | S | **Replaces `/start`; creates Attendance record** |
| `POST /staffing/assignments/:id/check-out` | S | **Replaces `/complete`; closes Attendance record** |
| Push token field on User model + migration | S | — |
| `POST /notifications/push` internal service | M | **Add `CHECK_OUT_REMINDER` scheduler** |
| `GET /notifications` inbox endpoint | S | — |
| **Replace `task_id` FK with `worker_assignment_id` on QualityVerification** | S | Schema migration required |
| **Replace `task_id` FK with `worker_assignment_id` on Rating** | S | Schema migration required |

### 7.6 Patched MVP Technical Dependencies

| Dependency | Package | Used For |
|------------|---------|---------|
| Expo Router | `expo-router` | File-based navigation (already installed) |
| Zustand | `zustand` | Global state (already installed) |
| SWR | `swr` | Data fetching (already installed) |
| Expo Notifications | `expo-notifications` | Push token + handling |
| NetInfo | `@react-native-community/netinfo` | Online/offline detection |
| AsyncStorage | `@react-native-async-storage/async-storage` | Offline queue + SWR cache |
| Expo Secure Store | `expo-secure-store` | Auth token storage |
| Expo Location | `expo-location` | GPS check-in (optional P1) |

*Removed: `expo-image-picker` (no TaskPhoto in MVP)*

### 7.7 Patched Milestone Plan

| Milestone | Deliverable | Screens |
|-----------|-------------|---------|
| **M1 — Auth Shell** | Login, protected routing, token storage | Login (both apps) |
| **M2 — Worker Browse** | WorkRequest listing + detail + WorkApplication submit | Browse, Work Detail |
| **M3 — Worker Execute** | WorkerAssignment list, Attendance check-in, Attendance check-out | Assignments, Check-In, Check-Out |
| **M4 — Checker Core** | Queue of completed WorkerAssignments, verify (QualityVerification), rate (Rating) | Assignments Queue, Verification Form, Rating Form |
| **M5 — Feedback Loop** | Ratings screen + leaderboard | Ratings, Leaderboard |
| **M6 — Push + Offline** | All 9 notification events wired, offline queue (5 action types) | All screens + infrastructure |
| **M7 — Polish** | Empty states, error boundaries, loading skeletons, dark mode | All screens |

### 7.8 Patched Role-to-Feature Matrix

| Feature | WORKER | CHECKER | MANAGER | ADMIN |
|---------|--------|---------|---------|-------|
| Browse open WorkRequests | ✅ | — | — | — |
| Submit WorkApplication | ✅ | — | — | — |
| View own WorkApplications | ✅ | — | — | — |
| View own WorkerAssignments | ✅ | — | — | — |
| Check-in (create Attendance) | ✅ | — | — | — |
| Check-out (close Attendance) | ✅ | — | — | — |
| View own Ratings | ✅ | — | — | — |
| View completed assignments queue | — | ✅ | — | — |
| Submit QualityVerification | — | ✅ | — | — |
| Submit Rating | — | ✅ | — | — |
| View leaderboard | ✅ | ✅ | ✅ | ✅ |
| Create WorkRequests | — | — | ✅ | ✅ |
| Assign workers (WorkerAssignment) | — | — | ✅ | ✅ |

---

## SECTION 8 — Final Assessment

### 8.1 Change Summary

| Section | Changes Applied |
|---------|----------------|
| Screen Inventory | 5 changes (1 screen removed, 4 descriptions patched) |
| Navigation | 2 changes (1 route removed, 1 badge label patched) |
| API Integration Map | 9 changes (2 rows removed, 5 payloads/notes patched, 2 endpoint paths renamed) |
| Push Notifications | 9 changes (2 events removed, 3 renamed, 3 added, 1 body patched) |
| Offline Queue | 4 changes (2 rows removed, 1 enum value removed, 1 note patched) |
| MVP Scope | 4 changes (1 screen removed, 1 milestone patched, 1 dependency removed, 1 matrix row removed) |
| **Total** | **34 changes** |

### 8.2 Entity Coverage Confirmation

| Marketplace Entity | Represented in Blueprint |
|-------------------|--------------------------|
| Hotel | ✅ — filter param on WorkRequest listing |
| HotelWorker | ✅ — implicit via worker role + hotel_id scoping |
| WorkRequest | ✅ — Browse, Work Detail, apply endpoint |
| WorkApplication | ✅ — My Applications, Application Detail, apply endpoint |
| WorkerAssignment | ✅ — My Assignments, Assignment Detail, checker queue |
| Attendance | ✅ — Check-In/Check-Out screens and endpoints |
| QualityVerification | ✅ — Verification Form, history, payload patched to `worker_assignment_id` |
| Rating | ✅ — Rating Form, My Ratings, payload patched to `worker_assignment_id` |

### 8.3 Banned Entity Confirmation

| Removed Entity | Still Present | Notes |
|---------------|---------------|-------|
| Room | ✅ No | All references purged |
| Task | ✅ No | Screen removed, all API rows removed, all body copy patched |
| TaskPhoto | ✅ No | Upload endpoint removed, ActionType value removed, dependency removed |
| DailyOperation | ✅ No | API note patched |

### 8.4 Marketplace Workflow Coverage

**Worker loop:**
Browse WorkRequests → Apply (WorkApplication) → Confirmed (WorkerAssignment) → Check-In (Attendance) → Check-Out (Attendance closed) → Rated (Rating + QualityVerification visible on Ratings screen)
→ **Fully covered by patched blueprint**

**Checker loop:**
View completed WorkerAssignments → Review assignment context + Attendance timestamps → Submit QualityVerification → Submit Rating
→ **Fully covered by patched blueprint**

### 8.5 Structural Integrity

Navigation architecture, Zustand store design, SWR fetch key pattern, offline queue infrastructure, and push implementation approach are **all structurally sound** and required no redesign — only targeted content patches.

---

## STATUS

```
APPROVED_WITH_PATCHES
```

**34 targeted changes applied across 6 sections.**
All Task, Room, TaskPhoto, and DailyOperation references are eliminated.
Blueprint now correctly represents the Hotel → HotelWorker → WorkRequest → WorkApplication → WorkerAssignment → Attendance → QualityVerification → Rating marketplace chain end-to-end.

Apply all patches in `SECTION 2` through `SECTION 7` to `MOBILE_PRODUCT_BLUEPRINT.md` to produce the aligned v2 blueprint.
