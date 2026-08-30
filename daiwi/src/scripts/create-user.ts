import "../lib/loadEnv.js";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { prisma } from "../lib/db.js";
import { hashPassword } from "../lib/auth.js";

/**
 * Creates an operator account. This is how accounts are issued in production,
 * where ALLOW_REGISTRATION is off — a publicly reachable /register on a service
 * that publishes installable binaries is not something to leave open.
 *
 *   npm run user:create
 *   npm run user:create -- ops@example.com
 */
async function main() {
  const rl = readline.createInterface({ input: stdin, output: stdout });

  const email = (process.argv[2] ?? (await rl.question("Email: "))).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error(`"${email}" is not a valid email address`);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new Error(`${email} already has an account`);

  // Not hidden while typing: Node has no portable no-echo prompt, and a wrong
  // password here is worse than a shell-history-free terminal echo.
  const password = (await rl.question("Password (12+ chars): ")).trim();
  if (password.length < 12) throw new Error("password must be at least 12 characters");

  const confirm = (await rl.question("Confirm password: ")).trim();
  if (password !== confirm) throw new Error("passwords do not match");

  rl.close();

  await prisma.user.create({ data: { email, passwordHash: await hashPassword(password) } });
  console.log(`Created operator account ${email}`);
}

main()
  .catch((err) => {
    console.error(`\nFailed: ${(err as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
