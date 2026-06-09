# Mobile Product Blueprint
## Hotel CRM — Worker App & Checker App

---

## 1. Screen Inventory

### 1.1 Worker App

| Screen | Route | Description |
|--------|-------|-------------|
| Splash / Onboarding | `/onboarding` | First-launch brand screen |
| Login | `/auth/login` | Email + password login |
| Register | `/auth/register` | Worker self-registration |
| Forgot Password | `/auth/forgot-password` | Password reset via email |
| Home / Dashboard | `/(tabs)/home` | Summary: active assignment, upcoming shifts, rating snapshot |
| Browse Work | `/(tabs)/browse` | List of open WorkRequests filterable by date, hotel, position |
| Work Detail | `/browse/[id]` | Full shift details, apply CTA |
| My Applications | `/(tabs)/applications` | All submitted applications with status badges |
| Application Detail | `/applications/[id]` | Single application timeline |
| My Assignments | `/(tabs)/assignments` | Upcoming + past assignments |
| Assignment Detail | `/assignments/[id]` | Shift info, tasks list, check-in/out controls |
| Check-In | `/assignments/[id]/check-in` | GPS-gated or QR-gated clock-in |
| Check-Out | `/assignments/[id]/check-out` | Task completion summary, clock-out confirm |
| Task Detail | `/tasks/[id]` | Task description, room info, photo upload |
| My Ratings | `/(tabs)/ratings` | Star breakdown, per-shift history, leaderboard rank |
| Profile | `/(tabs)/profile` | Personal info, documents, contract view |
| Notifications | `/notifications` | Push notification inbox |

**Total: 16 screens**

---

### 1.2 Checker App

| Screen | Route | Description |
|--------|-------|-------------|
| Splash / Onboarding | `/onboarding` | First-launch brand screen |
| Login | `/auth/login` | Email + password login |
| Home / Dashboard | `/(tabs)/home` | Pending verifications count, today's workload summary |
| Assignments Queue | `/(tabs)/assignments` | List of completed worker tasks awaiting verification |
| Assignment Detail | `/assignments/[id]` | Worker task context, room info, photos submitted by worker |
| Quality Verification Form | `/assignments/[id]/verify` | Score slider (0–100), pass/needs-rework toggle, notes |
| Rating Form | `/assignments/[id]/rate` | 1–5 star selector, comment field |
| Verification History | `/(tabs)/history` | Past verifications with scores and outcomes |
| Leaderboard | `/(tabs)/leaderboard` | Worker ranking by hotel and global |
| Profile | `/(tabs)/profile` | Checker info, hotel assignments |
| Notifications | `/notifications` | Push notification inbox |

**Total: 11 screens**

---

## 2. Navigation Structure

### 2.1 Worker App

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
    │       ├── check-in           Stack: Check-In
    │       ├── check-out          Stack: Check-Out
    │       └── tasks/[taskId]     Stack: Task Detail
    ├── ratings                    Tab 5 — My Ratings
    └── profile                    Tab 6 — Profile
        └── /notifications         Shared stack: Notification Inbox
