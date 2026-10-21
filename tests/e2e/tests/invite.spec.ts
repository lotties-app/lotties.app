import { expect, test } from '@playwright/test';
import { WEB_URL } from '../playwright.config';
import { createAndOpenBaby, openSettingsSection } from '../support/app';

test('owner creates an invite link in the /invite#<token> format', async ({ page }) => {
  await createAndOpenBaby(page, 'Invite');
  await openSettingsSection(page, 'Members & invites');

  await page.getByRole('button', { name: 'Create invite link' }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite link' });
  const link = dialog.getByLabel('Invite link');
  const value = await link.inputValue();
  // The token stays in the fragment (never sent to servers). It is not logged or asserted on.
  expect(value).toMatch(new RegExp(`^${WEB_URL}/invite#[A-Za-z0-9_-]{16,}$`));
  expect(new URL(value).search).toBe('');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();

  // The pending invite is listed; revoke it to leave nothing dangling.
  const revoke = page.getByRole('button', { name: 'Revoke Parent invite' });
  await expect(revoke).toHaveCount(1);
  await revoke.click();
  await expect(page.getByText('No pending invites.')).toBeVisible();
});
