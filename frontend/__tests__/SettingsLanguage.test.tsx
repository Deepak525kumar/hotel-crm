/**
 * @jest-environment jsdom
 *
 * Settings must offer exactly ONE language affordance.
 *
 * It briefly offered two: the live picker in the Appearance card, and a stale
 * "Language — Not available yet" row in the Coming soon list, left over from
 * before the feature shipped. Sitting directly beneath a working selector, the
 * placeholder read as the broken half of a duplicated setting.
 *
 * Pinned rather than just deleted, because the failure mode recurs: every
 * feature that graduates out of COMING_SOON leaves a row behind unless someone
 * remembers to remove it. Dark mode already went through this.
 */
import { render, screen } from "@testing-library/react";
import SettingsPage from "@/app/(protected)/settings/page";
import { useAuth } from "@/hooks/useAuth";
import "@/lib/i18n";

jest.mock("@/hooks/useAuth", () => ({ useAuth: jest.fn() }));
jest.mock("@/lib/api", () => ({
  authApi: { updateProfile: jest.fn().mockResolvedValue({}) },
}));

beforeEach(() => {
  (useAuth as jest.Mock).mockReturnValue({
    user: { id: "u1", email: "worker@example.com", role: "worker" },
  });
});

it("renders exactly one language control", () => {
  render(<SettingsPage />);

  // Scoped by accessible name: Theme is a <select> on this page too, so a bare
  // combobox count would be two by design and would not say anything about
  // duplication of the language setting specifically.
  expect(screen.getAllByRole("combobox", { name: "Language" })).toHaveLength(1);
});

it("no longer advertises Language as unbuilt", () => {
  render(<SettingsPage />);

  expect(screen.queryByText("Not available yet")).not.toBeInTheDocument();
  // The heading itself should be gone while the list is empty, rather than
  // rendering an empty card.
  expect(screen.queryByText("Coming soon")).not.toBeInTheDocument();
});

it("still shows the language row's own label and description", () => {
  render(<SettingsPage />);

  expect(screen.getByText("Language")).toBeInTheDocument();
  expect(screen.getByText("Choose the language used across the app.")).toBeInTheDocument();
});
