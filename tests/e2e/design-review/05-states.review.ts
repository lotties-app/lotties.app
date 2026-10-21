import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { API_URL, WEB_URL } from '../playwright.config';
import { accessToken } from '../support/app';
import {
  OUT_DIR,
  REPO_ROOT,
  comboKey,
  freshSession,
  navTo,
  newReviewContext,
  openShell,
  readState,
  recordTiming,
  shot,
  startKeeper,
  stopKeeper,
  tr,
  writeState,
  type Combo,
  type LocaleName,
} from './lib';

test.beforeAll(async ({ browser }) => startKeeper(browser));
test.afterAll(async () => stopKeeper());

const C = (key: string): Combo => {
  const [viewport, theme, ...rest] = key.split('-');
  return { viewport, theme, locale: rest.join('-') } as Combo;
};
const SUBSET = ['mobile-dark-en', 'mobile-light-pt-BR', 'desktop-dark-en'].map(C);
const only = process.env.REVIEW_STATES?.split(',');
const want = (name: string) => !only || only.includes(name);

const SLEEP_TYPE = '5cbe3692-d4df-4d5f-85d6-2282d9733b35';
const typeName = (L: LocaleName, key: string) => tr(L, `eventTypes.${key}.name`);

function logError(combo: Combo, step: string, e: unknown) {
  fs.appendFileSync(
    path.join(OUT_DIR, 'errors.jsonl'),
    JSON.stringify({ combo: comboKey(combo), step, error: String(e).slice(0, 400) }) + '\n',
  );
}

async function putEvent(page: Page, babyId: string, id: string, body: Record<string, unknown>) {
  const response = await page.request.put(`${API_URL}/api/v1/babies/${babyId}/events/${id}`, {
    headers: { Authorization: `Bearer ${await accessToken(page)}` },
    data: { ...body, updatedAt: new Date().toISOString() },
  });
  expect(response.ok(), `PUT event -> ${response.status()}`).toBe(true);
}

async function openPopulated(browser: Parameters<typeof newReviewContext>[0], combo: Combo, extra = {}) {
  const { babyId } = readState();
  const context = await newReviewContext(browser, combo, { babyId, ...extra });
  const page = await context.newPage();
  await openShell(page, combo);
  await expect(
    page.getByRole('button', { name: tr(combo.locale, 'home.log', { name: typeName(combo.locale, 'diaper') }) }),
  ).toBeVisible();
  return { context, page };
}

/* ---------- running timer (all combos) ---------- */
test('running timer', async ({ browser }) => {
  test.skip(!want('running'));
  const state = readState();
  const night = new Date();
  night.setMinutes(night.getMinutes() - 118);
  const { context, page } = await openPopulated(browser, C('mobile-dark-en'));
  const runningId = state.runningEventId ?? randomUUID();
  await putEvent(page, state.babyId!, runningId, {
    typeId: SLEEP_TYPE,
    startedAt: night.toISOString(),
    endedAt: null,
    payload: { kind: 'night' },
    notes: null,
  });
  writeState({ runningEventId: runningId });
  await context.close();

  const combos = (['mobile', 'tablet', 'desktop'] as const).flatMap((viewport) =>
    (['dark', 'light'] as const).flatMap((theme) =>
      (['en', 'pt-BR'] as const).map((locale) => ({ viewport, theme, locale })),
    ),
  );
  for (const combo of combos) {
    try {
      const { context: ctx, page: p } = await openPopulated(browser, combo);
      const L = combo.locale;
      await expect(p.getByRole('region', { name: tr(L, 'home.runningTimers') })).toBeVisible();
      await p.waitForTimeout(2000);
      await shot(p, combo, 'home-running');
      if (combo.viewport === 'mobile') {
        await p
          .getByRole('region', { name: tr(L, 'home.runningTimers') })
          .getByRole('button', { name: tr(L, 'home.editNamed', { name: typeName(L, 'sleep') }) })
          .click();
        await p.waitForTimeout(500);
        await shot(p, combo, 'sheet-running');
        await p.keyboard.press('Escape');
      }
      await navTo(p, '/timeline');
      await p.waitForTimeout(1200);
      await shot(p, combo, 'timeline-running');
      await ctx.close();
    } catch (e) {
      logError(combo, 'running', e);
    }
  }
});

