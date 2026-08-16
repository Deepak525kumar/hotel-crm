/**
 * @jest-environment jsdom
 *
 * Runtime behaviour of the locale store: the reconcile rules and the
 * failure/rollback path. These are the parts that decide what a user
 * actually sees, as opposed to the static contract covered by locales.test.ts.
 */
import { authApi } from "@/lib/api";
import { useLocaleStore } from "@/stores/locale";
import i18n from "@/lib/i18n";

jest.mock("@/lib/api", () => ({
  authApi: { updateProfile: jest.fn() },
}));

const updateProfile = authApi.updateProfile as jest.Mock;

function reset(locale: "de" | "en" | "ar" | "fr" = "de") {
  useLocaleStore.setState({ locale, reconciled: false });
  window.localStorage.clear();
  updateProfile.mockReset();
}

describe("setLocale", () => {
  it("applies the language and persists it to the server", async () => {
    reset("de");
    updateProfile.mockResolvedValue({});

    await useLocaleStore.getState().setLocale("fr");

    expect(useLocaleStore.getState().locale).toBe("fr");
    expect(i18n.language).toBe("fr");
    expect(updateProfile).toHaveBeenCalledWith({ preferred_language: "fr" });
    // Cached so a reload before /auth/me resolves still opens in French.
    expect(window.localStorage.getItem("fhm.locale")).toBe("fr");
  });

  // The user asked for a language and the server refused. Showing French
  // while German is what actually got saved would be a lie the next reload
  // exposes, so the store rolls back and the caller reports the failure.
  it("rolls back to the previous locale when the server rejects it", async () => {
    reset("de");
    updateProfile.mockRejectedValue(new Error("500"));

    await expect(useLocaleStore.getState().setLocale("fr")).rejects.toThrow();

    expect(useLocaleStore.getState().locale).toBe("de");
    expect(i18n.language).toBe("de");
    expect(window.localStorage.getItem("fhm.locale")).toBe("de");
  });
});

describe("reconcileFromServer", () => {
  it("lets a stored preference win over the device-negotiated guess", () => {
    reset("de");
    useLocaleStore.getState().reconcileFromServer("ar");

    expect(useLocaleStore.getState().locale).toBe("ar");
    expect(useLocaleStore.getState().reconciled).toBe(true);
  });

  // A null preference means "never chosen". Writing the negotiated guess
  // back would convert an inference into an explicit choice and pin the user
  // to this device's locale on every other device they sign in from.
  it("keeps the negotiated locale and stores nothing when no preference exists", () => {
    reset("en");
    useLocaleStore.getState().reconcileFromServer(null);

    expect(useLocaleStore.getState().locale).toBe("en");
    expect(window.localStorage.getItem("fhm.locale")).toBeNull();
    expect(useLocaleStore.getState().reconciled).toBe(true);
  });

  it("ignores a value outside the supported set", () => {
    reset("de");
    // 'ru' is consent-supported but has no UI catalogue; rendering it would
    // fall back to German anyway, so the locale must not change.
    useLocaleStore.getState().reconcileFromServer("ru");

    expect(useLocaleStore.getState().locale).toBe("de");
    expect(useLocaleStore.getState().reconciled).toBe(true);
  });
});

describe("translation lookup", () => {
  it("renders the requested language", async () => {
    await i18n.changeLanguage("fr");
    expect(i18n.t("common.save")).toBe("Enregistrer");
    await i18n.changeLanguage("ar");
    expect(i18n.t("common.save")).toBe("حفظ");
  });

  // What fallbackLng actually guarantees: a key present in German but
  // missing from a partially-translated locale renders the German copy.
  // This is the realistic case -- four of the six catalogues are
  // machine-translated and will gain keys later than de/en do.
  it("falls back to German for a key missing from one locale", async () => {
    const fr = i18n.getResourceBundle("fr", "translation");
    const saved = fr.common.save;
    delete fr.common.save;
    try {
      await i18n.changeLanguage("fr");
      expect(i18n.t("common.save")).toBe("Speichern");
    } finally {
      fr.common.save = saved;
    }
  });

  // A key missing from EVERY locale is a code bug, not a translation gap.
  // i18next returns the key path, which is deliberately loud -- asserted
  // here so nobody "fixes" it into a silent empty string later.
  it("returns the key path when a key exists nowhere", async () => {
    await i18n.changeLanguage("fr");
    expect(i18n.t("this.key.does.not.exist")).toBe("this.key.does.not.exist");
  });

  it("never renders the _meta bookkeeping block as copy", async () => {
    await i18n.changeLanguage("fr");
    // _meta carries the "MACHINE-TRANSLATED, NOT REVIEWED" warning; it must
    // never reach a user's screen.
    expect(i18n.t("_meta.note")).not.toMatch(/MACHINE-TRANSLATED/);
  });
});
