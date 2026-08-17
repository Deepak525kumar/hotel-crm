import { ConsentService } from '../modules/consent/service.js';
import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from '../modules/consent/types.js';
import { UI_LOCALES } from '../lib/locales.js';

describe('ADR-068 — notice follows the selected language', () => {
  const svc = new ConsentService();

  it('serves a Ukrainian notice to a uk user, not the German default', async () => {
    const r = await svc.requestConsent('daily-access-gate', 'uk');
    expect(r.language).toBe('uk');
    expect(r.language).not.toBe(DEFAULT_LANGUAGE);
    expect(r.notice_content).toContain('[uk]');
    expect(r.rtl).toBe(false);
  });

  it('serves every UI locale in its own language', async () => {
    for (const locale of UI_LOCALES) {
      const r = await svc.requestConsent('daily-access-gate', locale);
      expect(r.language).toBe(locale);
      expect(r.notice_content).toContain(`[${locale}]`);
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
