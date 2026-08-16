/**
 * @jest-environment jsdom
 *
 * The language control must actually render, with every shipped locale in it.
 *
 * This is pinned because the control's absence was reported as a bug and was
 * in fact a deployment gap — `main` had no i18n at all — but the same symptom
 * (a settings page with a Theme row and nothing under it) would also be
 * produced by the picker silently rendering nothing. A test tells the two
 * apart on any branch.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LanguageSelect } from "@/components/i18n/LanguageSwitcher";
import { useLocaleStore } from "@/stores/locale";
import { UI_LOCALES, LOCALE_LABELS } from "@/lib/locales";
import { authApi } from "@/lib/api";

jest.mock("@/lib/api", () => ({
  authApi: { updateProfile: jest.fn().mockResolvedValue({}) },
}));

beforeEach(() => {
  useLocaleStore.setState({ locale: "de", reconciled: true });
  (authApi.updateProfile as jest.Mock).mockClear();
});

it("renders a select carrying all six shipped locales", () => {
  render(<LanguageSelect />);

  const select = screen.getByRole("combobox");
  expect(select).toBeInTheDocument();
  expect(screen.getAllByRole("option")).toHaveLength(UI_LOCALES.length);
});

it("labels each option with its endonym, not a translated name", () => {
  render(<LanguageSelect />);

  // A user who reads only Arabic must be able to find their language.
  for (const code of UI_LOCALES) {
    expect(screen.getByRole("option", { name: LOCALE_LABELS[code] })).toBeInTheDocument();
  }
});

it("switches the locale and persists the choice", async () => {
  render(<LanguageSelect />);

  await userEvent.selectOptions(screen.getByRole("combobox"), "ar");

  expect(useLocaleStore.getState().locale).toBe("ar");
  expect(authApi.updateProfile).toHaveBeenCalledWith({ preferred_language: "ar" });
});
