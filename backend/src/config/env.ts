import { z } from 'zod';
import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { parseBackoffScheduleMs } from '../modules/notifications/outbox-backoff.js';
import { findBackendRoot } from '../lib/backend-root.js';

// --- Module-directory resolution that is safe in BOTH module formats ---------
//
// This repo is ESM at build/runtime (`"type": "module"`; `node dist/server.js`),
// where `__dirname` does not exist and `import.meta.url` is the correct way to
// locate a module. Under Jest, however, the entire test run is CommonJS: Jest
// only takes its native-ESM code path when the runner is started with
// `NODE_OPTIONS=--experimental-vm-modules`, which this project does not set (see
// `package.json` "test": "jest --forceExit"). Without that flag every module —
// including this one — goes through `jest-runtime`'s `requireModule`, which
// passes `supportsStaticESM: false` to the transformer. ts-jest then forces
// `module: CommonJS` for the file regardless of the `module: "ESNext"` in the
// inline tsconfig of the jest `transform` entry, and `import.meta` is a syntax
// error under CommonJS (TS1343).
//
// Writing `import.meta.url` literally in this file therefore breaks any test
// suite whose import graph reaches `config/env.ts` without mocking it.
//
// `process.argv[1]` is not usable here either: it points at the entrypoint, not
// at this module. Instead this resolves the backend root from `__dirname` when
// running as CommonJS (Jest), and otherwise walks up from the running
// entrypoint's directory looking for the `package.json` that marks the backend
// root — which is exactly the anchor the old `import.meta.url` computation was
// reaching for (`dist/config/env.js` -> `backend/`).
// Delegates to findBackendRoot(), which identifies this package by a marker
// file rather than by "has a package.json". The old walk started at
// process.argv[1], which under pm2 is pm2's ProcessContainer.js, so it
// resolved to pm2's own installation directory.
function backendRoot(): string {
  return findBackendRoot();
}


