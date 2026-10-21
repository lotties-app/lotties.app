import { expect, test } from '@playwright/test';
import { createAndOpenBaby, goTo, logDiaper, serverEvents, timelineRow } from '../support/app';

test('instant event: log a diaper, edit it, then soft-delete it', async ({ page }) => {
  const baby = await createAndOpenBaby(page, 'Diaper');

  // The Content field is required.
  await page.getByRole('button', { name: 'Log Diaper' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add event' });
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet.getByRole('alert')).toContainText('Content is required');
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(sheet).toBeHidden();

  await logDiaper(page, 'DIRTY');
  await goTo(page, 'Timeline');
  const row = timelineRow(page, 'Diaper');
  await expect(row).toHaveCount(1);
  await expect(row.getByText(/DIRTY/)).toBeVisible();

  // Edit: DIRTY -> WET.
  await row.click();
  const editSheet = page.getByRole('dialog', { name: 'Edit event' });
  await editSheet.getByRole('button', { name: 'WET', exact: true }).click();
  await editSheet.getByRole('button', { name: 'Save' }).click();
  await expect(editSheet).toBeHidden();
  await expect(row.getByText(/WET/)).toBeVisible();
  await expect
    .poll(async () => (await serverEvents(page, baby.id)).map((e) => e.payload?.content))
    .toEqual(['WET']);

  // Soft delete: the server keeps the row with deletedAt set.
  await row.click();
  await page
    .getByRole('dialog', { name: 'Edit event' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await page
    .getByRole('dialog', { name: 'Delete this event?' })
    .getByRole('button', { name: 'Delete event' })
    .click();
  await expect(row).toHaveCount(0);
  await expect
    .poll(async () => {
      const events = await serverEvents(page, baby.id);
      return events.length === 1 && events[0].deletedAt !== null;
    })
    .toBe(true);
});
