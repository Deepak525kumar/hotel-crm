import rateLimit, { type Options } from "express-rate-limit";
import type { Request, Response } from "express";

/**
 * Rate limits, in one place so the tiers can be compared against each other.
 *
 * Two things shape the numbers below:
 *
 *  - Workers install from a hotel's Wi-Fi, so a whole floor shares one public
 *    IP. Anything tuned for "one human" would lock out a shift. The public
 *    tiers are therefore generous, and the tight limits sit on the things a
 *    shared IP does *not* do in bulk: failed logins and 404s.
 *  - This is one PM2 process in fork mode, so the default in-memory store is
 *    accurate. If this service is ever scaled to multiple instances these
 *    counters become per-instance and need a shared store (Redis) to stay
 *    meaningful. nginx's limit_req zones (see nginx/hotelcrm.conf) are the
 *    edge-level backstop either way.
 */

function limiter(name: string, opts: Partial<Options> & Pick<Options, "windowMs" | "limit">) {
  return rateLimit({
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (req: Request, res: Response) => {
      console.warn(`rate-limit: ${name} tripped by ${req.ip} on ${req.method} ${req.originalUrl}`);
      const retryAfter = Math.ceil(opts.windowMs / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      if (req.path.startsWith("/api/") || req.accepts(["html", "json"]) === "json") {
        res.status(429).json({ error: "Too many requests — slow down and try again shortly." });
        return;
      }
      res.status(429).type("text/plain").send("Too many requests — try again shortly.");
    },
    ...opts,
  });
}

// ── authenticated surface ─────────────────────────────────────────────────────

/**
 * Only *failed* logins count, so an operator repeatedly signing in from the
 * office IP is never locked out by their colleagues' successful logins.
 */
export const loginLimiter = limiter("login", {
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
});

/** Absolute ceiling on the auth endpoints regardless of outcome. */
export const authBurstLimiter = limiter("auth-burst", {
  windowMs: 15 * 60_000,
  limit: 60,
});

/** Registration is off in production; when it is on, it stays slow. */
export const registerLimiter = limiter("register", {
  windowMs: 60 * 60_000,
  limit: 5,
});

/**
 * Uploads are the most expensive request this service serves: a gigabyte to
 * disk, a zip parse, and a multipart upload to S3.
 */
export const uploadLimiter = limiter("upload", {
  windowMs: 60 * 60_000,
  limit: 30,
});

/** The dashboard polls /api/builds every 3s while a build parses. */
export const dashboardApiLimiter = limiter("dashboard-api", {
  windowMs: 60_000,
  limit: 240,
});

// ── public surface ────────────────────────────────────────────────────────────

/** Catalogue and install pages: cheap, and shared-IP heavy. */
export const publicPageLimiter = limiter("public-page", {
  windowMs: 60_000,
  limit: 240,
});

/**
 * The enumeration control. Slugs are 16 chars of nanoid, so sweeping for a
 * valid one is already impractical — but counting *only misses* makes it
 * pointless, while a floor of workers opening valid links is never affected.
 */
export const slugMissLimiter = limiter("slug-miss", {
  windowMs: 10 * 60_000,
  limit: 20,
  skipSuccessfulRequests: true,
});

/**
 * Binary downloads are bandwidth, not CPU. One install is one download; this
 * allows a shift to install together while stopping anyone from using the
 * portal as free egress by looping a 200 MB IPA.
 */
export const downloadLimiter = limiter("download", {
  windowMs: 15 * 60_000,
  limit: 60,
});

/** installd fetches the manifest once per install attempt, immediately before the binary. */
export const manifestLimiter = limiter("manifest", {
  windowMs: 15 * 60_000,
  limit: 90,
});

// ── password reset ────────────────────────────────────────────────────────────

/**
 * Reset requests send mail and create tokens, so this is both an enumeration
 * surface and a way to have someone's inbox flooded on request.
 */
export const forgotPasswordLimiter = limiter("forgot-password", {
  windowMs: 60 * 60_000,
  limit: 5,
});

/** Guessing a 256-bit token is hopeless; this just keeps the attempt cheap to refuse. */
export const resetPasswordLimiter = limiter("reset-password", {
  windowMs: 60 * 60_000,
  limit: 20,
});

/** Each attempt costs a bcrypt comparison of the current password. */
export const changePasswordLimiter = limiter("change-password", {
  windowMs: 15 * 60_000,
  limit: 10,
});

// ── promotion ─────────────────────────────────────────────────────────────────

/** Promotions are deliberate, rare, and change what every worker downloads. */
export const promotionLimiter = limiter("promotion", {
  windowMs: 60_000,
  limit: 30,
});
