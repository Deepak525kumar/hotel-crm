/**
 * @jest-environment jsdom
 *
 * LocaleProvider's job is to keep three things in step: `<html lang>`,
 * `<html dir>`, and i18next's active catalogue.
 *
 * The third used to drift. i18next is initialised with `lng: initialLocale()`,
 * which reads `navigator.languages` and never consults localStorage, while the
 * store seeds its `locale` from localStorage first. Nothing then forced the two
 * together on the paths that matter: the store applies the language only inside
 * `setLocale`/`reconcileFromServer`, never for its own initial value, and
 * `reconcileFromServer` short-circuits when the server preference already
 * equals the current locale — which is precisely a returning user. The result
 * was a page carrying `dir="rtl"` and `lang="ar"` while still rendering
 * English, and public screens (login, password reset) never reconciled at all.
 *
 * These tests pin the invariant rather than the bug: whatever the store says,
 * i18next must agree.
 */
import { render, waitFor } from "@testing-library/react";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { useLocaleStore } from "@/stores/locale";
import { useAuthStore } from "@/stores/auth";
import i18n from "@/lib/i18n";

jest.mock("@/lib/api", () => ({
  authApi: { updateProfile: jest.fn().mockResolvedValue({}) },
}));

function mount(locale: "de" | "ar" | "fr", authed = false) {
  useLocaleStore.setState({ locale, reconciled: true });
  useAuthStore.setState({
    status: authed ? "authenticated" : "unauthenticated",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  return render(
    <LocaleProvider>
      <span>child</span>
    </LocaleProvider>,
  );
}

describe("LocaleProvider", () => {
  it("drives i18next from the store's locale, not the browser's", async () => {
    // The bug's exact shape: i18next sitting on a different language than the
    // store, with nothing on the render path to correct it.
    await i18n.changeLanguage("en");

    mount("ar");

    await waitFor(() => expect(i18n.language).toBe("ar"));
  });

  it("sets lang and dir to match, so direction never leads the catalogue", async () => {
    mount("ar");

    await waitFor(() => {
      expect(document.documentElement.lang).toBe("ar");
      expect(document.documentElement.dir).toBe("rtl");
      expect(i18n.language).toBe("ar");
    });
  });

  it("returns to ltr for a left-to-right locale", async () => {
    mount("fr");

    await waitFor(() => {
      expect(document.documentElement.dir).toBe("ltr");
      expect(i18n.language).toBe("fr");
    });
  });

  it("applies the locale for a signed-out visitor (public login screen)", async () => {
    // Unauthenticated users never reach reconcileFromServer's apply path, so
    // this is the case that regressed hardest.
    await i18n.changeLanguage("en");

    mount("de", false);

    await waitFor(() => expect(i18n.language).toBe("de"));
  });

  // Regression test (found 2026-09-02 by real E2E probing, scenario 13):
  // this is a NEW instance of the exact bug class this file's own header
  // comment describes, one layer further back. The login response was
  // missing preferred_language (fixed separately, backend) -- but even with
  // it present, the UI stayed in the wrong language/direction after a real
  // login until a manual reload.
  //
  // Root cause: the public login screen (unauthenticated) already flips
  // `reconciled` to true, so the app can render THAT screen in a negotiated
  // language too. router.replace("/dashboard") after a successful login is
  // client-side navigation -- LocaleProvider never remounts, so `reconciled`
  // never resets, and its reconciliation effect's own guard then silently
  // skips the newly-authenticated user's REAL preference for the rest of
  // the session. Fixed by having the auth store's setUser() action -- the
  // one call in the app that only ever carries fresh, authoritative server
  // data -- reconcile the locale store directly, unconditionally, rather
  // than relying on this component's gated effect to notice.
  //
  // Deliberately does NOT render <LocaleProvider>: the fix lives in
  // stores/auth.ts's setUser, not here, so this proves the fix holds even
  // with no component in the tree to help it along.
  it("reconciles the locale on a real login, even though the public screen already marked reconciled=true", async () => {
    // The unauthenticated login/password-reset screen's own reconciliation --
    // exactly what leaves `reconciled: true` sitting there before login.
    useLocaleStore.setState({ locale: "en", reconciled: true });
    await i18n.changeLanguage("en");

    // Not useAuthStore.setState -- the real action, so this actually
    // exercises the fix rather than bypassing it the way `mount()` above
    // deliberately does for the other tests in this file.
    useAuthStore.getState().setUser({
      id: "u1",
      email: "u@test.com",
      first_name: "U",
      last_name: "1",
      role: "worker",
      permissions: [],
      is_active: true,
      employment_status: null,
      preferred_language: "ar",
      created_at: new Date().toISOString(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await waitFor(() => {
      expect(useLocaleStore.getState().locale).toBe("ar");
      expect(i18n.language).toBe("ar");
    });
  });
});