/* ---------- offline, sync pending, logout warning ---------- */
for (const combo of SUBSET) {
  test(`offline and pending ${comboKey(combo)}`, async ({ browser }) => {
    test.skip(!want('offline'));
    const L = combo.locale;
    const { context, page } = await openPopulated(browser, combo);
    // Lazy route chunks must be loaded before going offline (the dev server is not a service worker).
    for (const r of ['/timeline', '/growth', '/settings', '/'] as const) {
      await navTo(page, r);
      await page.waitForTimeout(700);
    }
    await context.setOffline(true);
    await page.waitForTimeout(1500);
    await shot(page, combo, 'home-offline');
    // Log a diaper while offline -> pending.
    await page.getByRole('button', { name: tr(L, 'home.log', { name: typeName(L, 'diaper') }) }).click();
    await page.getByRole('button', { name: tr(L, 'eventTypes.diaper.options.content.wet'), exact: true }).click();
    await page.getByRole('button', { name: tr(L, 'common.save') }).click();
    await page.waitForTimeout(1200);
    await shot(page, combo, 'home-pending');
    await navTo(page, '/timeline');
    await page.waitForTimeout(900);
    await shot(page, combo, 'timeline-pending');
    await navTo(page, '/growth');
    await page.waitForTimeout(1500);
    await shot(page, combo, 'growth-offline');
    await navTo(page, '/settings');
    await page.locator('#sync-header').click();
    await page.waitForTimeout(700);
    await page.locator('#sync-header').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await shot(page, combo, 'settings-sync-pending');
    await page.getByRole('button', { name: tr(L, 'layout.userMenu') }).click();
    await page.getByRole('menuitem', { name: tr(L, 'layout.logout') }).click();
    const dialog = page.getByRole('dialog', { name: tr(L, 'layout.logoutTitle') });
    await expect(dialog).toBeVisible();
    await shot(page, combo, 'logout-warning');
    await dialog.getByRole('button', { name: tr(L, 'common.cancel') }).click();
    await context.setOffline(false);
    await page.waitForTimeout(6000);
    await navTo(page, '/');
    await page.waitForTimeout(1500);
    await shot(page, combo, 'home-back-online', { noAxe: true });
    await context.close();
  });
}

/* ---------- server errors (mocked 500s, nothing written) ---------- */
for (const combo of SUBSET.slice(0, 2)) {
  test(`server errors ${comboKey(combo)}`, async ({ browser }) => {
    test.skip(!want('errors'));
    const L = combo.locale;
    const problem = {
      status: 500,
      contentType: 'application/problem+json',
      headers: { 'access-control-allow-origin': WEB_URL },
      body: JSON.stringify({ title: 'Internal Server Error', status: 500, detail: 'Simulated outage' }),
    };
    // Cold start while the API is down: nothing cached yet.
    {
      const { babyId } = readState();
      const context = await newReviewContext(browser, combo, { babyId });
      await context.route(`${API_URL}/api/**`, (route) => route.fulfill(problem));
      const page = await context.newPage();
      await openShell(page, combo);
      await page.waitForTimeout(5000);
      await shot(page, combo, 'home-api-down-coldstart');
      await context.close();
    }
    // Warm app, then the API starts failing.
    const { context, page } = await openPopulated(browser, combo);
    await page.waitForTimeout(1500);
    await context.route(`${API_URL}/api/**`, (route) => route.fulfill(problem));
    await page.getByRole('button', { name: tr(L, 'home.log', { name: typeName(L, 'bath') }) }).click();
    await page.getByRole('button', { name: tr(L, 'common.save') }).click();
    await page.waitForTimeout(3000);
    await shot(page, combo, 'home-sync-error');
    await navTo(page, '/settings');
    await page.locator('#sync-header').click();
    await page.getByRole('button', { name: tr(L, 'settings.sync.syncNow') }).click().catch(() => undefined);
    await page.waitForTimeout(2500);
    await page.locator('#sync-header').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await shot(page, combo, 'settings-sync-error');
    await page.locator('#sync-header').click();
    await page.locator('#members-header').click();
    await page.waitForTimeout(2500);
    await page.locator('#members-header').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await shot(page, combo, 'settings-members-error');
    await navTo(page, '/growth');
    await page.waitForTimeout(3000);
    await shot(page, combo, 'growth-error');
    // The bath logged during the outage never reached the server: the context (and its local
    // outbox) is discarded while the API is still failing.
    await context.close();
  });
}

