import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Screenshots of the themed scrollbars (docs/DESIGN.md "Scrollbars") and the More sheet order and
 * search: the More sheet, a long page (the Day timeline) and a dialog (the event sheet), in the
 * light, dark and night schemes, on a phone width (390) and a desktop (1280), from the
 * credential-free `/dev/day` and `/dev/sheet` previews (throw-away local database, no sign-in, no
 * API). Scrollbars are drawn (Playwright hides them by default in headless Chromium).
 *
 * Run from tests/e2e/: SCROLLBAR_PHASE=before|after npx playwright test -c design-review/scrollbar.config.ts
 * Output: docs/design/screenshots/scrollbar-<phase>-*.png (gitignored).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
export const PREVIEW_PORT = Number(process.env.SCROLLBAR_PREVIEW_PORT ?? 5196);
export const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

export default defineConfig({
  testDir: '.',
  testMatch: /scrollbar\.review\.ts/,
  timeout: 0,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: PREVIEW_URL,
    trace: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] },
  },
  webServer: {
    command: `npm --prefix code/web run dev -- --port ${PREVIEW_PORT} --strictPort`,
    cwd: repoRoot,
    url: PREVIEW_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    // Dummy values: the preview routes never sign in or call a server.
    env: {
      VITE_API_BASE_URL: 'http://localhost:5299',
      VITE_OIDC_AUTHORITY: 'http://localhost:5299/realms/dev',
      VITE_OIDC_CLIENT_ID: 'dev-preview',
      VITE_OIDC_AUDIENCE: 'dev-preview',
    },
  },
});
