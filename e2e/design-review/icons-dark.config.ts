import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Checks the light/dark app icon sets against the BUILT app (web/dist, `npm --prefix web run build`
 * first): no sign-in, no API, no stored session. Serves dist with `vite preview` on port 5180;
 * Playwright stops the server when the run ends.
 *
 * Run from e2e/: npx playwright test -c design-review/icons-dark.config.ts
 * Output: docs/design/screenshots/icons-dark-*.png (gitignored) and a report on stdout.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
export const PREVIEW_PORT = Number(process.env.ICONS_PREVIEW_PORT ?? 5180);
export const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

export default defineConfig({
  testDir: ".",
  testMatch: /icons-dark\.review\.ts/,
  timeout: 120_000,
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
    command: `npm --prefix web run preview -- --port ${PREVIEW_PORT} --strictPort`,
    cwd: repoRoot,
    url: PREVIEW_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
