import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Screenshots of the eight built-in types of the `MoreEventTypes` migration: their Day rows
 * (`/dev/day?state=moretypes&offset=1`), the Add sheet tiles, and the event sheets of temperature,
 * teething (with the conditional tooth) and milestone (with the "Which milestone?" text) from
 * `/dev/sheet?state=temperature|teething|milestone`: a throw-away local database, no sign-in, no
 * API and no stored session. The dev server uses dummy settings and its own port (5198).
 *
 * Run from tests/e2e/: npx playwright test -c design-review/more-types-preview.config.ts
 * Output: docs/design/screenshots/more-types-*.png (gitignored).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
export const PREVIEW_PORT = Number(process.env.MORE_TYPES_PREVIEW_PORT ?? 5198);
export const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

export default defineConfig({
  testDir: '.',
  testMatch: /more-types-preview\.review\.ts/,
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
    // Dummy values: the preview route never signs in or calls a server.
    env: {
      VITE_API_BASE_URL: 'http://localhost:5299',
      VITE_OIDC_AUTHORITY: 'http://localhost:5299/realms/dev',
      VITE_OIDC_CLIENT_ID: 'dev-preview',
      VITE_OIDC_AUDIENCE: 'dev-preview',
    },
  },
});
