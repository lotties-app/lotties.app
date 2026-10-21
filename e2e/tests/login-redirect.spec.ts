import { expect, test } from '@playwright/test';
import { signInThroughKeycloak } from '../support/app';

// Signed out, with its own Keycloak login. Traces record typed values (the password): off.
test.use({ storageState: { cookies: [], origins: [] }, trace: 'off' });

test('a protected route redirects to sign-in and back after login', async ({ page }) => {
  await page.goto('/timeline');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Lotties' })).toBeVisible();

  await signInThroughKeycloak(page);

  // The login round trip returns to the page that was asked for.
  await expect(page).toHaveURL(/\/timeline$/);
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
});
