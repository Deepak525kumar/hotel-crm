import { ConsentService } from '../modules/consent/service.js';
import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from '../modules/consent/types.js';
import { UI_LOCALES } from '../lib/locales.js';

describe('ADR-068 — notice follows the selected language', () => {
  const svc = new ConsentService();

  it('resolves a uk requester to the uk language claim, not the German default', async () => {
    const r = await svc.requestConsent('daily-access-gate', 'uk');
    expect(r.language).toBe('uk');
    expect(r.language).not.toBe(DEFAULT_LANGUAGE);
    expect(r.rtl).toBe(false);
  });

  // Only a German (DPO-authored) notice text exists so far -- every other
  // SUPPORTED_LANGUAGES entry serves that same text until its own
  // translation is authored (see NOTICE_CONTENT in consent/service.ts).
  // This asserts the `language`/`rtl` resolution per locale, not the text
  // itself, which is identical across languages today by design.
  it('resolves every UI locale to its own language claim and serves the current notice text', async () => {
    for (const locale of UI_LOCALES) {
      const r = await svc.requestConsent('daily-access-gate', locale);
      expect(r.language).toBe(locale);
      expect(r.notice_content).toContain('FHM Hotelservice GmbH');
    }
  });

  it('still falls back to the default for a genuinely unsupported language', async () => {
    const r = await svc.requestConsent('daily-access-gate', 'zz');
    expect(r.language).toBe(DEFAULT_LANGUAGE);
  });

  it('keeps RTL correct: ar/ur only, uk is LTR', async () => {
    for (const l of SUPPORTED_LANGUAGES) {
      const r = await svc.requestConsent('daily-access-gate', l);
      expect(r.rtl).toBe(l === 'ar' || l === 'ur');
    }
  });
});
