import { expect, test } from '@playwright/test';
import { createAndOpenBaby, goTo, serverEvents, timelineRow } from '../support/app';

test('quick action: start and stop a feeding timer; it lands in the Timeline with a duration', async ({
  page,
}) => {
  const baby = await createAndOpenBaby(page, 'Timer');

  await page.getByRole('button', { name: 'Start Feeding' }).click();
  const timers = page.getByRole('region', { name: 'Running timers' });
  await expect(timers).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start Feeding' })).toBeDisabled();

  await page.getByRole('button', { name: 'Stop Feeding' }).click();
  await expect(timers).toBeHidden();
  await expect(page.getByRole('button', { name: 'Start Feeding' })).toBeEnabled();

  await goTo(page, 'Timeline');
  const row = timelineRow(page, 'Feeding');
  await expect(row).toHaveCount(1);
  await expect(row.getByText(/ · \d+ (min|h)/)).toBeVisible();
  await expect(row.getByText('Running')).toHaveCount(0);

  await expect
    .poll(
      async () => (await serverEvents(page, baby.id)).filter((e) => e.endedAt && !e.deletedAt).length,
    )
    .toBe(1);
});
