import { Router } from "express";
import { prisma } from "../lib/db.js";
import { loginLimiter, authBurstLimiter, registerLimiter } from "../lib/rateLimits.js";
import { config } from "../lib/config.js";
import { hashPassword, verifyPassword, setSessionCookie, clearSessionCookie } from "../lib/auth.js";

export const authRouter = Router();

// Credential-guessing surface. authBurstLimiter caps total volume; loginLimiter
// counts only failures, so a busy office IP is throttled on wrong passwords
// rather than on successful sign-ins. Tiers are defined in lib/rateLimits.ts.
authRouter.use(["/login", "/register"], authBurstLimiter);

authRouter.get("/login", (req, res) => {
  if (req.session) return res.redirect(config.adminPath || "/");
  res.render("login", { error: null, allowRegistration: config.allowRegistration });
});

authRouter.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body ?? {};
  const fail = (error: string) =>
    res.status(401).render("login", { error, allowRegistration: config.allowRegistration });

  if (!email || !password) return fail("Email and password are required.");

  const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase() } });
  // One message for both branches: distinguishing them tells an attacker which
  // addresses are registered.
  if (!user || !(await verifyPassword(String(password), user.passwordHash))) {
    return fail("Invalid email or password.");
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  setSessionCookie(res, { userId: user.id, email: user.email, v: user.tokenVersion });
  res.redirect(config.adminPath || "/");
});

authRouter.get("/register", (req, res) => {
  if (req.session) return res.redirect(config.adminPath || "/");
  if (!config.allowRegistration) return res.status(404).render("not-found");
  res.render("register", { error: null, needsInviteCode: !!config.registrationInviteCode });
});

authRouter.post("/register", registerLimiter, async (req, res) => {
  // Self-registration is off in production (ALLOW_REGISTRATION=0): this portal
  // publishes installable binaries, so accounts are handed out deliberately with
  // `npm run user:create`, not claimed by whoever finds the URL.
  if (!config.allowRegistration) return res.status(404).render("not-found");

  const { email, password, inviteCode } = req.body ?? {};
  const fail = (error: string) =>
    res.status(400).render("register", { error, needsInviteCode: !!config.registrationInviteCode });

  if (config.registrationInviteCode && String(inviteCode ?? "") !== config.registrationInviteCode) {
    return fail("Invalid invite code.");
  }
  if (!email || !password || String(password).length < 12) {
    return fail("Email and a 12+ character password are required.");
  }

  const normalizedEmail = String(email).toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) return fail("An account with that email already exists.");

  const user = await prisma.user.create({
    data: { email: normalizedEmail, passwordHash: await hashPassword(String(password)) },
  });

  setSessionCookie(res, { userId: user.id, email: user.email, v: user.tokenVersion });
  res.redirect(config.adminPath || "/");
});

authRouter.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.redirect(`${config.adminPath}/login`);
});
