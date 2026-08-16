import { defineConfig, devices } from "@playwright/test";

/**
 * Browser-level checks for what jsdom (the jest suite) cannot see: real
 * layout. This project's RTL support was previously "checked" only by code
 * reading and unit tests -- which is exactly how a genuinely broken RTL
 * layout (34 physical Tailwind utilities under `dir="rtl"`) and a genuinely
 * broken language switch (the stored locale never reaching i18next) both
 * shipped unnoticed. See e2e/rtl-public.spec.ts and e2e/rtl-protected.spec.ts.
 *
 * Runs against a production build (`next build && next start`), not `next
 * dev`: the dev overlay and dev-only warnings are not representative of what
 * a user sees, and RTL/CSS bugs specifically are the kind dev mode can mask
 * or alter (e.g. different chunk boundaries).
 *
 * No real backend or database is used or required. Every test that needs
 * authenticated data mocks the handful of `/api/v1/*` calls that screen
 * needs via `page.route`, matching this repo's stated policy of never
 * substituting a direct DB write for the path under test -- mocking the
 * network boundary is different from that: the real frontend code, real
 * render tree, and real browser layout engine all still run untouched.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Pinned to the pre-fetched browser this environment ships, rather
        // than the one `playwright install` would otherwise download, since
        // both resolve to the same Playwright build (1.62.1). CI installs
        // its own via `npx playwright install --with-deps chromium` and
        // leaves this unset.
        launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH
          ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
          : undefined,
      },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run start -- -p 3100",
        url: "http://127.0.0.1:3100",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
