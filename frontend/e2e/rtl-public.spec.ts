import { test, expect } from "@playwright/test";

/**
 * The login screen, unauthenticated -- the one screen this repo had actually
 * looked at in a browser before this suite existed (manually, during the
 * i18n review). Pinned here so it stays true automatically.
 *
 * `fhm.locale` is the frontend's own localStorage key (stores/locale.ts) --
 * setting it before first paint is how a returning visitor's choice
 * survives a reload, and it is the same mechanism this test uses to force a
 * language without a signed-in session.
 */
test.describe("login screen", () => {
  test("Arabic: right-to-left direction, translated copy, right-aligned labels", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("fhm.locale", "ar"));
    await page.goto("/login");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");

    // Translated, not the English fallback -- this is the exact defect that
    // shipped once: dir/lang flipped while every string stayed in English.
    await expect(page.getByRole("button", { name: "تسجيل الدخول" })).toBeVisible();

    const emailLabel = page.getByText("البريد الإلكتروني");
    const emailInput = page.getByRole("textbox").first();
    const [labelBox, inputBox] = await Promise.all([emailLabel.boundingBox(), emailInput.boundingBox()]);
    if (!labelBox || !inputBox) throw new Error("expected both elements to be visible");

    // A field's label sits above its input in this form regardless of
    // direction, so vertical position can't tell RTL from LTR. What can:
    // the label's own text is left-aligned relative to ITS box in LTR and
    // right-aligned in RTL. Compare the label's right edge to the input's
    // right edge (both share the input's width) -- in RTL they should be
    // flush; in LTR the label would hug the left edge instead.
    const labelRight = labelBox.x + labelBox.width;
    const inputRight = inputBox.x + inputBox.width;
    expect(Math.abs(labelRight - inputRight)).toBeLessThan(4);
  });

  test("German: left-to-right direction (control case)", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("fhm.locale", "de"));
    await page.goto("/login");

    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(page.getByRole("button", { name: "Anmelden" })).toBeVisible();

    const emailLabel = page.getByText("E-Mail");
    const emailInput = page.getByRole("textbox").first();
    const [labelBox, inputBox] = await Promise.all([emailLabel.boundingBox(), emailInput.boundingBox()]);
    if (!labelBox || !inputBox) throw new Error("expected both elements to be visible");

    // Mirror image of the RTL assertion above: in LTR the label's LEFT edge
    // is flush with the input's left edge.
    expect(Math.abs(labelBox.x - inputBox.x)).toBeLessThan(4);
  });

  test("Urdu: right-to-left direction", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("fhm.locale", "ur"));
    await page.goto("/login");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "ur");
    await expect(page.getByRole("button", { name: "لاگ اِن" })).toBeVisible();
  });
});
