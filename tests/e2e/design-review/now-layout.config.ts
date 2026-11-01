import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Screenshots of the "Running now" layout of the Now screen and of the mini timer bar on Day, from
 * the developer-only `/dev/now` and `/dev/day` previews: throw-away local databases, no sign-in,
 * no API, no stored session. The dev server uses dummy settings and its own port (5203).
 *
 * Run from tests/e2e/: npx playwright test -c design-review/now-layout.config.ts
 * Output: docs/design/screenshots/layout-*.png (gitignored).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
export const PREVIEW_PORT = Number(process.env.NOW_LAYOUT_PORT ?? 5203);
export const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

export default defineConfig({
  testDir: ".",
  testMatch: /now-layout\.review\.ts/,
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
    // LAYOUT_VITE_CONFIG: another Vite config file (relative to code/web), e.g. one that widens
    // `server.fs.allow` when node_modules is a link outside the checkout.
    command: `npm --prefix code/web run dev -- --port ${PREVIEW_PORT} --strictPort${
      process.env.LAYOUT_VITE_CONFIG
        ? ` --config ${process.env.LAYOUT_VITE_CONFIG}`
        : ""
    }`,
    cwd: repoRoot,
    url: PREVIEW_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    // Dummy values: the preview routes never sign in or call a server.
    env: {
      VITE_API_BASE_URL: "http://localhost:5299",
      VITE_OIDC_AUTHORITY: "http://localhost:5299/realms/dev",
      VITE_OIDC_CLIENT_ID: "dev-preview",
      VITE_OIDC_AUDIENCE: "dev-preview",
    },
  },
});