```

**Bottom tabs (6):** Home · Browse · Applications · Assignments · Ratings · Profile

**Tab badge counts:**
- Browse: open shifts available today
- Applications: pending applications
- Assignments: today's active assignments
- Profile: unread notification count

---

### 2.2 Checker App

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

**Bottom tabs (5):** Home · Assignments · History · Leaderboard · Profile

**Tab badge counts:**
- Assignments: tasks pending verification (unread)

---

## 3. API Integration Map

### Base URL
```
https://<api-host>/api/v1
```

All authenticated requests include: `Authorization: Bearer <access_token>`

---

### 3.1 Auth Endpoints

| Action | Method | Endpoint | Payload / Params |
|--------|--------|----------|-----------------|
| Login | `POST` | `/auth/login` | `{ email, password }` |
| Register | `POST` | `/auth/signup` | `{ email, password, name, role: "WORKER" }` |
| Refresh token | `POST` | `/auth/refresh` | `{ refresh_token }` |
| Logout | `POST` | `/auth/logout` | — |
| Get profile | `GET` | `/auth/me` | — |
| Update profile | `PUT` | `/auth/profile` | `{ name, phone, ... }` |

---

### 3.2 Worker App — Screen → Endpoint Map

| Screen | Method | Endpoint | Notes |
|--------|--------|----------|-------|
| Browse Work | `GET` | `/staffing/work-requests?status=OPEN&date=&position=` | Paginated, filter by hotel/date |
| Work Detail | `GET` | `/staffing/work-requests/:id` | Full shift + hotel detail |
| Apply | `POST` | `/staffing/work-requests/:id/apply` | Worker self-apply *(new endpoint needed)* |
| My Applications | `GET` | `/staffing/applications?worker_id=me` | *(new endpoint needed)* |
| Application Detail | `GET` | `/staffing/applications/:id` | — |
| My Assignments | `GET` | `/staffing/assignments?worker_id=me` | Filter: upcoming, past |
| Assignment Detail | `GET` | `/staffing/assignments/:id` | Includes tasks via WorkRequest → DailyOperation |
| Check-In | `POST` | `/staffing/assignments/:id/start` | Body: `{ location?, timestamp }` |
| Check-Out | `POST` | `/staffing/assignments/:id/complete` | Body: `{ timestamp }` |
| Task Detail | `GET` | `/crm/tasks/:id` | Room + description |
| Upload Task Photo | `POST` | `/crm/tasks/:id/photos` | `multipart/form-data` |
| My Ratings | `GET` | `/quality/ratings?worker_id=me` | Star history |
| Leaderboard rank | `GET` | `/quality/leaderboard` | Global or per-hotel |
| Notifications | `GET` | `/notifications` | *(confirm endpoint)* |

---

### 3.3 Checker App — Screen → Endpoint Map

| Screen | Method | Endpoint | Notes |
|--------|--------|----------|-------|
| Assignments Queue | `GET` | `/staffing/assignments?status=COMPLETED&verified=false&hotel_id=` | Tasks awaiting verification |
| Assignment Detail | `GET` | `/staffing/assignments/:id` | Worker info + task photos |
| Submit Verification | `POST` | `/quality/verifications` | `{ task_id, score, notes, status }` |
| Submit Rating | `POST` | `/quality/ratings` | `{ task_id, worker_id, score, comment }` |
| Verification History | `GET` | `/quality/verifications?checker_id=me` | Paginated |
| Leaderboard | `GET` | `/quality/leaderboard` | Global |
| Hotel Leaderboard | `GET` | `/quality/leaderboard/by-hotel/:hotel_id` | Per-hotel |
| Notifications | `GET` | `/notifications` | — |

---

### 3.4 New Endpoints Required (Backend Gap)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/staffing/work-requests/:id/apply` | `POST` | Worker self-applies to open shift |
| `/staffing/applications` | `GET` | List worker's own applications |
| `/staffing/applications/:id` | `GET` | Single application detail |
| `/staffing/work-requests` (worker-scoped) | `GET` | Open shifts visible to a worker role |
| `/quality/verifications?checker_id=me` | `GET` | Checker's own history |
| `/notifications` | `GET` | Notification inbox |
| `/notifications/:id/read` | `PUT` | Mark notification read |

---

## 4. State Management Design

Both apps use **Zustand** for global state and **SWR** for server-side data.

### 4.1 Store Slices

#### `authStore` (both apps)
```ts
interface AuthStore {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  // actions
  login(credentials): Promise<void>
  logout(): void
  refreshSession(): Promise<void>
  updateProfile(data): Promise<void>
}
```

#### `assignmentStore` (Worker App)
```ts
interface AssignmentStore {
  activeAssignment: WorkerAssignment | null
  checkInTime: Date | null
  checkOutTime: Date | null
  // actions
  setActive(assignment): void
  checkIn(assignmentId, location?): Promise<void>
  checkOut(assignmentId): Promise<void>
  clearActive(): void
}
```

