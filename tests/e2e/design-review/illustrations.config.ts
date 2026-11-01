import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Screenshots of the illustrated category icons from the developer-only `/dev/illustrations`
 * gallery: no sign-in, no API, no stored session, no database. The dev server uses dummy settings
 * and its own port (5175), so it never collides with the other previews (5174).
 *
 * Run from tests/e2e/: npx playwright test -c design-review/illustrations.config.ts
 * Output: docs/design/screenshots/illustrations-*.png (gitignored).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
export const PREVIEW_PORT = Number(process.env.ILLUSTRATIONS_PREVIEW_PORT ?? 5175);
export const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

export default defineConfig({
  testDir: '.',
  testMatch: /illustrations\.review\.ts/,
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
    // Dummy values: the gallery never signs in or calls a server.
    env: {
      VITE_API_BASE_URL: 'http://localhost:5299',
      VITE_OIDC_AUTHORITY: 'http://localhost:5299/realms/dev',
      VITE_OIDC_CLIENT_ID: 'dev-preview',
      VITE_OIDC_AUDIENCE: 'dev-preview',
    },
  },
});
