/**
 * @jest-environment jsdom
 *
 * The two sentences that wrap JSX mid-phrase and therefore use `<Trans>`
 * rather than `t()`.
 *
 * These are the fragile ones: `<Trans>` matches catalogue placeholders like
 * `<link>…</link>` by NAME against the `components` object, so a mismatch fails
 * silently at runtime -- the wrapper element is dropped and the inner text
 * renders bare, which neither `tsc` nor a render-without-assertion notices.
 *
 * This test caught two real defects before they shipped, neither visible to
 * the type-checker:
 *
 *   1. The catalogue originally used `<1>…</1>` against an ARRAY of
 *      components, which is ZERO-indexed -- `<1>` matched nothing, and the
 *      assignment link rendered as plain text with no anchor at all.
 *   2. Renaming the placeholder to `<link>` looked correct but is worse:
 *      `<link>` is a VOID HTML element, so the parser self-closes it and
 *      discards the wrapped text entirely.
 *
 * Hence `<assignmentLink>` / `<name>` -- descriptive, and deliberately not
 * names of real HTML elements. Asserting both the composed sentence and the
 * surviving element pins each half.
 */
import { render, screen } from "@testing-library/react";
import Link from "next/link";
import { Trans } from "react-i18next";
import i18n from "@/lib/i18n";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

it("renders the attendance check-out sentence with its embedded link", () => {
  render(
    <Trans
      i18nKey="attendance.checkedInUseAssignment"
      components={{ assignmentLink: <Link href="/assignments/a1" /> }}
    />,
  );

  const link = screen.getByRole("link", { name: "assignment page" });
  expect(link).toHaveAttribute("href", "/assignments/a1");
  // The full sentence composes around the link rather than dropping either half.
  expect(document.body).toHaveTextContent(
    "You are checked in. Use the assignment page to check out and complete your shift.",
  );
  // A positional mismatch would leave the raw placeholder visible.
  expect(document.body.textContent).not.toMatch(/<\d>/);
});

it("renders the revoke-access sentence with the user's name interpolated", () => {
  render(
    <Trans
      i18nKey="users.revokeAccessFor"
      values={{ name: "Fatima Ahmed" }}
      components={{ name: <span className="font-medium" /> }}
    />,
  );

  expect(document.body).toHaveTextContent(
    "This revokes access for Fatima Ahmed. You can reactivate the account from the edit screen.",
  );
  expect(document.body.textContent).not.toMatch(/<\d>|\{\{name\}\}/);
});

it("composes both sentences in Arabic without dropping the interpolated parts", async () => {
  await i18n.changeLanguage("ar");

  const { unmount } = render(
    <Trans
      i18nKey="users.revokeAccessFor"
      values={{ name: "Fatima Ahmed" }}
      components={{ name: <span className="font-medium" /> }}
    />,
  );
  // The name survives into the Arabic sentence, and no placeholder leaks.
  expect(document.body).toHaveTextContent("Fatima Ahmed");
  expect(document.body.textContent).not.toMatch(/<\d>|\{\{name\}\}/);
  unmount();

  render(
    <Trans
      i18nKey="attendance.checkedInUseAssignment"
      components={{ assignmentLink: <Link href="/assignments/a1" /> }}
    />,
  );
  expect(screen.getByRole("link")).toHaveAttribute("href", "/assignments/a1");
  expect(document.body.textContent).not.toMatch(/<\d>/);

  await i18n.changeLanguage("en");
});