/* ---------- Napper import wizard (synthetic fixtures; final import call mocked) ---------- */
for (const combo of SUBSET) {
  test(`import wizard ${comboKey(combo)}`, async ({ browser }) => {
    test.skip(!want('import'));
    const L = combo.locale;
    const { context, page } = await openPopulated(browser, combo);
    await navTo(page, '/settings');
    await page.locator('#baby-header').click();
    await page.locator('#import-header').click();
    await page.waitForTimeout(1200);
    await page.locator('#import-header').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await shot(page, combo, 'import-1-files-empty');
    const fixtures = path.join(REPO_ROOT, 'code/api/tests/BabyRoutine.Api.Tests/Imports/Fixtures');
    const inputs = page.locator('#import-content input[type=file]');
    await inputs.nth(0).setInputFiles(path.join(fixtures, 'napper-logs.csv'));
    await inputs.nth(1).setInputFiles(path.join(fixtures, 'napper-measurements.csv'));
    await page.waitForTimeout(300);
    await shot(page, combo, 'import-1-files-chosen');
    const previewResponse = page.waitForResponse((r) => r.url().endsWith('/import/napper/preview'));
    await page.getByRole('button', { name: tr(L, 'import.files.preview') }).click();
    const preview = (await (await previewResponse).json()) as { logs: unknown; measurements: unknown };
    await page.waitForTimeout(800);
    await page.locator('#import-header').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await shot(page, combo, 'import-2-review');
    if (combo.viewport === 'mobile') await shot(page, combo, 'import-2-review-full', { fullPage: true, noAxe: true });
    await page.getByRole('button', { name: tr(L, 'common.next') }).click();
    await page.waitForTimeout(800);
    await page.locator('#import-header').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await shot(page, combo, 'import-3-medications');
    // First name: create a new medication; the rest: ignore.
    const actions = page.locator('#import-content select');
    const count = await actions.count();
    let first = true;
    for (let i = 0; i < count; i += 1) {
      const select = actions.nth(i);
      const options = await select.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
      if (!options.includes('ignore')) continue;
      await select.selectOption(first ? 'create' : 'ignore');
      first = false;
    }
    await page.waitForTimeout(300);
    await shot(page, combo, 'import-3-medications-chosen', { noAxe: true });
    if (combo.viewport === 'mobile') await shot(page, combo, 'import-3-medications-full', { fullPage: true, noAxe: true });
    await page.getByRole('button', { name: tr(L, 'import.medications.recheck') }).click();
    await page.waitForTimeout(1500);
    await shot(page, combo, 'import-3-medications-covered', { noAxe: true });
    await page.getByRole('button', { name: tr(L, 'common.next') }).click();
    await page.waitForTimeout(600);
    await page.locator('#import-header').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await shot(page, combo, 'import-4-confirm');
    // The final import is answered by a mock: no synthetic rows are written into the review baby.
    await context.route(
      (url) => url.pathname.endsWith('/import/napper'),
      (route) =>
        route.fulfill({
          json: {
            eventsCreated: 12,
            measurementsCreated: 2,
            createdMedications: [{ id: randomUUID(), name: 'Colidis' }],
            logs: preview.logs,
            measurements: preview.measurements,
          },
          headers: { 'access-control-allow-origin': WEB_URL },
        }),
    );
    await page.locator('#import-content').getByRole('button', { name: tr(L, 'import.confirm.import'), exact: true }).click();
    await page.waitForTimeout(1500);
    await page.locator('#import-header').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await shot(page, combo, 'import-5-result');
    await context.close();
  });
}

/* ---------- invite dialog (created, captured, revoked) ---------- */
for (const combo of ['mobile-dark-en', 'mobile-light-pt-BR', 'desktop-light-en'].map(C)) {
  test(`invite ${comboKey(combo)}`, async ({ browser }) => {
    test.skip(!want('invite'));
    const L = combo.locale;
    const { context, page } = await openPopulated(browser, combo);
    await navTo(page, '/settings');
    await page.locator('#baby-header').click();
    await page.locator('#members-header').click();
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: tr(L, 'settings.invites.create') }).click();
    const dialog = page.getByRole('dialog', { name: tr(L, 'settings.invites.linkTitle') });
    await expect(dialog).toBeVisible();
    await shot(page, combo, 'invite-dialog');
    await dialog.getByRole('button', { name: tr(L, 'common.done') }).click();
    await page.waitForTimeout(800);
    await page.locator('#members-header').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await shot(page, combo, 'settings-members-pending-invite');
    const revoke = page.getByRole('button', { name: tr(L, 'settings.invites.revoke', { role: tr(L, 'baby.roles.Parent') }) });
    while ((await revoke.count()) > 0) {
      await revoke.first().click();
      await page.waitForTimeout(1200);
    }
    await expect(page.getByText(tr(L, 'settings.invites.none'))).toBeVisible();
    await context.close();
  });
}

