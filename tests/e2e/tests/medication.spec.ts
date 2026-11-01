import { expect, test } from '@playwright/test';
import {
  apiGet,
  createAndOpenBaby,
  e2eName,
  goTo,
  openSettingsSection,
  serverEvents,
  timelineRow,
} from '../support/app';

test('medication: add to the catalog, log it from the checklist, see it in the timeline', async ({
  page,
}) => {
  const baby = await createAndOpenBaby(page, 'Med');
  const medication = e2eName('Med');

  await openSettingsSection(page, 'Medications');
  await page.getByRole('button', { name: 'Add medication', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add medication' });
  await dialog.getByLabel('Name').fill(medication);
  await dialog.getByLabel('Default dose').fill('2.5');
  await dialog.getByLabel('Unit', { exact: true }).fill('ml');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('list', { name: 'Medications' }).getByText(medication)).toBeVisible();

  await goTo(page, 'Home');
  await page.getByRole('button', { name: 'Log Medication' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add event' });
  await sheet.getByRole('checkbox', { name: medication }).check();
  await expect(sheet.getByLabel(`${medication} dose`)).toHaveValue('2.5');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toBeHidden();

  await goTo(page, 'Timeline');
  await expect(timelineRow(page, 'Medication').getByText(medication)).toBeVisible();

  await expect
    .poll(async () => {
      const events = await serverEvents(page, baby.id);
      const meds = (events[0]?.payload?.medications ?? []) as { name: string }[];
      return meds.map((m) => m.name);
    })
    .toEqual([medication]);
  const catalog = await apiGet<{ name: string }[]>(page, `/api/v1/babies/${baby.id}/medications`);
  expect(catalog.map((m) => m.name)).toContain(medication);
});
