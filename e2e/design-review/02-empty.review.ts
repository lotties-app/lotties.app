import { expect, test } from '@playwright/test';
import { WEB_URL } from '../playwright.config';
import {
  comboFilter,
  comboKey,
  navTo,
  newReviewContext,
  openShell,
  readState,
  recordTiming,
  shot,
  startKeeper,
  stopKeeper,
  tr,
} from './lib';

test.beforeAll(async ({ browser }) => startKeeper(browser));
test.afterAll(async () => stopKeeper());

// Empty and first-run states: the account seen with no baby (GET /babies hidden, nothing written),
// and the review baby before any event is seeded.
for (const combo of comboFilter()) {
  test(`empty states ${comboKey(combo)}`, async ({ browser }) => {
    const { babyId } = readState();
    if (!babyId) throw new Error('Run 01-create first.');

    // 1. No baby at all (the list is hidden from the first sync, like e2e/tests/baby.spec.ts).
    {
      const context = await newReviewContext(browser, combo);
      const page = await context.newPage();
      await page.route('**/api/v1/babies', (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({ json: [], headers: { 'access-control-allow-origin': WEB_URL } })
          : route.fallback(),
      );
      await openShell(page, combo);
      await expect(page.getByText(tr(combo.locale, 'baby.noBabyYet'))).toBeVisible();
      await shot(page, combo, 'home-nobaby');
      if (combo.viewport === 'mobile') {
        // Validation state of the create form.
        await page.getByRole('button', { name: tr(combo.locale, 'baby.create') }).click();
        await shot(page, combo, 'home-nobaby-validation');
        await navTo(page, '/timeline');
        await page.waitForTimeout(800);
        await shot(page, combo, 'timeline-nobaby');
        await navTo(page, '/settings');
        await page.waitForTimeout(800);
        await shot(page, combo, 'settings-nobaby');
      }
      await context.close();
    }

    // 2. The review baby with no events yet.
    {
      const context = await newReviewContext(browser, combo, { babyId });
      const page = await context.newPage();
      const ms = await openShell(page, combo);
      recordTiming(combo, 'cold-shell', ms);
      const t0 = Date.now();
      await expect(
        page.getByRole('button', { name: tr(combo.locale, 'home.start', { name: tr(combo.locale, 'eventTypes.feeding.name') }) }),
      ).toBeVisible();
      recordTiming(combo, 'home-content-after-shell', Date.now() - t0);
      await page.waitForTimeout(1500); // predictions request settles
      await shot(page, combo, 'home-empty');
      if (combo.viewport === 'mobile') await shot(page, combo, 'home-empty-full', { fullPage: true, noAxe: true });
      await navTo(page, '/timeline');
      await expect(page.getByRole('heading', { name: tr(combo.locale, 'nav.timeline') })).toBeVisible();
      await page.waitForTimeout(500);
      await shot(page, combo, 'timeline-empty');
      await navTo(page, '/growth');
      await page.waitForTimeout(1500);
      await shot(page, combo, 'growth-empty');
      await context.close();
    }
  });
}