/* ---------- language switch in Settings ---------- */
test('language switch', async ({ browser }) => {
  test.skip(!want('language'));
  const combo = C('mobile-dark-en');
  const { context, page } = await openPopulated(browser, combo);
  await navTo(page, '/settings');
  await page.locator('#baby-header').click();
  await page.locator('#language-header').click();
  await page.waitForTimeout(500);
  await page.locator('#language-content select').selectOption('pt-BR');
  await page.waitForTimeout(1500);
  await shot(page, { ...combo, locale: 'pt-BR' }, 'settings-language-switched-live');
  await context.close();
});

/* ---------- accessibility extras ---------- */
test('a11y extras', async ({ browser }) => {
  test.skip(!want('a11y'));
  const results: Record<string, unknown> = {};
  const combo = C('mobile-dark-en');
  const L = combo.locale;

  // 1. Text at 200% (root font size doubled; MUI sizes are rem based) at 390px.
  {
    const { context, page } = await openPopulated(browser, combo);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await page.waitForTimeout(800);
    await shot(page, combo, 'text200-home', { noAxe: true });
    await navTo(page, '/timeline');
    await page.waitForTimeout(900);
    await shot(page, combo, 'text200-timeline', { noAxe: true });
    await navTo(page, '/');
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: tr(L, 'home.log', { name: typeName(L, 'diaper') }) }).click();
    await page.waitForTimeout(600);
    await shot(page, combo, 'text200-sheet-diaper', { noAxe: true });
    await page.keyboard.press('Escape');
    await navTo(page, '/settings');
    await page.waitForTimeout(900);
    await shot(page, combo, 'text200-settings', { noAxe: true });
    await context.close();
  }

  // 2. Reflow at 320 CSS px and landscape phone.
  for (const [label, viewport] of [
    ['reflow320', { width: 320, height: 640 }],
    ['landscape', { width: 844, height: 390 }],
  ] as const) {
    const { babyId } = readState();
    const context = await newReviewContext(browser, combo, { babyId });
    const page = await context.newPage();
    await page.setViewportSize(viewport);
    await openShell(page, combo);
    await page.waitForTimeout(2000);
    await shot(page, combo, `${label}-home`, { noAxe: true });
    await navTo(page, '/timeline');
    await page.waitForTimeout(900);
    await shot(page, combo, `${label}-timeline`, { noAxe: true });
    await navTo(page, '/');
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: tr(L, 'home.log', { name: typeName(L, 'diaper') }) }).click();
    await page.waitForTimeout(600);
    await shot(page, combo, `${label}-sheet-diaper`, { noAxe: true });
    await context.close();
  }

  // 3. Reduced motion: computed transition of the bottom sheet while it opens.
  for (const motion of ['no-preference', 'reduce'] as const) {
    const { babyId } = readState();
    const context = await newReviewContext(browser, combo, { babyId, reducedMotion: motion });
    const page = await context.newPage();
    await openShell(page, combo);
    await page.getByRole('button', { name: tr(L, 'home.log', { name: typeName(L, 'diaper') }) }).click();
    const transition = await page
      .locator('.MuiDrawer-paper')
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return { duration: s.transitionDuration, property: s.transitionProperty, inline: (el as HTMLElement).style.transition };
      });
    results[`sheetTransition-${motion}`] = transition;
    await context.close();
  }

  // 4. Keyboard: focus order and visible focus on Home (desktop, light).
  {
    const desk = C('desktop-light-en');
    const { context, page } = await openPopulated(browser, desk);
    await page.waitForTimeout(1500);
    const order: unknown[] = [];
    await page.mouse.click(5, 5);
    for (let i = 0; i < 30; i += 1) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          name: (el.getAttribute('aria-label') || el.innerText || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 40),
          tag: el.tagName.toLowerCase(),
          outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`,
          boxShadow: s.boxShadow.slice(0, 60),
          y: Math.round(r.top),
          inView: r.top >= 0 && r.bottom <= window.innerHeight,
        };
      });
      order.push(info);
      if (i === 2 || i === 6 || i === 14) await shot(page, desk, `focus-home-tab${i + 1}`, { noAxe: true });
    }
    results.focusOrderHome = order;
    // Focus inside the event sheet (dialog on desktop).
    await page.getByRole('button', { name: 'Log Diaper' }).focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    const sheetOrder: unknown[] = [];
    for (let i = 0; i < 10; i += 1) {
      sheetOrder.push(
        await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          return el ? (el.getAttribute('aria-label') || el.innerText || el.getAttribute('name') || el.tagName).trim().slice(0, 40) : null;
        }),
      );
      await page.keyboard.press('Tab');
    }
    results.focusOrderSheet = sheetOrder;
    await shot(page, desk, 'focus-sheet-diaper', { noAxe: true });
    await context.close();
  }

  // 5. Cold-load paint timings (Vite dev server: unbundled modules, not production numbers).
  {
    const { babyId } = readState();
    const context = await newReviewContext(browser, combo, { babyId });
    const page = await context.newPage();
    const t0 = Date.now();
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Log Diaper' })).toBeVisible({ timeout: 30_000 });
    const homeReady = Date.now() - t0;
    const perf = await page.evaluate(() => {
      const paint = Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)]));
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      return {
        paint,
        domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
        load: Math.round(nav.loadEventEnd),
        resources: res.length,
        scripts: res.filter((r) => r.initiatorType === 'script' || r.name.endsWith('.ts') || r.name.endsWith('.tsx')).length,
        apiCalls: res.filter((r) => r.name.includes('/api/v1/')).map((r) => ({ url: new URL(r.name).pathname.replace(/[0-9a-f-]{36}/g, ':id'), ms: Math.round(r.duration) })),
      };
    });
    results.coldLoad = { homeReadyMs: homeReady, ...perf };
    recordTiming(combo, 'cold-home-ready', homeReady);
    await context.close();
  }

  fs.writeFileSync(path.join(OUT_DIR, 'a11y-extras.json'), JSON.stringify(results, null, 2));
});

/* ---------- login screen and an expired session on cold start ---------- */
for (const combo of ['mobile-dark-en', 'mobile-light-pt-BR'].map(C)) {
  test(`login and expired session ${comboKey(combo)}`, async ({ browser }) => {
    test.skip(!want('login'));
    {
      const context = await newReviewContext(browser, combo, { storageState: path.join(OUT_DIR, 'empty-state.json') });
      const page = await context.newPage();
      await page.goto('/login');
      await page.waitForTimeout(1500);
      await shot(page, combo, 'login');
      await context.close();
    }
    {
      // Same stored session, but its access token marked as expired (the refresh token is untouched).
      const snapshot = JSON.parse(fs.readFileSync(await freshSession(), 'utf8')) as {
        origins: { localStorage: { name: string; value: string }[] }[];
      };
      for (const o of snapshot.origins) {
        for (const e of o.localStorage) {
          if (e.name.startsWith('oidc.user:')) {
            const user = JSON.parse(e.value) as { expires_at: number };
            user.expires_at = Math.floor(Date.now() / 1000) - 60;
            e.value = JSON.stringify(user);
          }
        }
      }
      const file = path.join(OUT_DIR, 'expired-session.json');
      fs.writeFileSync(file, JSON.stringify(snapshot));
      const { babyId } = readState();
      const context = await newReviewContext(browser, combo, { babyId, storageState: file });
      const page = await context.newPage();
      await page.goto('/');
      await page.waitForTimeout(4000);
      await shot(page, combo, 'session-expired-coldstart');
      fs.appendFileSync(
        path.join(OUT_DIR, 'errors.jsonl'),
        JSON.stringify({ combo: comboKey(combo), step: 'expired-session-url', error: page.url() }) + '\n',
      );
      await context.close();
      fs.rmSync(file, { force: true });
    }
  });
}

fs.writeFileSync(path.join(OUT_DIR, 'empty-state.json'), JSON.stringify({ cookies: [], origins: [] }));
