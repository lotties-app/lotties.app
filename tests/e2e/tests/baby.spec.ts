import { expect, test } from '@playwright/test';
import { WEB_URL } from '../playwright.config';
import { apiPost, e2eName, openApp, serverBabies, type BabyDto } from '../support/app';

test('create a baby through the UI; it shows in the switcher and in the API', async ({ page }) => {
  // The create card only exists while the account has no baby. The account keeps the babies of
  // earlier runs, so hide them from the first sync; real data flows again once the card is up.
  const babiesUrl = '**/api/v1/babies';
  await page.route(babiesUrl, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: [], headers: { 'access-control-allow-origin': WEB_URL } })
      : route.fallback(),
  );
  await openApp(page);
  await expect(page.getByText('No baby yet')).toBeVisible();
  await page.unroute(babiesUrl);

  const name = e2eName('Baby');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Birth date').fill('2025-02-03');
  await page.getByRole('button', { name: 'Create baby' }).click();

  await expect(page.getByRole('banner').getByText(name)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start Feeding' })).toBeVisible();

  const created = (await serverBabies(page)).find((b) => b.name === name);
  expect(created).toBeDefined();
  expect(created?.birthDate).toBe('2025-02-03');
  expect(created?.role?.toLowerCase()).toBe('owner');

  // A second baby turns the title into a switcher listing both.
  const other = await apiPost<BabyDto>(page, '/api/v1/babies', {
    name: e2eName('Sibling'),
    birthDate: '2024-06-01',
  });
  await page.reload();
  await page.getByRole('banner').getByRole('button', { name }).click();
  await expect(page.getByRole('menuitem', { name })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: other.name })).toBeVisible();

  await page.getByRole('menuitem', { name: other.name }).click();
  await expect(page.getByRole('banner').getByRole('button', { name: other.name })).toBeVisible();
});
