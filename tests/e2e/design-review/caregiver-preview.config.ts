import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Screenshots of the Caregiver role (docs/DESIGN.md section 13) from the developer-only
 * `/dev/day?state=caregiver` and `/dev/roles` previews: a throw-away local database and an
 * in-memory API, no sign-in and no stored session, so nothing here touches the e2e account or any
 * server. The dev server uses dummy settings and its own port (5192).
 *
 * Run from tests/e2e/: npx playwright test -c design-review/caregiver-preview.config.ts
 * Output: docs/design/screenshots/caregiver-*.png (gitignored).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
export const PREVIEW_PORT = Number(process.env.CAREGIVER_PREVIEW_PORT ?? 5192);
export const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

export default defineConfig({
  testDir: '.',
  testMatch: /caregiver-preview\.review\.ts/,
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
