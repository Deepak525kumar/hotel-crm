import fs from "node:fs";
import path from "node:path";

/**
 * Loads .env before any other module reads process.env.
 *
 * Prisma pulls in .env as a side effect of importing @prisma/client, but that
 * happens *after* modules like ./auth.js have already captured SESSION_SECRET
 * at import time — so without this the app silently falls back to the hardcoded
 * dev secret. Must be the first import in server.ts (ESM evaluates in order).
 *
 * Real environment variables always win, so this is a no-op in production
 * deployments that inject config directly.
 */
export function loadEnv(file = path.resolve(process.cwd(), ".env")): void {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return; // no .env — config comes from the real environment
  }

  for (const line of raw.split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;

    const [, key, rest] = match;
    if (key in process.env) continue;

    let value = rest.trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length > 1) {
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, "\n");
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    process.env[key] = value;
  }
}

loadEnv();
