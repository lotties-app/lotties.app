import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Screenshots of the doctor's dashboard (docs/design/19-doctor-dashboard.md) from the
 * developer-only `/dev/doctor-dashboard` preview (Patients, the summary with every section and with
 * some sections not shared, the timeline, growth, medications, notes, the patient switcher open)
 * and from `/dev/doctor` (the Doctor invite with its section toggles, the members' "Doctor access"
 * sheet, the screen after accepting). A throw-away local database and an in-memory API, no sign-in,
 * no server and no stored session. The dev server uses dummy settings and its own port.
 *
 * Run from tests/e2e/: npx playwright test -c design-review/doctor-dashboard-preview.config.ts
 * Output: docs/design/screenshots/doctor-dashboard-*.png (gitignored).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
export const PREVIEW_PORT = Number(process.env.DOCTOR_DASHBOARD_PREVIEW_PORT ?? 5202);
export const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

export default defineConfig({
  testDir: ".",
  testMatch: /doctor-dashboard-preview\.review\.ts/,
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
    // Dummy values: the preview routes never sign in or call a server.
    env: {
      VITE_API_BASE_URL: "http://localhost:5299",
      VITE_OIDC_AUTHORITY: "http://localhost:5299/realms/dev",
      VITE_OIDC_CLIENT_ID: "dev-preview",
      VITE_OIDC_AUDIENCE: "dev-preview",
    },
  },
});
