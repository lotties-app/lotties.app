import { expect, test } from '@playwright/test';
import { createAndOpenBaby } from '../support/app';

test('the predictions section renders without error for a new baby', async ({ page }) => {
  await createAndOpenBaby(page, 'Predictions');

  const section = page.getByRole('region', { name: 'Predictions' });
  await expect(section.getByRole('heading', { name: 'Next predicted' })).toBeVisible();
  await expect(section).not.toContainText('Loading predictions');
  await expect(section).not.toContainText('unavailable');
  // No history yet: either the empty explanation or the "need more data" line.
  await expect(section).toContainText(/Predictions appear after a few days|Need more data/);
  await expect(section).toContainText('not medical advice');
});