#### `applicationStore` (Worker App)
```ts
interface ApplicationStore {
  pendingApplicationIds: string[]  // optimistic tracking
  addApplication(workRequestId): void
  removeApplication(workRequestId): void
}
```

#### `verificationStore` (Checker App)
```ts
interface VerificationStore {
  draftVerifications: Record<string, DraftVerification>  // keyed by assignment id
  saveDraft(assignmentId, data): void
  clearDraft(assignmentId): void
}

interface DraftVerification {
  score: number
  notes: string
  status: "verified" | "needs_rework"
  savedAt: Date
}
```

#### `notificationStore` (both apps)
```ts
interface NotificationStore {
  unreadCount: number
  notifications: Notification[]
  markRead(id): void
  markAllRead(): void
  setUnreadCount(n): void
}
```

#### `offlineStore` (both apps)
```ts
interface OfflineStore {
  isOnline: boolean
  pendingActions: PendingAction[]
  enqueue(action): void
  flush(): Promise<void>
  remove(actionId): void
}
```

---

### 4.2 SWR Fetch Keys & Patterns

```ts
// Shared key factory
const keys = {
  me:              () => "/auth/me",
  workRequests:    (filters) => ["/staffing/work-requests", filters],
  assignment:      (id) => `/staffing/assignments/${id}`,
  myAssignments:   (status) => ["/staffing/assignments", { worker_id: "me", status }],
  myApplications:  () => "/staffing/applications",
  myRatings:       () => "/quality/ratings?worker_id=me",
  leaderboard:     (hotelId?) => hotelId
                     ? `/quality/leaderboard/by-hotel/${hotelId}`
                     : "/quality/leaderboard",
  pendingQueue:    (hotelId) => ["/staffing/assignments",
                     { status: "COMPLETED", verified: false, hotel_id: hotelId }],
  notifications:   () => "/notifications",
}
```

**SWR config defaults:**
- `refreshInterval`: 30 000 ms (browse/queue screens)
- `revalidateOnFocus`: true
- `shouldRetryOnError`: true, max 3 retries
- `errorRetryInterval`: 5 000 ms

---

## 5. Push Notification Design

### 5.1 Notification Types

| Event | Recipient | Title | Body | Deep Link |
|-------|-----------|-------|------|-----------|
| `SHIFT_AVAILABLE` | Workers matching position/location | "New Shift Available" | "{position} at {hotel} on {date}" | `/browse/{workRequestId}` |
| `APPLICATION_ACCEPTED` | Worker | "Application Accepted" | "You're confirmed for {hotel} on {date}" | `/assignments/{assignmentId}` |
| `APPLICATION_REJECTED` | Worker | "Update on Your Application" | "The {date} shift at {hotel} has been filled" | `/applications/{applicationId}` |
| `SHIFT_REMINDER` | Assigned worker | "Shift in 1 Hour" | "{position} at {hotel} — check in when you arrive" | `/assignments/{assignmentId}/check-in` |
| `SHIFT_CANCELLED` | Assigned worker | "Shift Cancelled" | "Your {date} shift at {hotel} has been cancelled" | `/assignments` |
| `TASK_READY_FOR_VERIFICATION` | Checkers at hotel | "Task Ready to Verify" | "Room {room} completed by {worker}" | `/assignments/{assignmentId}` |
| `VERIFICATION_SUBMITTED` | Worker | "Your Work Was Reviewed" | "You scored {score}/100 on Room {room}" | `/ratings` |
| `RATING_RECEIVED` | Worker | "New Rating" | "{checker} rated your work {stars}★ at {hotel}" | `/ratings` |
| `NEEDS_REWORK` | Worker | "Rework Requested" | "Room {room} needs attention — see checker notes" | `/tasks/{taskId}` |

---

### 5.2 Implementation

**Service**: Expo Notifications (`expo-notifications`) + backend push service

