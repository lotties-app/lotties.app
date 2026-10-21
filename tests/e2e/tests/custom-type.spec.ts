import { expect, test } from '@playwright/test';
import {
  createAndOpenBaby,
  e2eName,
  goTo,
  openSettingsSection,
  serverEvents,
  timelineRow,
} from '../support/app';

test('custom event type: create with a text field, quick action appears, log one', async ({
  page,
}) => {
  const baby = await createAndOpenBaby(page, 'Custom');
  const typeName = e2eName('Type');

  await openSettingsSection(page, 'Event types');
  await page.getByRole('button', { name: 'Add event type' }).click();
  const editor = page.getByRole('dialog', { name: 'Add event type' });
  await editor.getByRole('textbox', { name: /^Name\b/ }).fill(typeName);
  await editor.getByRole('button', { name: 'Add field' }).click();
  await editor.getByLabel('Field 1 label').fill('Detail');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toBeHidden();
  await expect(
    page.getByRole('list', { name: 'Custom event types' }).getByText(typeName),
  ).toBeVisible();

  await goTo(page, 'Home');
  await page.getByRole('button', { name: `Log ${typeName}`, exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Add event' });
  await sheet.getByLabel('Detail', { exact: true }).fill('hello e2e');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toBeHidden();

  await goTo(page, 'Timeline');
  await expect(timelineRow(page, typeName).getByText(/hello e2e/)).toBeVisible();
  await expect
    .poll(async () => (await serverEvents(page, baby.id)).map((e) => e.payload?.detail))
    .toEqual(['hello e2e']);
});
