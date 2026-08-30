/**
 * Single place where environment turns into settings, so `local` and
 * `production` differ only by the .env that scripts/use-env.sh drops in.
 *
 * Import order matters: this module reads process.env at import time, so
 * ./loadEnv.js must already have run (server.ts imports it first).
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set (see .env.example)`);
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

/** Normalises "/apps/" and "apps" alike to "/apps"; "" and "/" to "". */
function mountPath(name: string, fallback: string): string {
  const raw = (process.env[name] ?? fallback).trim();
  if (!raw || raw === "/") return "";
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withSlash.replace(/\/+$/, "");
}

export const isProduction = process.env.NODE_ENV === "production";

export const config = {
  port: Number(process.env.PORT ?? 3002),

  /** Authenticated surface: login, upload, history. Proxied by nginx. */
  adminPath: mountPath("ADMIN_PATH", "/version-control"),
  /** Public surface: catalogue, per-build install pages, binaries. No auth. */
  installPath: mountPath("INSTALL_PATH", "/install"),

  /**
   * The origin every generated link and QR code is built from. Required in
   * production: iOS OTA installs need absolute HTTPS URLs, and the request
   * Host header is not trustworthy enough to build install links from.
   */
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, ""),

  sessionSecret: isProduction
    ? required("SESSION_SECRET")
    : process.env.SESSION_SECRET ?? "dev-secret-change-me",

  /**
   * Open registration on a public URL is a hole, and this portal keeps its own
   * accounts. Off by default in production — create the first operator with
   * `npm run user:create`, and hand out further accounts the same way.
   */
  allowRegistration: bool("ALLOW_REGISTRATION", !isProduction),
  /** When set, /register additionally requires this code even if registration is on. */
  registrationInviteCode: process.env.REGISTRATION_INVITE_CODE ?? "",

  /** 's3' in production, 'local' for a laptop with no AWS credentials. */
  storageDriver: (process.env.STORAGE_DRIVER ?? (isProduction ? "s3" : "local")) as "s3" | "local",
  s3: {
    bucket: process.env.S3_BUCKET ?? "",
    region: process.env.AWS_REGION ?? "eu-central-1",
    /** Every object this service writes lives under one prefix in the shared bucket. */
    prefix: (process.env.S3_PREFIX ?? "app-builds").replace(/^\/+|\/+$/g, ""),
  },
  /** Scratch directory for the upload → parse → S3 hand-off, and for local storage. */
  storageRoot: process.env.STORAGE_ROOT ?? "./storage",

  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 1024 * 1024 * 1024),
};

if (config.storageDriver === "s3" && !config.s3.bucket) {
  throw new Error("STORAGE_DRIVER=s3 requires S3_BUCKET");
}
if (isProduction && !config.publicBaseUrl) {
  throw new Error("PUBLIC_BASE_URL must be set in production — iOS OTA installs need absolute HTTPS URLs");
}
if (isProduction && !config.publicBaseUrl.startsWith("https://")) {
  throw new Error("PUBLIC_BASE_URL must be https in production — iOS refuses plain http and self-signed certs");
}
