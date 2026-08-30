import { Router } from "express";
import crypto from "node:crypto";
import { prisma } from "../lib/db.js";
import { config } from "../lib/config.js";
import { requireAuth, verifyPassword, setSessionCookie } from "../lib/auth.js";
import {
  MIN_PASSWORD_LENGTH,
  RESET_TOKEN_TTL_MS,
  hashResetToken,
  newResetToken,
  passwordProblem,
  setPassword,
} from "../lib/passwords.js";
import { sendEmail } from "../lib/email.js";
import { forgotPasswordLimiter, resetPasswordLimiter, changePasswordLimiter } from "../lib/rateLimits.js";

export const accountRouter = Router();

// ── signed-in account page ────────────────────────────────────────────────────

interface AccountUser {
  id: string;
  email: string;
  createdAt: Date;
  lastLoginAt: Date | null;
}

/** Single renderer for the account page, so both forms show the same state. */
async function renderAccount(
  res: import("express").Response,
  user: AccountUser,
  opts: { error?: string | null; notice?: string | null; status?: number } = {}
) {
  const [uploads, promotions] = await Promise.all([
    prisma.build.count({ where: { userId: user.id } }),
    prisma.promotionEvent.count({ where: { actorEmail: user.email } }),
  ]);

  res.status(opts.status ?? 200).render("account", {
    user,
    uploads,
    promotions,
    minLength: MIN_PASSWORD_LENGTH,
    error: opts.error ?? null,
    notice: opts.notice ?? null,
  });
}

const CHANGE_NOTICES: Record<string, string> = {
  "1": "Password updated. Other sessions have been signed out.",
  password: "Password updated. Other sessions have been signed out.",
  email: "Email address updated. The previous address has been notified.",
};

accountRouter.get("/account", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.session!.userId } });
  if (!user) return res.redirect(`${config.adminPath}/login`);

  const changed = typeof req.query.changed === "string" ? req.query.changed : "";
  await renderAccount(res, user, { notice: CHANGE_NOTICES[changed] ?? null });
});

/**
 * Changes the sign-in address.
 *
 * Gated on the current password for the same reason as a password change: a
 * borrowed, still-signed-in browser must not be enough to move the account to an
 * attacker's address, which would otherwise hand them the password-reset route
 * as well. The old address is notified afterwards, so a change nobody
 * authorised is visible to the person who actually owns the account.
 */
accountRouter.post("/account/email", requireAuth, changePasswordLimiter, async (req, res) => {
  const userId = req.session!.userId;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return res.redirect(`${config.adminPath}/login`);

  const currentPassword = String(req.body?.currentPassword ?? "");
  const newEmail = String(req.body?.newEmail ?? "").trim().toLowerCase();

  const fail = (error: string) => renderAccount(res, user, { error, status: 400 });

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    return fail("Current password is incorrect.");
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail) || newEmail.length > 200) {
    return fail("Enter a valid email address.");
  }
  if (newEmail === user.email) return fail("That is already your email address.");

  const taken = await prisma.user.findUnique({ where: { email: newEmail } });
  if (taken) return fail("Another account already uses that address.");

  await prisma.user.update({ where: { id: userId }, data: { email: newEmail } });

  // Best effort. A delivery failure must not roll back a change the operator
  // successfully made, but it must be visible in the log.
  try {
    await sendEmail({
      to: user.email,
      subject: "Your Version Control sign-in address was changed",
      text: [
        `The sign-in address for your Hotel CRM Version Control account was changed to ${newEmail}.`,
        "",
        "If you did not do this, contact whoever administers the portal immediately —",
        "whoever made the change can now request password resets for this account.",
      ].join("\n"),
    });
  } catch (err) {
    console.error("account/email: could not notify the previous address", err);
  }

  res.redirect(`${config.adminPath}/account?changed=email`);
});