**Token registration flow:**
```
App launch → request permission → get Expo push token
→ POST /auth/profile { expo_push_token }  ← store on User model
```

**Backend delivery:**
- On relevant events in service layer, enqueue push via `NotificationService`
- Payload: `{ to, title, body, data: { type, entityId } }`
- Use Expo Push API: `https://exp.host/--/api/v2/push/send`

**Foreground handling:**
- Use `addNotificationReceivedListener` to show in-app toast (via `react-native-toast-message` or custom)
- Increment `notificationStore.unreadCount`

**Background / tap handling:**
- Use `addNotificationResponseReceivedListener`
- Parse `data.type` + `data.entityId` → navigate to deep link via Expo Router

**Badge count:**
- Sync `unreadCount` from server on app foreground
- Clear badge on notification inbox open

**Required schema change:**
```prisma
// Add to User model
expo_push_token  String?
push_enabled     Boolean @default(true)
```

---

## 6. Offline Handling

### 6.1 Strategy by Screen

| Screen | Strategy | Offline Behaviour |
|--------|----------|--------------------|
| Browse Work | Cache-first (SWR) | Show stale data with "last updated" label |
| Work Detail | Cache-first | Show cached; disable Apply if offline |
| My Assignments | Cache-first | Show cached assignments list |
| Assignment Detail | Cache-first | Show cached; queue check-in/out |
| **Check-In** | **Queue + retry** | Accept action, store in `offlineStore`, sync on reconnect |
| **Check-Out** | **Queue + retry** | Same as check-in |
| Task Detail | Cache-first | Show cached task; queue photo upload |
| Photo Upload | Queue | Store locally, upload on reconnect |
| Checker Queue | Cache-first | Show stale queue with label |
| **Verification Submit** | **Queue + retry** | Store draft in `verificationStore`, auto-submit on reconnect |
| **Rating Submit** | **Queue + retry** | Same as verification |
| Leaderboard | Cache-first | Show stale; no stale label needed |

---

### 6.2 Offline Queue Implementation

```ts
interface PendingAction {
  id: string           // uuid
  type: ActionType
  payload: object
  endpoint: string
  method: "POST" | "PUT" | "PATCH"
  createdAt: Date
  retryCount: number
}

type ActionType =
  | "CHECK_IN"
  | "CHECK_OUT"
  | "PHOTO_UPLOAD"
  | "VERIFICATION_SUBMIT"
  | "RATING_SUBMIT"
  | "APPLY_TO_SHIFT"
```

**Storage**: `expo-secure-store` for auth tokens; `AsyncStorage` (via `@react-native-async-storage/async-storage`) for offline queue and SWR cache.

**Flush trigger:**
- `NetInfo.addEventListener` (from `@react-native-community/netinfo`) — on `isConnected: true` → call `offlineStore.flush()`
- App foreground event (`AppState.addEventListener("change", ...)`)

**Conflict resolution:**
- Check-in/out: idempotent — server rejects duplicate, client silently discards error
- Verification/Rating: `task_id` uniqueness constraint — same safe behaviour
- Photo upload: retry up to 5 times; on permanent failure, surface error in-app

**User feedback:**
- Offline banner (top of screen) when `isOnline === false`
- "Saved offline — will sync when connected" toast on queued actions
- "Synced" toast when flush succeeds

---

## 7. MVP Scope

### 7.1 MVP Definition

MVP delivers the core marketplace loop end-to-end: a worker finds a shift, checks in and out, and a checker verifies the work.

---

### 7.2 Worker App MVP — Included Screens

