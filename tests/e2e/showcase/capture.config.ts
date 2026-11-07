import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Product screenshots and the demo video for the landing page and the README, taken from the
 * developer-only `/dev/*` previews (seeded synthetic data in a throw-away local database): no
 * sign-in, no API, no stored session, so no real family's data can end up in a picture.
 *
 * Run from tests/e2e/: npx playwright test -c showcase/capture.config.ts
 * Then: node showcase/build-media.mjs   (docs/showcase-media.md)
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
export const SHOWCASE_PORT = Number(process.env.SHOWCASE_PORT ?? 5431);
const url = `http://localhost:${SHOWCASE_PORT}`;

export default defineConfig({
  testDir: '.',
  testMatch: /(capture|demo-video)\.review\.ts/,
  timeout: 0,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: url, trace: 'off', actionTimeout: 15_000, navigationTimeout: 30_000 },
  webServer: {
    command: `npm --prefix code/web run dev -- --port ${SHOWCASE_PORT} --strictPort`,
    cwd: repoRoot,
    url,
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
