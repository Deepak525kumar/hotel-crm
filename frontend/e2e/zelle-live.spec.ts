import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

/**
 * Zelle in a REAL browser, against a REAL backend and the LIVE model.
 *
 * Unlike the RTL specs beside it, nothing here is mocked: the web app's /api
 * proxy reaches a real backend, which reaches the real database and the real
 * model. It covers what the unit suite structurally cannot:
 *
 *   - History really lists this person's stored conversations and reads one
 *     back from the server;
 *   - Copy really puts the conversation on the clipboard;
 *   - the pre-filled New user form link, produced by a live model turn,
 *     really opens the form with the details filled in.
 *
 * SKIPPED unless ZELLE_LIVE=1, because it needs a running seeded backend, AWS
 * credentials, and costs model calls. To run:
 *
 *   cd backend && E2E_PORT=3001 SERVE_FOR_BROWSER=/tmp/zelle-creds.json \
 *     RESEND_API_KEY= npx tsx scripts/chatbot-e2e-conversations.ts &
 *   cd frontend && npx next start -p 3100 &
 *   ZELLE_LIVE=1 ZELLE_CREDS=/tmp/zelle-creds.json E2E_BASE_URL=http://127.0.0.1:3100 \
 *     npx playwright test e2e/zelle-live.spec.ts
 */
const LIVE = process.env.ZELLE_LIVE === "1";

test.describe("Zelle, live", () => {
  test.skip(!LIVE, "needs a live seeded backend and AWS (set ZELLE_LIVE=1)");
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  test("History, Copy and the pre-filled form link work in a real browser", async ({ page, context }) => {
    const creds = JSON.parse(readFileSync(process.env.ZELLE_CREDS as string, "utf8")) as {
      email: string;
      password: string;
    };
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    // ---- a real login ----------------------------------------------------
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(creds.email);
    await page.locator('input[type="password"]').fill(creds.password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

    // ---- the full-page assistant ----------------------------------------
    await page.goto("/assistant");
    const composer = page.getByRole("textbox", { name: "Message" });
    await expect(composer).toBeVisible({ timeout: 30_000 });

    // L0 intent: answered without the model.
    await composer.fill("how much work did we do");
    await composer.press("Enter");
    await expect(page.getByText(/across your hotels/)).toBeVisible({ timeout: 60_000 });

    // A live model turn that must produce the one clickable link.
    await composer.fill("create an account for Mukesh Kumar, phone 016090744182, he is a worker");
    await composer.press("Enter");
    const formLink = page.getByRole("link", { name: "Open the filled-in New user form" });
    await expect(formLink).toBeVisible({ timeout: 90_000 });

    // ---- Copy ------------------------------------------------------------
    await page.getByRole("button", { name: "Copy" }).click();
    await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain("You: how much work did we do");
    expect(copied).toContain("Zelle:");

    // ---- History, read back from the server -----------------------------
    await page.getByRole("button", { name: "History" }).click();
    // .first(): History is newest first, and a re-run against the same seeded
    // manager already has an earlier conversation that opened the same way.
    const past = page.getByRole("button", { name: /how much work did we do/ }).first();
    await expect(past).toBeVisible({ timeout: 30_000 });
    await past.click();
    await expect(page.getByText(/across your hotels/).first()).toBeVisible({ timeout: 30_000 });
    // A past conversation is read-only.
    await expect(page.getByRole("button", { name: "Confirm" })).toHaveCount(0);
    await page.getByRole("button", { name: "Back to chat" }).click();

    // ---- the pre-filled form --------------------------------------------
    await page.getByRole("link", { name: "Open the filled-in New user form" }).click();
    await page.waitForURL(/\/users\/new/, { timeout: 30_000 });
    await expect(page.getByLabel("First name")).toHaveValue("Mukesh", { timeout: 30_000 });
    await expect(page.getByLabel("Phone")).toHaveValue("+4916090744182");
    // The details are taken out of the address bar once read.
    expect(page.url()).not.toContain("#");
  });
});
