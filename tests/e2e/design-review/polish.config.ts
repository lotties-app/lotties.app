import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Screenshots of the wave 4c-2 polish pass (illustrated Now/Day/sheet, floating navigation, week
 * strip, nap sheet, day ring, event sheet hero) from the developer-only `/dev/now`, `/dev/day` and
 * `/dev/sheet` previews: a throw-away local database, no sign-in, no API and no stored session.
 * The dev server uses dummy settings and its own port (5176).
 *
 * Run from tests/e2e/: npx playwright test -c design-review/polish.config.ts
 * Output: docs/design/screenshots/polish-*.png (gitignored).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
export const PREVIEW_PORT = Number(process.env.POLISH_PREVIEW_PORT ?? 5176);
export const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

export default defineConfig({
  testDir: '.',
  testMatch: /polish\.review\.ts/,
  timeout: 0,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: PREVIEW_URL, trace: 'off', actionTimeout: 15_000, navigationTimeout: 30_000 },
  webServer: {
    command: `npm --prefix code/web run dev -- --port ${PREVIEW_PORT} --strictPort`,
    cwd: repoRoot,
    url: PREVIEW_URL,
    reuseExistingServer: true,
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
