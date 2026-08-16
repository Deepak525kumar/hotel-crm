import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  UI_LOCALES,
  DEFAULT_UI_LOCALE,
  LOCALE_LABELS,
  isUiLocale,
  isRtlLocale,
  dirFor,
  negotiateLocale,
} from "@/lib/locales";

import de from "@/lib/i18n/locales/de.json";
import en from "@/lib/i18n/locales/en.json";
import ur from "@/lib/i18n/locales/ur.json";
import ar from "@/lib/i18n/locales/ar.json";
import fr from "@/lib/i18n/locales/fr.json";
import uk from "@/lib/i18n/locales/uk.json";

type Catalogue = Record<string, unknown>;
const CATALOGUES: Record<string, Catalogue> = { de, en, ur, ar, fr, uk };

/** Dotted key paths, ignoring the `_meta` bookkeeping block. */
function keyPaths(obj: Catalogue, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    if (prefix === "" && key === "_meta") return [];
    const path = prefix ? `${prefix}.${key}` : key;
    return value !== null && typeof value === "object"
      ? keyPaths(value as Catalogue, path)
      : [path];
  });
}

describe("locale contract", () => {
  it("ships the six owner-approved locales", () => {
    expect([...UI_LOCALES]).toEqual(["de", "en", "ur", "ar", "fr", "uk"]);
  });

  it("falls back to the platform primary-market language", () => {
    expect(DEFAULT_UI_LOCALE).toBe("de");
  });

  it("flips direction for exactly Arabic and Urdu", () => {
    expect(UI_LOCALES.filter(isRtlLocale).sort()).toEqual(["ar", "ur"]);
    expect(dirFor("ar")).toBe("rtl");
    expect(dirFor("de")).toBe("ltr");
  });

  it("rejects values outside the contract", () => {
    expect(isUiLocale("de")).toBe(true);
    // Consent-supported (CRR §32) but not UI-translated — must not be
    // offered in the picker.
    expect(isUiLocale("ru")).toBe(false);
    expect(isUiLocale(undefined)).toBe(false);
  });

  // The frontend list is a hand-maintained mirror of backend/src/lib/locales.ts.
  // Read the backend file as text rather than importing it (no cross-package
  // build dependency) so this fails loudly the moment the two drift.
  it("matches the backend locale contract", () => {
    const backend = readFileSync(
      join(__dirname, "../../backend/src/lib/locales.ts"),
      "utf8",
    );
    const listed = backend
      .match(/export const UI_LOCALES = \[([^\]]+)\]/)?.[1]
      .match(/'([a-z-]+)'/g)
      ?.map((quoted) => quoted.replace(/'/g, ""));
    expect(listed).toEqual([...UI_LOCALES]);
    expect(backend).toMatch(/DEFAULT_UI_LOCALE: UiLocale = 'de'/);
  });
});

describe("negotiateLocale", () => {
  it("drops region subtags and takes the first supported match", () => {
    expect(negotiateLocale(["de-AT", "en-US"])).toBe("de");
    expect(negotiateLocale(["pt-BR", "fr-CA"])).toBe("fr");
  });

  it("returns null rather than a default when nothing matches", () => {
    expect(negotiateLocale(["pt", "zh"])).toBeNull();
    expect(negotiateLocale([])).toBeNull();
  });
});

describe("translation catalogues", () => {
  it("has a catalogue for every shipped locale", () => {
    expect(Object.keys(CATALOGUES).sort()).toEqual([...UI_LOCALES].sort());
  });

  // English is the source catalogue; every other locale must carry exactly
  // its key set. A missing key silently renders German at runtime (the
  // i18next fallback), which is easy to ship without noticing — this test is
  // what makes that visible in CI instead.
  it.each(UI_LOCALES.filter((l) => l !== "en"))(
    "%s has the same keys as the English source",
    (locale) => {
      const expected = keyPaths(en as Catalogue).sort();
      const actual = keyPaths(CATALOGUES[locale]).sort();
      expect({ locale, missing: expected.filter((k) => !actual.includes(k)) }).toEqual({
        locale,
        missing: [],
      });
      expect({ locale, extra: actual.filter((k) => !expected.includes(k)) }).toEqual({
        locale,
        extra: [],
      });
    },
  );

  it("has no empty strings", () => {
    for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
      const flat = JSON.stringify(catalogue);
      expect({ locale, hasEmpty: /:\s*""/.test(flat) }).toEqual({ locale, hasEmpty: false });
    }
  });

  it("names every language by its own endonym in the picker", () => {
    for (const locale of UI_LOCALES) {
      expect(LOCALE_LABELS[locale]?.length).toBeGreaterThan(0);
    }
    // Guards the specific mistake this is meant to prevent: labelling a
    // language in English rather than in itself.
    expect(LOCALE_LABELS.de).toBe("Deutsch");
    expect(LOCALE_LABELS.ar).not.toMatch(/arabic/i);
  });

  // Machine-translated catalogues are flagged so a reviewer can find them.
  // This asserts the flags are HONEST, not that everything is reviewed:
  // de/en were authored here, the other four were not.
  it("marks the machine-translated catalogues as unreviewed", () => {
    const reviewed = (c: Catalogue) => (c._meta as { reviewed?: boolean })?.reviewed;
    expect(reviewed(de)).toBe(true);
    expect(reviewed(en)).toBe(true);
    for (const locale of ["ur", "ar", "fr", "uk"] as const) {
      expect({ locale, reviewed: reviewed(CATALOGUES[locale]) }).toEqual({
        locale,
        reviewed: false,
      });
    }
  });
});
