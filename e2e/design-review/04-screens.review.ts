import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  OUT_DIR,
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
  timed,
  tr,
  type Combo,
} from './lib';

test.beforeAll(async ({ browser }) => startKeeper(browser));
test.afterAll(async () => stopKeeper());

/** Runs one capture step; a failure is logged and the next step goes on. */
async function step(combo: Combo, name: string, page: Page, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    fs.appendFileSync(
      path.join(OUT_DIR, 'errors.jsonl'),
      JSON.stringify({ combo: comboKey(combo), step: name, error: String(e).slice(0, 400) }) + '\n',
    );
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.keyboard.press('Escape').catch(() => undefined);
  }
}

async function closeSheet(page: Page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

for (const combo of comboFilter()) {
  test(`populated screens ${comboKey(combo)}`, async ({ browser }) => {
    const { babyId } = readState();
    if (!babyId) throw new Error('Run 01-create and 03-seed first.');
    const L = combo.locale;
    const typeName = (key: string) => tr(L, `eventTypes.${key}.name`);
    const mobile = combo.viewport === 'mobile';

    const context = await newReviewContext(browser, combo, { babyId });
    const page = await context.newPage();
    recordTiming(combo, 'cold-shell-populated', await openShell(page, combo));
    const t0 = Date.now();
    await expect(page.getByRole('button', { name: tr(L, 'home.start', { name: typeName('feeding') }) })).toBeVisible();
    recordTiming(combo, 'home-content-populated', Date.now() - t0);
    await page.waitForTimeout(2500); // predictions

    await step(combo, 'home', page, async () => {
      await shot(page, combo, 'home');
      if (mobile) await shot(page, combo, 'home-full', { fullPage: true, noAxe: true });
    });

    await step(combo, 'why', page, async () => {
      const why = page.getByRole('button', { name: tr(L, 'predictions.why') }).first();
      if (await why.isVisible()) {
        await why.click();
        await page.waitForTimeout(400);
        await shot(page, combo, 'home-prediction-why');
        await closeSheet(page);
      }
    });

    await step(combo, 'track', page, async () => {
      await timed(combo, 'open-track-sheet', async () => {
        await page.getByRole('button', { name: tr(L, 'nav.addEvent') }).click();
        await expect(page.getByText(tr(L, 'track.placeholder'))).toBeVisible();
      });
      await shot(page, combo, 'track-sheet');
      await closeSheet(page);
    });

    // Add-mode sheets from the Home quick actions (instant types).
    for (const key of ['diaper', 'medication', 'belly_pain', 'bath'] as const) {
      await step(combo, `sheet-${key}`, page, async () => {
        await timed(combo, 'open-event-sheet', async () => {
          await page.getByRole('button', { name: tr(L, 'home.log', { name: typeName(key) }) }).click();
          await expect(page.getByRole('heading', { name: tr(L, 'events.addTitle') })).toBeVisible();
        });
        await shot(page, combo, `sheet-${key.replace('_', '')}`);
        if (key === 'medication') {
          await page.getByRole('checkbox', { name: 'Vitamin D drops' }).check();
          await shot(page, combo, 'sheet-medication-checked', { noAxe: !mobile });
        }
        if (key === 'diaper' && mobile) {
          await page.getByRole('button', { name: tr(L, 'common.save') }).click();
          await shot(page, combo, 'sheet-diaper-validation');
        }
        await closeSheet(page);
      });
    }

    // Timeline.
    await step(combo, 'timeline', page, async () => {
      await timed(combo, 'route-timeline', async () => {
        await navTo(page, '/timeline');
        await expect(page.getByRole('heading', { name: tr(L, 'nav.timeline') })).toBeVisible();
        await expect(page.getByRole('button', { name: tr(L, 'home.editNamed', { name: typeName('feeding') }) }).first()).toBeVisible();
      });
      await shot(page, combo, 'timeline');
      if (mobile) await shot(page, combo, 'timeline-full', { fullPage: true, noAxe: true });
    });

    await step(combo, 'timeline-filter', page, async () => {
      const group = page.getByRole('group', { name: tr(L, 'timeline.filterByType') });
      await group.getByRole('button', { name: typeName('sleep') }).click();
      await page.waitForTimeout(400);
      await shot(page, combo, 'timeline-filter-sleep');
      await group.getByRole('button', { name: tr(L, 'timeline.all') }).click();
    });

    const edits: [string, string, string | RegExp][] = [
      ['sheet-bottle', 'feeding', / ml/],
      ['sheet-breast', 'feeding', tr(L, 'eventTypes.feeding.options.method.breast')],
      ['sheet-sleep', 'sleep', tr(L, 'eventTypes.sleep.options.kind.nap')],
    ];
    for (const [screen, key, hasText] of edits) {
      await step(combo, screen, page, async () => {
        await page
          .getByRole('button', { name: tr(L, 'home.editNamed', { name: typeName(key) }), exact: true })
          .filter({ hasText })
          .first()
          .click();
        await expect(page.getByRole('heading', { name: tr(L, 'events.editTitle') })).toBeVisible();
        await shot(page, combo, screen);
        if (combo.viewport !== 'desktop') {
          // Where the actions are: the sheet scrolls, the footer is not sticky.
          await page.evaluate(() => {
            for (const el of document.querySelectorAll('.MuiDrawer-paper, .MuiDialogContent-root, .MuiDialog-paper')) {
              el.scrollTop = el.scrollHeight;
            }
          });
          await shot(page, combo, `${screen}-bottom`, { noAxe: true });
        }
        await closeSheet(page);
      });
    }

    // Growth.
    await step(combo, 'growth', page, async () => {
      await timed(combo, 'route-growth', async () => {
        await navTo(page, '/growth');
        await expect(page.getByRole('heading', { name: tr(L, 'growth.title') })).toBeVisible();
      });
      await page.waitForTimeout(1500);
      await shot(page, combo, 'growth');
      if (mobile) await shot(page, combo, 'growth-full', { fullPage: true, noAxe: true });
      await page.getByRole('button', { name: tr(L, 'growth.add') }).click();
      await page.waitForTimeout(500);
      await shot(page, combo, 'growth-add-dialog');
      await closeSheet(page);
    });

    // Settings.
    await step(combo, 'settings', page, async () => {
      await timed(combo, 'route-settings', async () => {
        await navTo(page, '/settings');
        await expect(page.getByRole('heading', { name: tr(L, 'settings.title'), level: 1 })).toBeVisible();
      });
      await page.waitForTimeout(500);
      await shot(page, combo, 'settings');
      if (mobile) await shot(page, combo, 'settings-full', { fullPage: true, noAxe: true });
      await page.locator('#baby-header').click(); // collapse Baby
    });

    const sections = ['event-types', 'medications', 'import', 'members', 'appearance', 'language', 'sync'];
    for (const id of sections) {
      await step(combo, `settings-${id}`, page, async () => {
        const header = page.locator(`#${id}-header`);
        await header.click();
        await expect(header).toHaveAttribute('aria-expanded', 'true');
        await page.waitForTimeout(900);
        await header.evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.waitForTimeout(200);
        await shot(page, combo, `settings-${id}`);
        if (id === 'event-types') {
          await page.getByRole('button', { name: tr(L, 'settings.eventTypes.add') }).click();
          await page.waitForTimeout(700);
          await shot(page, combo, 'settings-eventtype-editor');
          await closeSheet(page);
        }
        if (id === 'medications') {
          await page.getByRole('button', { name: tr(L, 'settings.medications.add'), exact: true }).click();
          await page.waitForTimeout(500);
          await shot(page, combo, 'settings-medication-dialog');
          await closeSheet(page);
        }
        await header.click(); // collapse again
        await page.waitForTimeout(300);
      });
    }

    await context.close();
  });
}
