import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Screenshots of the vaccine screens (docs/design/18-vaccines.md) from the developer-only
 * `/dev/vaccines` preview: the schedule timeline with its states, the record and edit sheets, the
 * "About this baby" block, the sources, the Now card, the printable vaccination card, the
 * private-clinic view, the read-only Caregiver view and the missing birth date. A throw-away local
 * database seeded per scenario, no sign-in, no API and no stored session. The dev server uses
 * dummy settings and its own port.
 *
 * Run from tests/e2e/: npx playwright test -c design-review/vaccines-preview.config.ts
 * Output: docs/design/screenshots/vaccines-*.png (gitignored).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
export const PREVIEW_PORT = Number(process.env.VACCINES_PREVIEW_PORT ?? 5199);
export const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

export default defineConfig({
  testDir: '.',
  testMatch: /vaccines-preview\.review\.ts/,
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
  },
  webServer: {
    command: `npm --prefix code/web run dev -- --port ${PREVIEW_PORT} --strictPort`,
    cwd: repoRoot,
    url: PREVIEW_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    // Dummy values: the preview route never signs in or calls a server.
    env: {
      VITE_API_BASE_URL: 'http://localhost:5299',
      VITE_OIDC_AUTHORITY: 'http://localhost:5299/realms/dev',
      VITE_OIDC_CLIENT_ID: 'dev-preview',
      VITE_OIDC_AUDIENCE: 'dev-preview',
    },
  },
});
