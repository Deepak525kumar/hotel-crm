import type { NextConfig } from "next";
import pkg from "./package.json" with { type: "json" };

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
};

export default nextConfig;