| Priority | Screen | Rationale |
|----------|--------|-----------|
| P0 | Login | Required to access anything |
| P0 | Browse Work | Core discovery flow |
| P0 | Work Detail + Apply | Core conversion action |
| P0 | My Assignments | Worker must see confirmed shifts |
| P0 | Assignment Detail | Context for check-in |
| P0 | Check-In | Core time-tracking action |
| P0 | Check-Out | Core time-tracking action |
| P1 | My Applications | Transparency on application status |
| P1 | My Ratings | Motivation + feedback loop |
| P1 | Task Detail + Photo Upload | Work quality evidence |
| P2 | Profile | Account management |
| P2 | Register | Self-serve onboarding |
| Post-MVP | Forgot Password | Nice-to-have, handle via email |
| Post-MVP | Notifications Inbox | Push banners cover MVP need |

---

### 7.3 Checker App MVP — Included Screens

| Priority | Screen | Rationale |
|----------|--------|-----------|
| P0 | Login | Required |
| P0 | Assignments Queue | Core checker function |
| P0 | Assignment Detail | See worker's photos + context |
| P0 | Quality Verification Form | Core submit action |
| P0 | Rating Form | Closes the feedback loop |
| P1 | Verification History | Self-review for checker |
| P2 | Leaderboard | Motivational, not critical |
| Post-MVP | Notifications Inbox | Push banners sufficient |
| Post-MVP | Profile | Not blocking core flow |

---

### 7.4 MVP Backend Work Required

| Item | Effort |
|------|--------|
| `GET /staffing/work-requests` scoped to WORKER role | S |
| `POST /staffing/work-requests/:id/apply` | S |
| `GET /staffing/applications` (worker-scoped) | S |
| Implement `StaffingService` stubs (currently `NotImplemented`) | L |
| Implement `QualityService` stubs | M |
| Push token field on User model + migration | S |
| `POST /notifications/push` internal service | M |
| `GET /notifications` inbox endpoint | S |

---

### 7.5 MVP Technical Dependencies

| Dependency | Package | Used For |
|------------|---------|---------|
| Expo Router | `expo-router` | File-based navigation (already installed) |
| Zustand | `zustand` | Global state (already installed) |
| SWR | `swr` | Data fetching (already installed) |
| Expo Notifications | `expo-notifications` | Push token + handling |
| NetInfo | `@react-native-community/netinfo` | Online/offline detection |
| AsyncStorage | `@react-native-async-storage/async-storage` | Offline queue + SWR cache |
| Expo Secure Store | `expo-secure-store` | Auth token storage |
| Expo Image Picker | `expo-image-picker` | Task photo capture |
| Expo Location | `expo-location` | GPS check-in (optional P1) |

---

### 7.6 MVP Milestone Plan

| Milestone | Deliverable | Screens |
|-----------|-------------|---------|
| **M1 — Auth Shell** | Login, protected routing, token storage | Login (both apps) |
| **M2 — Worker Browse** | Shift listing + detail + apply | Browse, Work Detail |
| **M3 — Worker Execute** | Assignment list, check-in, check-out | Assignments, Check-In, Check-Out |
| **M4 — Checker Core** | Queue, verify, rate | Assignments Queue, Verification Form, Rating Form |
| **M5 — Feedback Loop** | Ratings screen + photo upload | Ratings, Task Detail |
| **M6 — Push + Offline** | Notifications wired, offline queue | All screens + infrastructure |
| **M7 — Polish** | Empty states, error boundaries, loading skeletons, dark mode | All screens |

---

## Appendix: Role-to-Feature Matrix

| Feature | WORKER | CHECKER | MANAGER | ADMIN |
|---------|--------|---------|---------|-------|
| Browse open shifts | ✅ | — | — | — |
| Apply to shift | ✅ | — | — | — |
| View own applications | ✅ | — | — | — |
| View own assignments | ✅ | — | — | — |
| Check-in / check-out | ✅ | — | — | — |
| Upload task photos | ✅ | — | — | — |
| View own ratings | ✅ | — | — | — |
| View assignments queue | — | ✅ | — | — |
| Submit verification | — | ✅ | — | — |
| Submit rating | — | ✅ | — | — |
| View leaderboard | ✅ | ✅ | ✅ | ✅ |
| Create work requests | — | — | ✅ | ✅ |
| Assign workers | — | — | ✅ | ✅ |
