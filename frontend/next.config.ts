import type { NextConfig } from "next";
import pkg from "./package.json" with { type: "json" };

// Security #4 (2026-08-09): server-only (no NEXT_PUBLIC_ prefix -- never
// sent to the browser). Frontend (Vercel) and backend (EC2) are different
// origins in production; the browser must never see the backend's real
// host, only ever talk to THIS origin's /api/* path, which Next.js then
// proxies server-side. This is what makes plain SameSite=Lax httpOnly
// auth cookies work without a cross-origin SameSite=None+CSRF scheme --
// see lib/cookies.ts on the backend.
// A missing env var in production would silently proxy every /api request
// to localhost:3001 on the Vercel server itself -- nothing is listening
// there, so every request fails, but the failure looks like a generic
// network error with no indication the real cause is a missing env var.
// Failing at build time instead turns that into an immediate, legible error.
if (process.env.NODE_ENV === "production" && !process.env.BACKEND_INTERNAL_URL) {
  throw new Error(
    "BACKEND_INTERNAL_URL must be set in production for the /api rewrite proxy",
  );
}

const BACKEND_INTERNAL_URL =
  process.env.BACKEND_INTERNAL_URL ?? "http://localhost:3001";

const nextConfig: NextConfig = {
  env: {
    // Surfaced on /settings for support (2026-08-07). Sourced from
    // package.json rather than a hand-maintained constant, so the displayed
    // version cannot drift from the released one. The commit SHA comes from
    // the platform at build time (Vercel sets
    // NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA); lib/config.ts falls back to a
    // "local development build" label rather than showing a misleading value.
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_INTERNAL_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