accountRouter.post("/account/password", requireAuth, changePasswordLimiter, async (req, res) => {
  const userId = req.session!.userId;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return res.redirect(`${config.adminPath}/login`);

  const render = (error: string) => renderAccount(res, user, { error, status: 400 });

  const currentPassword = String(req.body?.currentPassword ?? "");
  const newPassword = String(req.body?.newPassword ?? "");
  const confirmPassword = String(req.body?.confirmPassword ?? "");

  // Proving knowledge of the current password is what stops a borrowed, still
  // logged-in browser from being turned into permanent access.
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    return render("Current password is incorrect.");
  }
  if (newPassword !== confirmPassword) return render("New passwords do not match.");

  const problem = passwordProblem(newPassword, user.email);
  if (problem) return render(problem);
  if (newPassword === currentPassword) return render("New password must differ from the current one.");

  await setPassword(userId, newPassword);

  // setPassword bumped tokenVersion, which just invalidated this browser's cookie
  // too — re-issue one so the operator who made the change stays signed in.
  const updated = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  setSessionCookie(res, { userId, email: updated.email, v: updated.tokenVersion });

  res.redirect(`${config.adminPath}/account?changed=password`);
});

// ── forgotten password (public, on the login page) ────────────────────────────

accountRouter.get("/forgot-password", (req, res) => {
  if (req.session) return res.redirect(`${config.adminPath}/account`);
  res.render("forgot-password", { error: null, sent: false });
});

accountRouter.post("/forgot-password", forgotPasswordLimiter, async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();

  // The response is identical whether or not the address exists. Anything else
  // turns this form into a list of who has an account.
  const sent = () => res.render("forgot-password", { error: null, sent: true });

  if (!email) return res.status(400).render("forgot-password", { error: "Enter your email address.", sent: false });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return sent();

  const token = newResetToken();
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashResetToken(token),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      requestedIp: crypto.createHash("sha256").update(req.ip ?? "").digest("hex").slice(0, 16),
    },
  });

  const link = `${config.publicBaseUrl || `http://localhost:${config.port}`}${config.adminPath}/reset-password?token=${encodeURIComponent(token)}`;

  try {
    await sendEmail({
      to: user.email,
      subject: "Reset your Version Control password",
      text: [
        "A password reset was requested for your Hotel CRM Version Control account.",
        "",
        "Open this link within the next hour to choose a new password:",
        link,
        "",
        "The link can be used once. If you did not request this, ignore this email —",
        "your password has not changed.",
      ].join("\n"),
    });
  } catch (err) {
    // Logged, never surfaced: telling the requester that delivery failed would
    // confirm the address exists.
    console.error("forgot-password: delivery failed", err);
  }

  sent();
});

accountRouter.get("/reset-password", async (req, res) => {
  const token = String(req.query.token ?? "");
  const valid = await findUsableToken(token);
  if (!valid) return res.status(400).render("reset-password", { token: "", error: "This reset link is invalid or has expired.", expired: true, minLength: MIN_PASSWORD_LENGTH });
  res.render("reset-password", { token, error: null, expired: false, minLength: MIN_PASSWORD_LENGTH });
});

accountRouter.post("/reset-password", resetPasswordLimiter, async (req, res) => {
  const token = String(req.body?.token ?? "");
  const password = String(req.body?.password ?? "");
  const confirm = String(req.body?.confirmPassword ?? "");

  const record = await findUsableToken(token);
  if (!record) {
    return res.status(400).render("reset-password", {
      token: "",
      error: "This reset link is invalid or has expired.",
      expired: true,
      minLength: MIN_PASSWORD_LENGTH,
    });
  }

  const fail = (error: string) =>
    res.status(400).render("reset-password", { token, error, expired: false, minLength: MIN_PASSWORD_LENGTH });

  if (password !== confirm) return fail("Passwords do not match.");
  const problem = passwordProblem(password, record.user.email);
  if (problem) return fail(problem);

  // setPassword marks every outstanding token used, so this link cannot be
  // replayed and any other pending reset is cancelled at the same moment.
  await setPassword(record.userId, password);

  res.render("reset-password-done", { adminPath: config.adminPath });
});

async function findUsableToken(token: string) {
  if (!token) return null;
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(token) },
    include: { user: true },
  });
  if (!record || record.usedAt || record.expiresAt < new Date()) return null;
  return record;
}
