import { expect, test } from '@playwright/test';
import {
  SELECTED_BABY_KEY,
  createAndOpenBaby,
  goTo,
  logDiaper,
  preloadPages,
  signInThroughKeycloak,
  syncChip,
  timelineRow,
} from '../support/app';

// Own Keycloak login: logging out ends that SSO session, which must not be the one the other
// specs share through the saved storage state.
test.use({ storageState: { cookies: [], origins: [] }, trace: 'off' }); // traces would record the typed password

test('logout warns about unsynced changes; after logout and login the data re-syncs', async ({
  page,
  context,
}) => {
  await page.goto('/login');
  await signInThroughKeycloak(page);
  const baby = await createAndOpenBaby(page, 'Logout');
  await preloadPages(page);

  // Unsynced change -> warning dialog.
  await context.setOffline(true);
  await logDiaper(page, 'WET');
  await page.getByRole('button', { name: 'User menu' }).click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  const warning = page.getByRole('dialog', { name: 'Log out?' });
  await expect(warning).toContainText('unsynced');
  await warning.getByRole('button', { name: 'Cancel' }).click();
  await expect(warning).toBeHidden();

  // Back online: the change syncs, so logging out is no longer a warning.
  await context.setOffline(false);
  await goTo(page, 'Timeline');
  await expect(syncChip(page)).toContainText('Synced', { timeout: 45_000 });
  await page.getByRole('button', { name: 'User menu' }).click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

  // Local data is gone after logout; signing in again pulls it back from the server.
  await signInThroughKeycloak(page);
  await expect(page.getByRole('navigation').getByText('Home')).toBeVisible();
  await page.evaluate(([key, id]) => window.localStorage.setItem(key, id), [
    SELECTED_BABY_KEY,
    baby.id,
  ]);
  await page.reload();
  await goTo(page, 'Timeline');
  await expect(timelineRow(page, 'Diaper')).toHaveCount(1);
  await expect(timelineRow(page, 'Diaper').getByText(/WET/)).toBeVisible();
});
