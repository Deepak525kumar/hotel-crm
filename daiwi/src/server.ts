import "./lib/loadEnv.js";
import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, isProduction } from "./lib/config.js";
import { attachSession } from "./lib/auth.js";
import { authRouter } from "./routes/auth.js";
import { accountRouter } from "./routes/account.js";
import { promotionRouter } from "./routes/promotion.js";
import { buildsRouter } from "./routes/builds.js";
import { installRouter } from "./routes/install.js";
import { lanAddress } from "./lib/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable("x-powered-by");
// One proxy hop (nginx). Anything higher would let a client forge X-Forwarded-For
// and evade the rate limiters.
app.set("trust proxy", 1);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: false, limit: "64kb" }));
app.use(express.json({ limit: "64kb" }));
app.use(cookieParser());

/**
 * This service shares an origin with the Hotel CRM web app, so its pages must
 * not become a pivot into it. The CSP allows nothing but this origin's own
 * assets — no inline event handlers, no third-party script, no framing — and
 * `frame-ancestors 'none'` keeps the install pages out of anyone else's iframe.
 */
app.use((_req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
      // data: is needed for the inlined QR code PNGs.
      "img-src 'self' data:",
      "connect-src 'self'",
      "form-action 'self'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join("; ")
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  if (isProduction) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

// Defaults for anything rendered outside a mounted surface — notably the
// catch-all 404 below, which would otherwise render a view with no assetBase.
app.use((_req, res, next) => {
  res.locals.assetBase = `${config.installPath}/assets`;
  res.locals.adminPath = config.adminPath;
  res.locals.installPath = config.installPath;
  next();
});

app.get("/healthz", (_req, res) => res.json({ ok: true }));

const staticAssets = express.static(path.join(__dirname, "public"), {
  maxAge: "1h",
  index: false,
  // The CSP forbids inline script, so every page's JS is a real file under
  // <mount>/assets — served on both surfaces so neither depends on the other.
  setHeaders: (res) => res.setHeader("X-Content-Type-Options", "nosniff"),
});

// ── admin surface (authenticated) ─────────────────────────────────────────────
const admin = express.Router();
admin.use((_req, res, next) => {
  res.locals.assetBase = `${config.adminPath}/assets`;
  res.locals.adminPath = config.adminPath;
  res.locals.installPath = config.installPath;
  // Nothing behind the login is cacheable; a shared proxy holding a dashboard
  // would serve one operator's builds to the next.
  res.setHeader("Cache-Control", "no-store");
  next();
});
admin.use("/assets", staticAssets);
// attachSession hits the database, so its rejection must reach the error handler
// — Express 4 does not await middleware and would otherwise leave the request
// hanging until the client gave up.
admin.use((req, res, next) => void attachSession(req, res, next).catch(next));
admin.use(authRouter);
admin.use(accountRouter);
admin.use(promotionRouter);
// Mounted last: its "/" route would otherwise shadow nothing, but keeping the
// specific paths ahead of it makes the ordering intentional rather than lucky.
admin.use(buildsRouter);
app.use(config.adminPath || "/", admin);

// ── public surface (anonymous) ────────────────────────────────────────────────
// Deliberately mounted without attachSession: nothing here is ever personalised,
// and not reading the session cookie means it cannot leak into a cached page.
const publicSurface = express.Router();
publicSurface.use((_req, res, next) => {
  res.locals.assetBase = `${config.installPath}/assets`;
  res.locals.installPath = config.installPath;
  next();
});
// Mounted ahead of installRouter so "/assets" is never swallowed by its /:slug route.
publicSurface.use("/assets", staticAssets);
publicSurface.use(installRouter);
app.use(config.installPath || "/", publicSurface);

app.use((_req, res) => res.status(404).render("not-found"));

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  if (res.headersSent) {
    // Headers are already out (a download that failed mid-stream) — the only
    // honest thing left is to break the connection rather than append junk.
    res.destroy();
    return;
  }
  // Never echo the underlying error to the client: messages here carry storage
  // keys, bucket names and SQL detail.
  res.status(500).send("Internal server error");
});

process.on("unhandledRejection", (err) => console.error("unhandledRejection", err));

app.listen(config.port, "127.0.0.1", () => {
  console.log(`version-control listening on 127.0.0.1:${config.port}`);
  console.log(`  admin   ${config.publicBaseUrl || `http://localhost:${config.port}`}${config.adminPath}`);
  console.log(`  install ${config.publicBaseUrl || `http://localhost:${config.port}`}${config.installPath}`);
  const lan = lanAddress();
  if (lan && !config.publicBaseUrl) {
    console.log(`  (dev) bind is loopback-only; set PUBLIC_BASE_URL or use the nginx proxy to reach it from ${lan}`);
  }
});
