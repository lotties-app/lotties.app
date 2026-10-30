import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Screenshots of the project board (docs/design/36-project-board.md) from the developer-only
 * `/dev/board` preview: an in-memory board API with synthetic project items, no sign-in, no API
 * and no stored session, so nothing here touches the e2e account or any server. The dev server
 * uses dummy settings and its own port.
 *
 * Run from tests/e2e/: npx playwright test -c design-review/board-preview.config.ts
 * Output: docs/design/screenshots/board-*.png (gitignored).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
export const PREVIEW_PORT = Number(process.env.BOARD_PREVIEW_PORT ?? 5236);
export const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

export default defineConfig({
  testDir: '.',
  // Anchored: `doctor-dashboard-preview.review.ts` also ends in "board-preview.review.ts".
  testMatch: /(^|[\\/])board-preview\.review\.ts$/,
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
    // Dummy values: the preview route never signs in or calls a server.
    env: {
      VITE_API_BASE_URL: 'https://lotties.example',
      VITE_OIDC_AUTHORITY: 'http://localhost:5299/realms/dev',
      VITE_OIDC_CLIENT_ID: 'dev-preview',
      VITE_OIDC_AUDIENCE: 'dev-preview',
    },
  },
});
