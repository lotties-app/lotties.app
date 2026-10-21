import { expect, test } from '@playwright/test';
import { openApp } from '../support/app';

test('a signed-in user lands on Home', async ({ page }) => {
  await openApp(page);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible();
});
