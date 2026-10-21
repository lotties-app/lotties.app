import { test } from '@playwright/test';
import { apiPost, openApp, type BabyDto } from '../support/app';
import { readState, writeState } from './lib';

// Creates the ONE baby this review uses (named E2E-design-review-<timestamp>); idempotent per run.
test('create the review baby', async ({ page }) => {
  const existing = readState();
  if (existing.babyId) {
    console.log('review baby already exists', existing.babyName);
    return;
  }
  await openApp(page);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13); // 20261021T0530
  const baby = await apiPost<BabyDto>(page, '/api/v1/babies', {
    name: `E2E-design-review-${stamp}`,
    birthDate: '2026-08-10',
  });
  writeState({ babyId: baby.id, babyName: baby.name });
  console.log('created', baby.name);
});
