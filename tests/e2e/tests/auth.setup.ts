import { expect, test as setup } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { AUTH_FILE } from '../playwright.config';

setup('log in through Keycloak', async ({ page }) => {
  const username = process.env.E2E_USERNAME;
  const password = process.env.E2E_PASSWORD;
  if (!username || !password) throw new Error('E2E_USERNAME / E2E_PASSWORD are not set (see docs/E2E.md).');

  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();

  // Defensive: first-login screens (terms, required actions, consent) are skipped when present.
  const home = page.getByRole('navigation').getByText('Home');
  for (let i = 0; i < 4; i += 1) {
    if (await home.isVisible()) break;
    const next = page.locator('#kc-accept, #kc-login, input[name="accept"], input[type="submit"]').first();
    if (await next.isVisible().catch(() => false)) await next.click();
    else await home.waitFor({ timeout: 1_500 }).catch(() => undefined);
  }

  await expect(home).toBeVisible({ timeout: 30_000 });
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  await page.context().storageState({ path: AUTH_FILE });
});