// Release-audit fix: `z.coerce.boolean()` coerces ANY non-empty string —
// including the literal string `"false"` and `"0"` — to `true` (it's
// `Boolean(str)`, not a parse of the string's meaning). Every one of this
// repo's 5 feature flags previously used it, so `FEATURE_RM_ROLE=false` in an
// env file silently ENABLED the flag rather than disabling it — the exact
// opposite of what an operator typing that line intends, with no error, no
// warning, nothing to signal the mistake. `strictBooleanFlag` instead parses
// the env var's actual textual meaning: `"true"`/`"1"` → true, `"false"`/`"0"`
// → false, unset → the given default, anything else → a validation error
// (fails startup loudly rather than silently guessing).
function strictBooleanFlag(defaultValue: boolean) {
  return z
    .string()
    .optional()
    .transform((val, ctx) => {
      if (val === undefined || val === '') return defaultValue;
      if (val === 'true' || val === '1') return true;
      if (val === 'false' || val === '0') return false;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `must be "true", "false", "1", "0", or unset — got ${JSON.stringify(val)}`,
      });
      return z.NEVER;
    });
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  API_VERSION: z.string().default('v1'),

  // Database
  DATABASE_URL: z.string().url('Invalid DATABASE_URL'),

  // Redis (optional for MVP)
  REDIS_URL: z.string().optional(),

  // JWT
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  // SECURITY (OQ-AUTH-04): dedicated secret is mandatory — no fallback to
  // JWT_SECRET. Reusing the access-token secret for refresh tokens means a
  // leaked access secret (e.g. via an access-token verification oracle)
  // also forges long-lived refresh tokens. Fail closed at startup instead.
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  // ADR-031 D-4 (PR-5): 1h -> 15m. With request-time revocation live,
  // token_generation is the primary revocation mechanism; TTL is now
  // defense-in-depth rather than the platform's only expiry guarantee, so
  // it can be shortened without weakening the previous behavior.
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),

  // APNs (PATCH-05: base64 encoded private key)
  APNS_PRIVATE_KEY_BASE64: z.string().optional(),

  // Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  // Security #4 (2026-08-09): httpOnly auth cookies for the web frontend,
  // set alongside the existing bearer-token body response (mobile is
  // unaffected -- see lib/cookies.ts). Host-only cookie by default (no
  // Domain attribute set) is correct today since the browser only ever
  // talks to the same-origin Next.js proxy; reserved for a future
  // multi-subdomain deploy, not read anywhere yet.
  COOKIE_DOMAIN: z.string().optional(),

  // File Storage (AWS S3)
  AWS_REGION: z.string().default('eu-central-1'),
  S3_BUCKET: z.string().optional(),
  S3_BUCKET_BACKUPS: z.string().optional(),
  // Static credentials are optional: prefer the EC2 instance role in deployed
  // environments. The AWS SDK falls back to the instance role when these are unset.
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),

  // Email (Epic 7 PR 7.4, ADR-029: EMAIL transport, carries forward
  // MIG-GAP-11's secret-storage/least-privilege requirement). Provider API
  // keys are plain env vars, matching the existing JWT_SECRET/
  // APNS_PRIVATE_KEY_BASE64 precedent -- no secrets-manager mechanism exists
  // in this repo to reuse or invent. Scope each key to mail-send only at the
  // provider; never log a key value.
  EMAIL_SERVICE: z.enum(['sendgrid', 'resend']).optional(),
  SENDGRID_API_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM_ADDRESS: z.string().email().optional(),

  // Notifications: APNs (ES256 JWT provider auth) + FCM (Epic 7 PR 7.5,
  // ADR-029 §4). Same secret-storage/least-privilege posture as the email
  // config above (MIG-GAP-11 carryover): plain env vars, never logged, keys
  // scoped to push-send only at the provider.
  APNS_KEY_ID: z.string().optional(),
  APNS_TEAM_ID: z.string().optional(),
  // Per-app APNs topics (Epic 7 PR 7.8). APNs requires `apns-topic` to equal
  // the bundle ID of the app that minted the device token, and the two mobile
  // apps have distinct bundle IDs — so there is one topic per app, selected at
  // delivery time from PushToken.app. These replace the former single
  // APNS_BUNDLE_ID, which could only ever be correct for one of the two apps.
  // The signing key itself stays shared: an APNs auth key is team-scoped, so
  // one key and one cached JWT serve both topics.
  APNS_BUNDLE_ID_WORKER: z.string().optional(),
  APNS_BUNDLE_ID_CHECKER: z.string().optional(),
  FIREBASE_PROJECT_ID: z.string().optional(),
  // Base64-encoded Firebase service-account JSON key. Required for FCM HTTP
  // v1 (the only current, non-deprecated FCM API): sends use a short-lived
  // OAuth2 access token obtained by exchanging a self-signed JWT for this
  // service account, not a static server key. FIREBASE_PROJECT_ID alone is
  // insufficient for v1 auth.
  FIREBASE_SERVICE_ACCOUNT_KEY_BASE64: z.string().optional(),

  // Sentry (error tracking)
  SENTRY_DSN: z.string().optional(),

  // Frontend URL (for CORS, email links, etc)
  FRONTEND_URL: z.string().optional(),

  // Pivot cutover feature flag (S0-4): toggles the dispatch model between the
  // legacy marketplace (worker applications) and the new direct-dispatch
  // (broadcast/assignment) flow. See docs/00-foundations/PIVOT_DESIGN_DOCUMENT.md.
  PIVOT_MODE: z.enum(['marketplace', 'direct_dispatch']).default('marketplace'),

  // Employment-record module cutover flag (Epic 5 PR 5.6, SPEC-EMP-001).
  // Defaults FALSE: the new employee-management routes 404 until explicitly
  // enabled, per ADR-024 D3's "both-off = current behavior" posture.
  FEATURE_EMPLOYMENT_RECORD: strictBooleanFlag(false),

  // RULE-CONSENT-01 daily-access-gate enforcement. Blocks every non-admin API
  // call until that user has granted today's consent.
  //
  // Default ON (owner decision, 2026-08-18): this ships as part of the first
  // version, so there is no older, gate-unaware client already in the field to
  // strand on a 403 it cannot act on -- the concern that would otherwise force
  // a staged rollout. Every client in this release renders the notice.
  //
  // Set FEATURE_CONSENT_GATE=false to disable; CONSENT_GATE_ROLES narrows it
  // without disabling. See docs/04-implementation/CONSENT_GATE_ROLLOUT.md.
  //
  // strictBooleanFlag, not z.coerce.boolean(), is load-bearing here -- that
  // helper exists because coercion turned the string "false" into true, and
  // for this flag specifically that bug would mean being unable to turn the
  // gate off during an incident.
  FEATURE_CONSENT_GATE: strictBooleanFlag(true),

  // Narrower kill switch than the flag itself: the roles the gate applies to.
  // Lets an operator drop `manager,regional_manager` under fire, keeping the
  // worker-facing GDPR obligation live while unblocking the people who
  // administer the system. `admin` is never gated regardless of this value --
  // an unrecoverable platform needs someone left who can fix it.
  CONSENT_GATE_ROLES: z
    .string()
    .default('worker,checker,manager,regional_manager')
    .transform((v) =>
      v
        .split(',')
        .map((r) => r.trim().toLowerCase())
        .filter((r) => r.length > 0 && r !== 'admin')
    ),

  // Regional Manager role cutover flag (ADR-030 §6 PR-2, D-6).
  // Defaults FALSE: the REGIONAL_MANAGER enum value exists (M-1, additive and
  // irreversible) but M-3's promotion of existing group-associated managers
  // does not run, and no route reads the token, until this is enabled — the
  // "both-off = current behavior" posture. Must not be enabled in production
  // before PR-3 ships (ADR-030 §6 ordering constraint: the mobile/frontend
  // role-union widening and the hotel-group RM-picker fix, F-3).
  FEATURE_RM_ROLE: strictBooleanFlag(false),

  // GD-02/GD-03 capability-matrix cutover flag (ADR-030 §6 PR-5).
  // Defaults FALSE: while off, hotel-groups routes keep requiring the legacy
  // `hotels:read`/`hotels:write` tokens (not the new `hotel_groups:read`/
  // `hotel_groups:write` split, D-9) and `PUT /users/:id` keeps accepting the
  // legacy combined profile+role body (not the D-4a split) — matching
  // "both-off = current behavior". Historical note: at ADR-030's ratification,
  // permissions were stored (not derived), so enabling this flag was a
  // prerequisite for its M-2 backfill (scripts/role-permissions-backfill.ts)
  // to do anything meaningful. ADR-031 subsequently made permissions
  // request-time-derived from ROLE_PERMISSIONS and retired that backfill
  // script (PR-7) — this flag's own legacy-token-vs-split-token behavior is
  // unaffected and still gates independently.
  FEATURE_GD02_MATRIX: strictBooleanFlag(false),

  // ADR-031 §7 PR-7: FEATURE_DERIVED_PERMISSIONS and
  // FEATURE_TOKEN_GENERATION_ENFORCEMENT (formerly here) are retired — both
  // cutovers are complete and unconditional in middleware/auth.ts.

  // Job Dispatch Phase 2 cutover flag (Epic 9 PR 9.5, TREQ-001/MIG-GAP-03).
  // Defaults FALSE. Gates the new POST/GET /assignments/calendar-entries
  // routes only — while off, those routes 404 (fall through), matching the
  // "both-off = current behavior" posture every prior epic flag has used.
  FEATURE_JOBDISPATCH_PHASE2: strictBooleanFlag(false),

  // ---------------------------------------------------------------------------
  // Platform Worker / Transactional Outbox (ADR-029, GD-01 — Epic 7 PR 7.2).
  // Config-driven per ADR-029 §6/§8: the values below are the initial
  // deployment defaults, changeable without a code change.
  // ---------------------------------------------------------------------------
  // Poll interval for the outbox drain loop (ADR-029 §8: default 5s).
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  // Max OutboxEvent rows claimed per batch by a single FOR UPDATE SKIP LOCKED claim.
  OUTBOX_CLAIM_BATCH_SIZE: z.coerce.number().int().positive().default(20),
  // Exponential-backoff schedule as a comma-separated list of millisecond delays
  // (ADR-029 §6 default: 1m, 5m, 15m, 1h). Its length also sets the retry count:
  // once a row has failed more times than there are entries here, it is
  // dead-lettered. Parsed into a positive-int array; an empty/invalid entry fails
  // startup validation (fail-closed) rather than silently dropping retries.
  OUTBOX_BACKOFF_SCHEDULE_MS: z
    .string()
    .default('60000,300000,900000,3600000')
    .transform((raw, ctx) => {
      try {
        return parseBackoffScheduleMs(raw);
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: error instanceof Error ? error.message : 'invalid backoff schedule',
        });
        return z.NEVER;
      }
    }),
  // How long a row may sit in PROCESSING before the worker treats it as
  // abandoned (a worker crashed mid-delivery) and reclaims it — the visibility
  // timeout that preserves at-least-once delivery (ADR-029 §7). Must exceed a
  // realistic single-delivery duration; handlers are idempotent so an occasional
  // reclaim-and-retry of an already-sent row is safe.
  OUTBOX_PROCESSING_TIMEOUT_MS: z.coerce.number().int().positive().default(300000),

  // ADR-031 D-5 (PR-6): Session/PasswordResetToken sweep job on the Platform
  // Worker. Config-driven per the same ADR-029 §6/§8 convention — the values
  // below are the initial deployment defaults, changeable without a code
  // change. Default interval: hourly.
  SESSION_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(3600000),
  // Bounded per-run delete batch size, so a large first run (or a backlog
  // after downtime) cannot lock either table (D-5).
  SESSION_SWEEP_BATCH_SIZE: z.coerce.number().int().positive().default(500),
  // Hard cap on batches deleted per table per run (performance-review
  // finding: this directly bounds per-tick work alongside batch size, so it
  // must be adjustable without a code change if the pre-existing,
  // never-swept backlog on first deploy turns out to need faster
  // convergence than the default allows).
  SESSION_SWEEP_MAX_BATCHES_PER_RUN: z.coerce.number().int().positive().default(50),

  // GD-14/OD-GEO-002 (SPEC-GEO-001): WorkerGeoCheckin 6-month hard-delete
  // retention sweep on the Platform Worker, same config-driven convention as
  // the session sweep above. Default interval: daily (this data ages out
  // over months, not hours, so a tighter poll than SESSION_SWEEP's hourly
  // default isn't warranted).
  GEO_RETENTION_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(86400000),

  // ADR-069 / CRR §14: how often the 20-minute rework escalation is checked.
  // 60s, not 20 minutes: the deadline is 20 minutes, so polling at the same
  // period would make the actual escalation land anywhere from 20 to 40
  // minutes late. A one-minute tick bounds the overshoot to a minute, and the
  // query is a single indexed lookup that usually matches nothing.
  REWORK_ESCALATION_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
  REWORK_ESCALATION_BATCH_SIZE: z.coerce.number().int().positive().default(50),
  // The end-of-shift inspection digest. The interval is how often the job
  // looks; QUIET_PERIOD_MS in the job is how long a shift must be quiet before
  // it is summarized, and that is the number that decides how late the digest
  // feels to a worker.
  INSPECTION_DIGEST_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
  INSPECTION_DIGEST_BATCH_SIZE: z.coerce.number().int().positive().default(50),
  GEO_RETENTION_SWEEP_BATCH_SIZE: z.coerce.number().int().positive().default(500),
  GEO_RETENTION_SWEEP_MAX_BATCHES_PER_RUN: z.coerce.number().int().positive().default(50),

  // SPEC-RETENTION-001@0.2.0 REVIEW, PR 3 of 5: the generic RetentionLog
  // sweep (REQ-RETENTION-016, RULE-RETENTION-04), same config-driven
  // convention as the sweep jobs above. Default interval: daily, same
  // rationale as GEO_RETENTION_SWEEP -- this data ages out over months/
  // years, not hours.
  RETENTION_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(86400000),
  RETENTION_SWEEP_BATCH_SIZE: z.coerce.number().int().positive().default(500),
  RETENTION_SWEEP_MAX_BATCHES_PER_RUN: z.coerce.number().int().positive().default(50),

  // Epic 9 PR 9.10 (TREQ-006/TRULE-005, MIG-GAP-09): broadcast JobRequest
  // 6h auto-close job on the Platform Worker, same config-driven convention
  // as the two sweep jobs above. A tighter poll than SESSION_SWEEP's hourly
  // default is warranted -- TREQ-006's 6h window is itself short, so a
  // broadcast could otherwise sit unfilled-but-past-due for up to an hour
  // before this job notices.
  JOB_REQUEST_AUTO_CLOSE_INTERVAL_MS: z.coerce.number().int().positive().default(900000),
  // TREQ-006: "auto-closes 6 hours after creation" -- confirmed authority,
  // not itself configuration, but exposed as a default-6h env var (not a
  // hardcoded literal) for the same operational-adjustability reason every
  // other scheduled-job parameter here is.
  JOB_REQUEST_AUTO_CLOSE_AFTER_MS: z.coerce.number().int().positive().default(21600000),
  JOB_REQUEST_AUTO_CLOSE_BATCH_SIZE: z.coerce.number().int().positive().default(100),

  // HR implementation PR 5 (IF-HR-ContractExpiryReminder, RULE-HR-07): a
  // daily sweep is sufficient granularity for a 1yr/2yr reminder mark (unlike
  // JOB_REQUEST_AUTO_CLOSE's 6h window, which needs sub-hourly polling to
  // notice in time) -- same config-driven convention as every other
  // scheduled job above.
  HR_CONTRACT_EXPIRY_REMINDER_INTERVAL_MS: z.coerce.number().int().positive().default(86400000),
  HR_CONTRACT_EXPIRY_REMINDER_BATCH_SIZE: z.coerce.number().int().positive().default(100),

  // ADR-041 (2026-07-28, OD-HR-09): payslip-request escalation after 3
  // business days unfulfilled -- "3 business days" is confirmed authority
  // (ADR-041), not itself configuration, but exposed as a default env var
  // (not a hardcoded literal) for the same operational-adjustability reason
  // every other scheduled-job threshold here is. A daily sweep is sufficient
  // granularity for a multi-day threshold.
  HR_PAYSLIP_ESCALATION_INTERVAL_MS: z.coerce.number().int().positive().default(86400000),
  // 3 calendar days (259200000ms), a deliberate approximation of ADR-041's
  // "3 business days" -- a real business-day calculation needs a holiday
  // calendar CRR/PDD never specify, and no such calendar exists elsewhere in
  // this codebase; the calendar-day default is configurable, not a silent
  // narrowing of the confirmed requirement.
  HR_PAYSLIP_ESCALATION_AFTER_MS: z.coerce.number().int().positive().default(259200000),
  HR_PAYSLIP_ESCALATION_BATCH_SIZE: z.coerce.number().int().positive().default(100),

  // Deferred-bug batch (2026-08-07): workers could previously check in an
  // unbounded amount of time before their shift. RULE-002 (early arrival
  // still resolves PRESENT, not LATE) is preserved inside this window --
  // only arrivals earlier than the window are rejected. User-specified
  // default of 2 hours, exposed as a configurable env var rather than a
  // hardcoded literal, matching this file's convention for every other
  // business-rule threshold.
  ATTENDANCE_EARLY_CHECK_IN_GRACE_MINUTES: z.coerce.number().int().positive().default(120),
  
  // Bug 14: Implement a configurable grace period for tardiness.
  ATTENDANCE_TARDY_GRACE_MINUTES: z.coerce.number().int().nonnegative().default(15),

  // SPEC-AUTH-001 TREQ-AUTH-007 (2026-08-08): "N consecutive failed logins
  // for an account -> the responsible manager is notified". The spec leaves
  // N unspecified, so it is a named, configurable threshold here rather than
  // a magic number, matching this file's convention for every other
  // business-rule threshold. 5 is a conventional default -- high enough that
  // ordinary typos don't page anyone, low enough to surface a real
  // credential-guessing attempt.
  //
  // This is a NOTIFICATION threshold, never a lockout threshold
  // (TRULE-AUTH-002: "notify and never block"). Crossing it must not affect
  // whether a subsequent login is accepted.
  AUTH_FAILED_LOGIN_NOTIFY_THRESHOLD: z.coerce.number().int().positive().default(5),

  // ADR-070 (2026-08-21): per-account login throttle, defense-in-depth
  // alongside the Nginx edge's IP-keyed rate limiting (which a distributed,
  // many-IPs-one-account attacker bypasses). Deliberately set above
  // AUTH_FAILED_LOGIN_NOTIFY_THRESHOLD so the manager notification always
  // fires first, unaffected -- throttling only engages if the attack
  // continues past that point. UNLIKE the notify threshold, crossing this
  // one DOES temporarily block further attempts (see ADR-070 §3 for why
  // this is throttling, not the lockout TREQ-AUTH-007 rules out).
  AUTH_LOGIN_THROTTLE_THRESHOLD: z.coerce.number().int().positive().default(10),
  // Fixed window, not exponential backoff (ADR-070 §5 Non-goals) -- 15
  // minutes is long enough to make sustained guessing impractical and short
  // enough that a legitimate user who forgot their password isn't locked
  // out for an unreasonable stretch.
  AUTH_LOGIN_THROTTLE_DURATION_MS: z.coerce.number().int().positive().default(900000),

  // Default 15 minutes sweep for expired assignments to NO_SHOW.
  ASSIGNMENT_NO_SHOW_INTERVAL_MS: z.coerce.number().int().positive().default(900000), // 15 mins
  // Grace period before marking a shift as NO_SHOW (default 2 hours past shift end time)
  ASSIGNMENT_NO_SHOW_GRACE_PERIOD_MS: z.coerce.number().int().positive().default(7200000), // 2 hours
  // -------------------------------------------------------------------------
  // SPEC-CHATBOT-001 (ADR-013, ADR-053) — scaffold cutover flag. Defaults
  // FALSE: while off, `/chatbot` routes fall through to the 404 handler,
  // matching this repo's "both-off = current behavior" posture (same shape
  // as FEATURE_EMPLOYMENT_RECORD). strictBooleanFlag, not z.coerce.boolean(),
  // for the same reason as every other flag in this file — a kill switch
  // must not silently invert on `FEATURE_CHATBOT=false`.
  //
  // No LLM provider is wired at this stage (no CHATBOT_PROVIDER/model config
  // below) — this flag currently gates only the module scaffold, the
  // authorization boundary, and one real read-only tool exercised without
  // any AI call. Provider config is added when Step 5 of the integration
  // plan (wiring the model) actually happens.
  // -------------------------------------------------------------------------
  FEATURE_CHATBOT: strictBooleanFlag(false),

  // REQ-CHAT-004: hard monthly token budget cap, config-stored. Not read
  // anywhere yet (no provider is wired) — present now so ChatbotBudgetCounter
  // and its guard can be exercised in tests ahead of Step 5.
  CHATBOT_MONTHLY_TOKEN_CAP: z.coerce.number().int().positive().default(2000000),
  // REQ-CHAT-005: per-conversation token limit.
  CHATBOT_CONVERSATION_TOKEN_CAP: z.coerce.number().int().positive().default(25000),
  // OD-CHAT-010 abuse-prevention: per-worker daily cap, distinct from the
  // CRR §2/§3 login-rate-limiting exclusion (SPEC-CHATBOT-001 is explicit
  // these must not be conflated).
  CHATBOT_USER_DAILY_TOKEN_CAP: z.coerce.number().int().positive().default(60000),
  CHATBOT_MAX_TOOL_CALLS_PER_TURN: z.coerce.number().int().positive().default(5),
  CHATBOT_TURN_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
  // HMAC secret for high-risk-write confirmation tokens (§6/§9 of the
  // architecture doc). Only required once a HIGH_RISK_WRITE tool is
  // registered — none is yet — enforced below via superRefine rather than
  // `.min(32)` unconditionally, so the scaffold boots without it.
  CHATBOT_CONFIRM_TOKEN_SECRET: z.string().optional(),
})
  // ---------------------------------------------------------------------------
  // Fail-closed guard: a deployed environment must have real object storage.
  //
  // `documents/storage.ts` falls back to `stubStorageClient` when S3_BUCKET is
  // unset -- deliberately, so unit tests and local-only work never touch the
  // SDK. The stub logs a warning and NO-OPS the upload, while the caller's
  // surrounding transaction still writes the WorkerDocument row. The failure is
  // therefore invisible from every layer a human normally checks: the API
  // returns 200, the UI shows the document as uploaded, and the DB row exists
  // -- with no object in the bucket.
  //
  // That is fine (and necessary) in development and test. In staging or
  // production it would mean silently losing every employee's identity
  // documents, which is exactly the class of data loss this codebase's testing
  // rules exist to prevent ("a 200 has repeatedly meant nothing was written").
  // Cheapest possible mitigation: refuse to boot, so a missing/typo'd bucket is
  // a loud startup crash instead of a discovery made months later when someone
  // needs a work permit that was never stored.
  //
  // Verified reachable, not hypothetical: this exact stub path was hit
  // accidentally during S3 verification on 2026-08-12 (a probe that reported
  // `UPLOAD_RETURNED_OK` while writing nothing), which is what prompted this
  // guard.
  .superRefine((env, ctx) => {
    const requiresRealStorage = env.NODE_ENV === 'production' || env.NODE_ENV === 'staging';
    if (requiresRealStorage && !env.S3_BUCKET?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['S3_BUCKET'],
        message:
          `S3_BUCKET must be set when NODE_ENV=${env.NODE_ENV}: without it, document ` +
          'uploads silently no-op (stub storage) while still writing the DB row, so ' +
          'documents would appear uploaded but never reach the bucket. Set S3_BUCKET, ' +
          'or run with NODE_ENV=development if you intend to use stub storage.',
      });
    }
    
    if (requiresRealStorage && env.AWS_REGION !== 'eu-central-1') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AWS_REGION'],
        message:
          `AWS_REGION must be eu-central-1 when NODE_ENV=${env.NODE_ENV} for GDPR compliance. ` +
          `Found: ${env.AWS_REGION}`,
      });
    }

    // ADR-070: AUTH_LOGIN_THROTTLE_THRESHOLD must stay above
    // AUTH_FAILED_LOGIN_NOTIFY_THRESHOLD so the manager-notify path
    // (TREQ-AUTH-007) always fires before throttling engages, exactly as
    // ADR-070 §2 specifies. Both are independently-configurable env vars
    // with no natural ordering enforced by their types, so a typo'd or
    // reversed override (e.g. an ops change that lowers the throttle
    // threshold without noticing the notify one) would silently invert the
    // intended sequence -- fail the boot instead, the same posture as the
    // S3_BUCKET guard above.
    if (env.AUTH_LOGIN_THROTTLE_THRESHOLD <= env.AUTH_FAILED_LOGIN_NOTIFY_THRESHOLD) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_LOGIN_THROTTLE_THRESHOLD'],
        message:
          `AUTH_LOGIN_THROTTLE_THRESHOLD (${env.AUTH_LOGIN_THROTTLE_THRESHOLD}) must be ` +
          `greater than AUTH_FAILED_LOGIN_NOTIFY_THRESHOLD (${env.AUTH_FAILED_LOGIN_NOTIFY_THRESHOLD}): ` +
          'ADR-070 requires the manager-notify alert to always fire before login ' +
          'throttling engages.',
      });
    }

    // Only require the confirmation-token secret once the flag that could
    // ever mount a HIGH_RISK_WRITE tool is on — the scaffold today registers
    // none, so requiring this unconditionally would block booting a
    // read-only-only deployment for a secret nothing yet uses.
    if (env.FEATURE_CHATBOT && env.CHATBOT_CONFIRM_TOKEN_SECRET !== undefined) {
      if (env.CHATBOT_CONFIRM_TOKEN_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CHATBOT_CONFIRM_TOKEN_SECRET'],
          message: 'CHATBOT_CONFIRM_TOKEN_SECRET must be at least 32 characters when set',
        });
      }
    }
  });

type Env = z.infer<typeof envSchema>;

let envConfig: Env | null = null;

export function loadEnv(): Env {
  if (envConfig) return envConfig;

  // Load backend/.env into process.env before validation. The path is resolved
  // from the backend root (see `backendRoot()` above) rather than the current
  // working directory, so it loads regardless of where `npm start` is
  // launched from. dotenv does not override variables already present in
  // process.env, so real environment variables injected by the orchestrator in
  // production take precedence over the .env file — making this safe for both
  // local and deployed environments.
  const envPath = resolve(backendRoot(), '.env');
  dotenv.config({ path: envPath });

  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const errors = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`);
    throw new Error(`Invalid environment variables:\n${errors.join('\n')}`);
  }

  envConfig = parsed.data;
  return envConfig;
}

export function getEnv(): Env {
  if (!envConfig) {
    throw new Error('Environment not loaded. Call loadEnv() first.');
  }
  return envConfig;
}
