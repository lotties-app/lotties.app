import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Screenshots of the wet and dirty diaper cards on Now, with their Why sheets
 * (docs/design/11-patterns.md section 8), from the developer-only `/dev/now?state=wet|dirty`
 * preview: a throw-away local database with a seeded preview baby and a seeded server response, no
 * sign-in, no API and no stored session. The dev server uses dummy settings and its own port (5190).
 *
 * Run from tests/e2e/: npx playwright test -c design-review/diaper-preview.config.ts
 * Output: docs/design/screenshots/diaper-{wet,dirty}-*.png (gitignored).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
export const PREVIEW_PORT = Number(process.env.DIAPER_PREVIEW_PORT ?? 5190);
export const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

export default defineConfig({
  testDir: ".",
  testMatch: /diaper-preview\.review\.ts/,
  timeout: 0,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: PREVIEW_URL,
    trace: "off",
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
      VITE_API_BASE_URL: "http://localhost:5299",
      VITE_OIDC_AUTHORITY: "http://localhost:5299/realms/dev",
      VITE_OIDC_CLIENT_ID: "dev-preview",
      VITE_OIDC_AUDIENCE: "dev-preview",
    },
  },
});
