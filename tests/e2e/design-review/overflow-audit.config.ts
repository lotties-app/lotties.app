import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Mobile overflow audit (docs/design/30-mobile-overflow-audit.md): loads every developer-only
 * `/dev/*` preview scenario (and the public /credits page) on phone widths, in both languages,
 * light and dark, with text at 100 % and 160 %, and fails on horizontal overflow, nested page
 * scrollers, content under the dock, `vh` heights and inputs below 16 px (iOS focus zoom).
 * Credential-free: throw-away local databases, no sign-in, no API.
 *
 * Run from tests/e2e/: npx playwright test -c design-review/overflow-audit.config.ts
 * Narrow it with AUDIT_ROUTES=hub,now AUDIT_WIDTHS=320 AUDIT_LOCALES=en AUDIT_SCHEMES=dark.
 * Output: design-review/output/overflow-audit.{json,md} (gitignored). Exits non-zero on a finding.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
export const AUDIT_PORT = Number(process.env.AUDIT_PORT ?? 5191);
export const AUDIT_URL = `http://localhost:${AUDIT_PORT}`;
// The summary reads only this run's files (workers inherit the main process's value).
process.env.AUDIT_STARTED ??= String(Date.now());

export default defineConfig({
  testDir: ".",
  testMatch: /overflow-audit\.review\.ts/,
  globalTeardown: "./overflow-audit.summary.ts",
  timeout: 0,
  fullyParallel: true,
  workers: Number(process.env.AUDIT_WORKERS ?? 3),
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: AUDIT_URL,
    trace: "off",
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
  },
  webServer: {
    command: `npm --prefix code/web run dev -- --port ${AUDIT_PORT} --strictPort`,
    cwd: repoRoot,
    url: AUDIT_URL,
    reuseExistingServer: true,
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
