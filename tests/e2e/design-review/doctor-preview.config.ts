import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Screenshots of the doctor access screens (docs/design/16-doctor-access.md) from the
 * developer-only `/dev/doctor` preview: the professional profile, the Doctor invite form, members
 * with the doctor, the invite picker with its consent line and the access log, Patients, notes and
 * the composer, the family's notes and "Recorded by Dr." on Growth. A throw-away local database and
 * an in-memory API, no sign-in, no server and no stored session. The dev server uses dummy settings
 * and its own port.
 *
 * Run from tests/e2e/: npx playwright test -c design-review/doctor-preview.config.ts
 * Output: docs/design/screenshots/doctor-*.png (gitignored).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
export const PREVIEW_PORT = Number(process.env.DOCTOR_PREVIEW_PORT ?? 5196);
export const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

export default defineConfig({
  testDir: '.',
  testMatch: /doctor-preview\.review\.ts/,
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
