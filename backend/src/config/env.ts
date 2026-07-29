import { z } from 'zod';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseBackoffScheduleMs } from '../modules/notifications/outbox-backoff.js';

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
  FEATURE_EMPLOYMENT_RECORD: z.coerce.boolean().default(false),

  // Regional Manager role cutover flag (ADR-030 §6 PR-2, D-6).
  // Defaults FALSE: the REGIONAL_MANAGER enum value exists (M-1, additive and
  // irreversible) but M-3's promotion of existing group-associated managers
  // does not run, and no route reads the token, until this is enabled — the
  // "both-off = current behavior" posture. Must not be enabled in production
  // before PR-3 ships (ADR-030 §6 ordering constraint: the mobile/frontend
  // role-union widening and the hotel-group RM-picker fix, F-3).
  FEATURE_RM_ROLE: z.coerce.boolean().default(false),

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
  FEATURE_GD02_MATRIX: z.coerce.boolean().default(false),

  // ADR-031 §7 PR-7: FEATURE_DERIVED_PERMISSIONS and
  // FEATURE_TOKEN_GENERATION_ENFORCEMENT (formerly here) are retired — both
  // cutovers are complete and unconditional in middleware/auth.ts.

  // Job Dispatch Phase 1 cutover flag (Epic 9, TREQ-011). Defaults FALSE.
  // Gates nothing in PR 9.2 itself (WorkApplication removal is unconditional
  // in this PR) — it exists for PR 9.3/9.4 and the mobile companion PR to
  // consume once the replacement dispatch flow lands.
  FEATURE_JOBDISPATCH_PHASE1: z.coerce.boolean().default(false),

  // Job Dispatch Phase 2 cutover flag (Epic 9 PR 9.5, TREQ-001/MIG-GAP-03).
  // Defaults FALSE. Gates the new POST/GET /assignments/calendar-entries
  // routes only — while off, those routes 404 (fall through), matching the
  // "both-off = current behavior" posture every prior epic flag has used.
  // Distinct from FEATURE_JOBDISPATCH_PHASE1 (Phase 1, PR 9.2/9.3/9.4): each
  // phase gets its own flag per this repo's existing per-phase precedent.
  FEATURE_JOBDISPATCH_PHASE2: z.coerce.boolean().default(false),

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
  GEO_RETENTION_SWEEP_BATCH_SIZE: z.coerce.number().int().positive().default(500),
  GEO_RETENTION_SWEEP_MAX_BATCHES_PER_RUN: z.coerce.number().int().positive().default(50),
});

type Env = z.infer<typeof envSchema>;

let envConfig: Env | null = null;

export function loadEnv(): Env {
  if (envConfig) return envConfig;

  // Load backend/.env into process.env before validation. The path is resolved
  // relative to this module (dist/config/env.js -> backend/.env) rather than the
  // current working directory, so it loads regardless of where `npm start` is
  // launched from. dotenv does not override variables already present in
  // process.env, so real environment variables injected by the orchestrator in
  // production take precedence over the .env file — making this safe for both
  // local and deployed environments.
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env');
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
