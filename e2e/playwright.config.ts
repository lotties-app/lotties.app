import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRootEnv } from './support/loadEnv';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

// Secrets live only in the gitignored root .env; loaded quietly, never printed.
loadRootEnv(path.join(repoRoot, '.env'));

// 5000 and 5080 are often taken by other local services, so the suite uses 5290.
export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:5290';
export const WEB_URL = 'http://localhost:5173';
export const AUTH_FILE = path.join(here, '.auth', 'user.json');

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: isCI ? 1 : 0,
  forbidOnly: isCI,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    // Traces record typed values (the password), so the Keycloak login is never traced.
    { name: 'setup', testMatch: /auth\.setup\.ts/, use: { trace: 'off' } },
    {
      name: 'chromium',
      testIgnore: /auth\.setup\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: AUTH_FILE },
    },
  ],
  webServer: [
    {
      command: 'dotnet run --project api/src/BabyRoutine.Api --no-launch-profile',
      cwd: repoRoot,
      url: `${API_URL}/health`,
      reuseExistingServer: !isCI,
      timeout: 240_000,
      // The per-user rate limit (300/min) is easily hit by a suite that polls the API while the app syncs.
      env: { ASPNETCORE_URLS: API_URL, RequestLimits__PermitsPerMinute: '6000' },
    },
    {
      command: 'npm --prefix web run dev -- --port 5173 --strictPort',
      cwd: repoRoot,
      url: WEB_URL,
      reuseExistingServer: !isCI,
      timeout: 120_000,
      env: {
        VITE_API_BASE_URL: API_URL,
        VITE_OIDC_AUTHORITY: process.env.VITE_OIDC_AUTHORITY ?? '',
        VITE_OIDC_CLIENT_ID: process.env.VITE_OIDC_CLIENT_ID ?? '',
        VITE_OIDC_AUDIENCE: process.env.VITE_OIDC_AUDIENCE ?? '',
      },
    },
  ],
});
