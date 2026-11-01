import { expect, test } from '@playwright/test';
import {
  createAndOpenBaby,
  goTo,
  logDiaper,
  preloadPages,
  serverEvents,
  syncChip,
  timelineRow,
} from '../support/app';

test.describe('offline', () => {
  test('an event logged offline shows locally as pending and syncs on reconnect', async ({
    page,
    context,
  }) => {
    const baby = await createAndOpenBaby(page, 'Offline');
    await preloadPages(page);

    await context.setOffline(true);
    await logDiaper(page, 'MIXED');

    await goTo(page, 'Timeline');
    const row = timelineRow(page, 'Diaper');
    await expect(row).toHaveCount(1);
    await expect(row.getByText(/MIXED/)).toBeVisible();
    await expect(row.getByRole('img', { name: 'Not synced yet' })).toBeVisible();
    await expect(syncChip(page)).toContainText('Offline');
    expect(await serverEvents(page, baby.id)).toHaveLength(0);

    await context.setOffline(false);
    await expect(syncChip(page)).toContainText('Synced', { timeout: 45_000 });
    await expect(row.getByRole('img', { name: 'Not synced yet' })).toHaveCount(0);
    await expect
      .poll(async () => (await serverEvents(page, baby.id)).map((e) => e.payload?.content))
      .toEqual(['MIXED']);
  });

  test('a timer started and stopped offline ends up stopped on the server', async ({
    page,
    context,
  }) => {
    const baby = await createAndOpenBaby(page, 'OfflineTimer');
    await preloadPages(page);

    await context.setOffline(true);
    await page.getByRole('button', { name: 'Start Feeding' }).click();
    await expect(page.getByRole('region', { name: 'Running timers' })).toBeVisible();
    await page.getByRole('button', { name: 'Stop Feeding' }).click();
    await expect(page.getByRole('region', { name: 'Running timers' })).toBeHidden();

    await context.setOffline(false);
    await goTo(page, 'Timeline');
    await expect(syncChip(page)).toContainText('Synced', { timeout: 45_000 });

    await expect
      .poll(async () => {
        const events = await serverEvents(page, baby.id);
        return events.map((e) => e.endedAt !== null && e.deletedAt === null);
      })
      .toEqual([true]);
  });

  test('a timer started online and stopped offline is stopped on the server after reconnect', async ({
    page,
    context,
  }) => {
    const baby = await createAndOpenBaby(page, 'OfflineEdit');
    await preloadPages(page);

    await page.getByRole('button', { name: 'Start Feeding' }).click();
    await expect(page.getByRole('region', { name: 'Running timers' })).toBeVisible();
    // The start must reach the server first, so the stop below is an offline EDIT of a synced row.
    await expect
      .poll(async () => (await serverEvents(page, baby.id)).map((e) => e.endedAt))
      .toEqual([null]);

    await context.setOffline(true);
    await page.getByRole('button', { name: 'Stop Feeding' }).click();
    await expect(page.getByRole('region', { name: 'Running timers' })).toBeHidden();

    await context.setOffline(false);
    await goTo(page, 'Timeline');
    await expect(syncChip(page)).toContainText('Synced', { timeout: 45_000 });

    await expect
      .poll(async () => (await serverEvents(page, baby.id)).map((e) => e.endedAt !== null))
      .toEqual([true]);
    // And after a fresh pull the app still shows it stopped (no resurrected timer).
    await page.reload();
    await goTo(page, 'Home');
    await expect(page.getByRole('button', { name: 'Start Feeding' })).toBeEnabled();
    await expect(page.getByRole('region', { name: 'Running timers' })).toBeHidden();
  });
});
