import { test, expect, type Page } from "@playwright/test";

/**
 * RTL inside the authenticated shell -- the surface nobody had looked at in
 * a browser before this suite. The earlier manual check (during the i18n
 * review) covered only /login; everything behind AuthGuard was verified by
 * code reading and the mechanical "every logical utility compiles to real
 * CSS" check, not by sight.
 *
 * No real backend: `/api/v1/*` is mocked per test via page.route. That is a
 * deliberate, narrow exception to this repo's "verify at the data layer,
 * never substitute a mock for the path under test" rule -- there is no
 * database available to this suite, and the alternative is not testing
 * these screens in a browser at all, which is the gap this file exists to
 * close. The mock is confined to the network boundary; the React tree, the
 * router, the guards, and the browser's own layout engine are all real.
 */

const ADMIN_USER = {
  id: "e2e-admin",
  email: "admin@example.com",
  first_name: "Admin",
  last_name: "User",
  role: "admin" as const,
  permissions: [],
  preferred_language: null,
  is_active: true,
  employment_status: null,
  created_at: new Date().toISOString(),
};

async function signInAs(page: Page, locale: "ar" | "de") {
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({ json: { data: ADMIN_USER } }),
  );
  // Admin has no EmploymentRecord by design (ADR-065) -- null is the
  // correct, common response, not a stand-in for missing data.
  await page.route("**/api/v1/employees/by-user/**", (route) =>
    route.fulfill({ json: { data: null } }),
  );
  await page.route("**/api/v1/notifications", (route) =>
    route.fulfill({ json: { data: [] } }),
  );
  await page.addInitScript((l) => window.localStorage.setItem("fhm.locale", l), locale);
}

/**
 * Which edge of `locator`'s own box its rendered text content hugs.
 *
 * `getComputedStyle(...).textAlign` cannot answer this for `text-start`/
 * `text-end`: Chromium reports those keywords back literally regardless of
 * `dir` (CSS Text Module Level 3 keeps them as valid *computed* values --
 * resolution to a physical side happens only at paint time). Measuring the
 * actual rendered position is the only way to observe what the class
 * conversion in this PR was meant to guarantee.
 */
async function textHugsSide(locator: import("@playwright/test").Locator): Promise<"left" | "right"> {
  return locator.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(el);
    const text = range.getBoundingClientRect();
    const gapLeft = text.left - box.left;
    const gapRight = box.right - text.right;
    return gapLeft < gapRight ? "left" : "right";
  });
}

test.describe("authenticated shell", () => {
  test("Arabic: sidebar border and translated nav sit on the writing-direction side", async ({ page }) => {
    await signInAs(page, "ar");
    await page.route("**/api/v1/users**", (route) => route.fulfill({ json: { data: [] } }));

    await page.goto("/users");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    // The sidebar carries `border-e` (logical "border at the end"). Under
    // RTL that must compute to the LEFT edge -- this is the exact class of
    // bug the earlier physical-utility conversion fixed: `border-r` would
    // stay on the right regardless of direction and silently fail this.
    const sidebar = page.locator("aside").first();
    await expect(sidebar).toBeVisible();
    const border = await sidebar.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { left: parseFloat(cs.borderLeftWidth), right: parseFloat(cs.borderRightWidth) };
    });
    expect(border.left).toBeGreaterThan(0);
    expect(border.right).toBe(0);

    // Sidebar itself renders flush against the viewport's start edge, which
    // in RTL is the right edge.
    const box = await sidebar.boundingBox();
    const viewport = page.viewportSize();
    if (!box || !viewport) throw new Error("expected sidebar and viewport to be measurable");
    expect(viewport.width - (box.x + box.width)).toBeLessThan(2);

    await expect(page.getByRole("heading", { name: "المستخدمون" })).toBeVisible();
  });

  test("Arabic: table cells align to the end (right) edge of their column", async ({ page }) => {
    await signInAs(page, "ar");
    await page.route("**/api/v1/users**", (route) =>
      route.fulfill({
        json: {
          data: [
            {
              id: "u1",
              email: "worker@example.com",
              first_name: "Test",
              last_name: "Worker",
              role: "worker",
              is_active: true,
              created_at: new Date().toISOString(),
            },
          ],
        },
      }),
    );

    await page.goto("/users");

    // `<td>` inherits `text-start` from the `<table>` element cleanly.
    // (`<th>` does not: it carries a browser-default `text-align: center`
    // that the component never overrides, a separate, pre-existing,
    // direction-independent fact about header cells specifically -- not
    // something this suite's RTL fix touched, and not asserted here.)
    // The Name column happens to size exactly to its content in this
    // fixture (no room either side to measure), so Email is the target --
    // same table, same `text-start` inheritance, genuinely stretched wider
    // than its text.
    const emailCell = page.getByRole("cell", { name: "worker@example.com" });
    await expect(emailCell).toBeVisible();
    // If this had stayed the physical `text-left` this repo shipped with,
    // the text would hug the left edge here regardless of direction.
    expect(await textHugsSide(emailCell)).toBe("right");
  });

  test("German: sidebar border and table alignment sit on the left (control case)", async ({ page }) => {
    await signInAs(page, "de");
    await page.route("**/api/v1/users**", (route) =>
      route.fulfill({
        json: {
          data: [
            {
              id: "u1",
              email: "worker@example.com",
              first_name: "Test",
              last_name: "Worker",
              role: "worker",
              is_active: true,
              created_at: new Date().toISOString(),
            },
          ],
        },
      }),
    );

    await page.goto("/users");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");

    const sidebar = page.locator("aside").first();
    const border = await sidebar.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { left: parseFloat(cs.borderLeftWidth), right: parseFloat(cs.borderRightWidth) };
    });
    expect(border.right).toBeGreaterThan(0);
    expect(border.left).toBe(0);

    const box = await sidebar.boundingBox();
    if (!box) throw new Error("expected sidebar to be measurable");
    expect(box.x).toBeLessThan(2);

    const emailCell = page.getByRole("cell", { name: "worker@example.com" });
    expect(await textHugsSide(emailCell)).toBe("left");
  });
});
