import { z } from 'zod';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

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
  JWT_ACCESS_EXPIRY: z.string().default('1h'),
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

  // Email
  EMAIL_SERVICE: z.enum(['sendgrid', 'resend']).optional(),
  SENDGRID_API_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),

  // Notifications
  APNS_KEY_ID: z.string().optional(),
  APNS_TEAM_ID: z.string().optional(),
  APNS_BUNDLE_ID: z.string().optional(),
  FIREBASE_PROJECT_ID: z.string().optional(),

  // Sentry (error tracking)
  SENTRY_DSN: z.string().optional(),

  // Frontend URL (for CORS, email links, etc)
  FRONTEND_URL: z.string().optional(),

  // Pivot cutover feature flag (S0-4): toggles the dispatch model between the
  // legacy marketplace (worker applications) and the new direct-dispatch
  // (broadcast/assignment) flow. See docs/00-foundations/PIVOT_DESIGN_DOCUMENT.md.
  PIVOT_MODE: z.enum(['marketplace', 'direct_dispatch']).default('marketplace'),

  // Scope-based authorization cutover flag (Epic 5 PR 5.5, ADR-024 D3).
  // Defaults TRUE: the manager scope-authz fix is active on merge. Setting it
  // OFF is the rollback path, which reproduces the pre-fix behavior (manager
  // hotel-access bypass) — the ADR-024 D3 "both-off = current behavior" guarantee.
  FEATURE_SCOPE_AUTHZ: z.coerce.boolean().default(true),
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
