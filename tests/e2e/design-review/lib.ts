import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SELECTED_BABY_KEY } from '../support/app';
import { AUTH_FILE } from '../playwright.config';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..', '..');
export const SHOTS_DIR = path.join(REPO_ROOT, 'docs', 'design', 'screenshots');
export const OUT_DIR = path.join(here, 'output');
const STATE_FILE = path.join(OUT_DIR, 'state.json');
const RESULTS_FILE = path.join(OUT_DIR, 'results.jsonl');
const TIMINGS_FILE = path.join(OUT_DIR, 'timings.jsonl');

fs.mkdirSync(SHOTS_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

/* ---------- combos ---------- */

export type ViewportName = 'mobile' | 'tablet' | 'desktop';
export type ThemeName = 'dark' | 'light';
export type LocaleName = 'en' | 'pt-BR';

export const VIEWPORTS: Record<ViewportName, { width: number; height: number }> = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
};

export interface Combo {
  viewport: ViewportName;
  theme: ThemeName;
  locale: LocaleName;
}

export const ALL_COMBOS: Combo[] = (['mobile', 'tablet', 'desktop'] as const).flatMap((viewport) =>
  (['dark', 'light'] as const).flatMap((theme) =>
    (['en', 'pt-BR'] as const).map((locale) => ({ viewport, theme, locale })),
  ),
);

export function comboFilter(): Combo[] {
  const only = process.env.REVIEW_COMBOS; // e.g. "mobile-dark-en,desktop-light-pt-BR"
  if (!only) return ALL_COMBOS;
  const wanted = new Set(only.split(','));
  return ALL_COMBOS.filter((c) => wanted.has(comboKey(c)));
}

export const comboKey = (c: Combo) => `${c.viewport}-${c.theme}-${c.locale}`;

/* ---------- state shared between review steps ---------- */

export interface ReviewState {
  babyId?: string;
  babyName?: string;
  medicationIds?: string[];
  runningEventId?: string;
  eventIds?: string[];
  measurementIds?: string[];
  inviteIdsRevoked?: string[];
}

export function readState(): ReviewState {
  return fs.existsSync(STATE_FILE) ? (JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as ReviewState) : {};
}

export function writeState(patch: ReviewState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify({ ...readState(), ...patch }, null, 2));
}

/* ---------- i18n catalogs (to drive both locales with the app's own strings) ---------- */

type Catalog = Record<string, unknown>;
const catalogs: Record<LocaleName, Catalog> = {
  en: JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'code/web/src/i18n/locales/en.json'), 'utf8')),
  'pt-BR': JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'code/web/src/i18n/locales/pt-BR.json'), 'utf8')),
};

function lookup(catalog: Catalog, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => (node as Catalog | undefined)?.[part], catalog);
}

export function tr(locale: LocaleName, key: string, vars: Record<string, string | number> = {}): string {
  let value = lookup(catalogs[locale], key);
  if (value === undefined && typeof vars.count === 'number') {
    value = lookup(catalogs[locale], `${key}_${vars.count === 1 ? 'one' : 'other'}`);
  }
  if (typeof value !== 'string') throw new Error(`Missing catalog key ${locale}:${key}`);
  return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars[name] ?? `{{${name}}}`));
}

/** English strings whose pt-BR value differs (used to spot untranslated text on pt-BR screens). */
export function englishOnlyStrings(): string[] {
  const out: string[] = [];
  const walk = (en: unknown, pt: unknown) => {
    if (typeof en === 'string') {
      if (typeof pt === 'string' && pt !== en && !en.includes('{{') && en.length >= 3) out.push(en);
      return;
    }
    if (en && typeof en === 'object') {
      for (const k of Object.keys(en as Catalog)) walk((en as Catalog)[k], (pt as Catalog | undefined)?.[k]);
    }
  };
  walk(catalogs.en, catalogs['pt-BR']);
  return [...new Set(out)];
}

/* ---------- session keeper ----------
 * The stored e2e session's access token lives ~5 minutes and the app does not refresh an already
 * expired one on load. A "keeper" context stays open on the app (whose own silent renew keeps the
 * tokens fresh) and every review context starts from a snapshot of it. The snapshot holds tokens:
 * it lives in the gitignored output/ folder and is deleted at the end of the review.
 */
const SESSION_FILE = path.join(OUT_DIR, 'session.json');
let keeper: BrowserContext | null = null;

function sessionFresh(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  const state = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    origins: { localStorage: { name: string; value: string }[] }[];
  };
  for (const origin of state.origins) {
    for (const entry of origin.localStorage) {
      if (entry.name.startsWith('oidc.user:')) {
        const user = JSON.parse(entry.value) as { expires_at?: number };
        return (user.expires_at ?? 0) > Date.now() / 1000 + 45;
      }
    }
  }
  return false;
}

export async function startKeeper(browser: Browser): Promise<void> {
  if (keeper) return;
  const source = sessionFresh(SESSION_FILE) ? SESSION_FILE : AUTH_FILE;
  if (!sessionFresh(source)) {
    throw new Error('The stored session expired: run `npx playwright test --project=setup` first.');
  }
  keeper = await browser.newContext({ storageState: source, viewport: { width: 800, height: 600 } });
  const { babyId } = readState();
  if (babyId) await onlyReviewBaby(keeper, babyId);
  const page = await keeper.newPage();
  await page.goto('http://localhost:5173/settings');
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 30_000 });
  await keeper.storageState({ path: SESSION_FILE });
}

export async function freshSession(): Promise<string> {
  if (!keeper) throw new Error('startKeeper() first');
  await keeper.storageState({ path: SESSION_FILE });
  return SESSION_FILE;
}

export async function stopKeeper(): Promise<void> {
  await keeper?.close();
  keeper = null;
}

export function deleteSessionSnapshot(): void {
  fs.rmSync(SESSION_FILE, { force: true });
}

/* ---------- contexts ---------- */

/**
 * The shared e2e account follows dozens of E2E-* babies, and a cold start syncs every one of them
 * (several requests each), which trips the API's 300 requests/minute limit. Review contexts see only
 * the review baby: GET /babies is fetched for real and filtered (read-only, nothing is written).
 */
export async function onlyReviewBaby(context: BrowserContext, babyId: string): Promise<void> {
  await context.route('**/api/v1/babies', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    try {
      const response = await route.fetch();
      if (!response.ok()) return await route.fulfill({ response });
      const all = (await response.json()) as { id: string }[];
      return await route.fulfill({ response, json: all.filter((b) => b.id === babyId) });
    } catch {
      // The context closed while the request was in flight.
      return undefined;
    }
  });
}

export async function newReviewContext(
  browser: Browser,
  combo: Combo,
  options: { babyId?: string; reducedMotion?: 'reduce' | 'no-preference'; storageState?: string } = {},
): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: VIEWPORTS[combo.viewport],
    deviceScaleFactor: 1,
    colorScheme: combo.theme,
    locale: combo.locale === 'en' ? 'en-US' : 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    reducedMotion: options.reducedMotion ?? 'no-preference',
    isMobile: false,
    hasTouch: combo.viewport !== 'desktop',
    storageState: options.storageState ?? (keeper ? await freshSession() : AUTH_FILE),
  });
  if (options.babyId) await onlyReviewBaby(context, options.babyId);
  await context.addInitScript(
    ([theme, locale, babyKey, babyId]) => {
      if (window.location.port !== '5173') return;
      try {
        window.localStorage.setItem('baby-routine.theme', theme);
        window.localStorage.setItem('baby-routine.locale', locale);
        if (babyId) window.localStorage.setItem(babyKey, babyId);
      } catch {
        /* ignore */
      }
    },
    [combo.theme, combo.locale, SELECTED_BABY_KEY, options.babyId ?? ''] as const,
  );
  return context;
}

export async function openShell(page: Page, combo: Combo, route = '/'): Promise<number> {
  const t0 = Date.now();
  await page.goto(route);
  await expect(page.getByRole('navigation').getByText(tr(combo.locale, 'nav.home'))).toBeVisible({
    timeout: 30_000,
  });
  return Date.now() - t0;
}

export async function navTo(page: Page, to: '/' | '/timeline' | '/growth' | '/settings'): Promise<void> {
  await page.locator(`nav a[href="${to}"]`).click();
}

/* ---------- capture + audits ---------- */

const ENGLISH_ONLY = englishOnlyStrings();

export interface ShotOptions {
  fullPage?: boolean;
  /** Skip axe (e.g. repeated identical state). */
  noAxe?: boolean;
  /** Restrict axe to a selector (e.g. the open dialog). */
  axeInclude?: string;
  note?: string;
}

export async function shot(page: Page, combo: Combo, screen: string, opts: ShotOptions = {}): Promise<void> {
  await page.waitForTimeout(350); // let transitions settle
  const file = `${screen}-${comboKey(combo)}.png`;
  await page.screenshot({
    path: path.join(SHOTS_DIR, file),
    fullPage: opts.fullPage ?? false,
    animations: 'disabled',
    caret: 'hide',
  });
  const metrics = await page.evaluate(auditInPage, { englishOnly: combo.locale === 'pt-BR' ? ENGLISH_ONLY : [] });
  let axe: unknown[] = [];
  if (!opts.noAxe) {
    try {
      let builder = new AxeBuilder({ page }).withTags([
        'wcag2a',
        'wcag2aa',
        'wcag21a',
        'wcag21aa',
        'wcag22aa',
        'best-practice',
      ]);
      if (opts.axeInclude) builder = builder.include(opts.axeInclude);
      const result = await builder.analyze();
      axe = result.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        tags: v.tags.filter((t) => t.startsWith('wcag') || t === 'best-practice'),
        help: v.help,
        nodes: v.nodes.length,
        samples: v.nodes.slice(0, 4).map((n) => ({
          target: n.target.join(' '),
          html: n.html.slice(0, 160),
          summary: (n.failureSummary ?? '').slice(0, 300),
          data: (n.any[0]?.data ?? n.all[0]?.data ?? null) as unknown,
        })),
      }));
    } catch (e) {
      axe = [{ id: 'axe-error', help: String(e).slice(0, 200) }];
    }
  }
  fs.appendFileSync(
    RESULTS_FILE,
    JSON.stringify({ screen, combo: comboKey(combo), file, note: opts.note, metrics, axe }) + '\n',
  );
}

export function recordTiming(combo: Combo, name: string, ms: number): void {
  fs.appendFileSync(TIMINGS_FILE, JSON.stringify({ combo: comboKey(combo), name, ms }) + '\n');
}

export async function timed<T>(combo: Combo, name: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const r = await fn();
  recordTiming(combo, name, Date.now() - t0);
  return r;
}

/** Runs in the page: target sizes, clipped text, horizontal overflow, raw codes, untranslated text. */
function auditInPage({ englishOnly }: { englishOnly: string[] }) {
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return (
      r.width > 0 &&
      r.height > 0 &&
      s.visibility !== 'hidden' &&
      s.display !== 'none' &&
      Number(s.opacity) > 0.05 &&
      r.bottom > 0 &&
      r.right > 0 &&
      r.left < window.innerWidth
    );
  };
  const inertAncestor = (el: Element) => !!el.closest('[aria-hidden="true"], [inert]');
  const nameOf = (el: Element) =>
    (
      el.getAttribute('aria-label') ||
      (el as HTMLElement).innerText ||
      el.getAttribute('title') ||
      el.getAttribute('placeholder') ||
      el.getAttribute('name') ||
      el.tagName
    )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 50);

  const selector =
    'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=checkbox], [role=radio], [role=switch], [role=tab], [role=menuitem], [role=option], [role=slider], [role=combobox]';
  const targets = [...document.querySelectorAll(selector)]
    .filter((el) => visible(el) && !inertAncestor(el))
    .map((el) => {
      let box = el.getBoundingClientRect();
      // MUI hides native radio/checkbox inputs over the visible span: measure the wrapper instead.
      if (el.tagName === 'INPUT' && ['checkbox', 'radio'].includes((el as HTMLInputElement).type)) {
        box = (el.parentElement ?? el).getBoundingClientRect();
      }
      return {
        name: nameOf(el),
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role'),
        w: Math.round(box.width),
        h: Math.round(box.height),
      };
    });
  const small44 = targets.filter((t) => t.w < 44 || t.h < 44);
  const small24 = targets.filter((t) => t.w < 24 || t.h < 24);

  const clipped: { text: string; tag: string; sw: number; cw: number }[] = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || inertAncestor(el)) continue;
    const he = el as HTMLElement;
    const s = getComputedStyle(he);
    if (!(he.innerText ?? '').trim()) continue;
    const hidesX = ['hidden', 'clip'].includes(s.overflowX) || s.textOverflow === 'ellipsis';
    const hidesY = ['hidden', 'clip'].includes(s.overflowY);
    if ((hidesX && he.scrollWidth > he.clientWidth + 1) || (hidesY && he.scrollHeight > he.clientHeight + 2)) {
      // only leaf-ish text containers
      if (he.children.length <= 2) {
        clipped.push({
          text: he.innerText.replace(/\s+/g, ' ').trim().slice(0, 60),
          tag: he.tagName.toLowerCase(),
          sw: he.scrollWidth,
          cw: he.clientWidth,
        });
      }
    }
  }

  const bodyText = document.body.innerText;
  const rawCodes = [
    ...new Set(
      (bodyText.match(/\b([A-Z]{3,}(?:_[A-Z]+)*|[a-z]+_[a-z_]+)\b/g) ?? []).filter(
        (w) => !['UTC', 'API', 'CSV', 'PWA', 'OK'].includes(w),
      ),
    ),
  ].slice(0, 20);

  const english: string[] = [];
  if (englishOnly.length > 0) {
    const set = new Set(englishOnly);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = (node.textContent ?? '').trim();
      const parent = node.parentElement;
      if (text && parent && visible(parent) && set.has(text)) english.push(text);
    }
    for (const el of document.querySelectorAll('[aria-label], [placeholder], [title]')) {
      for (const attr of ['aria-label', 'placeholder', 'title']) {
        const v = el.getAttribute(attr);
        if (v && set.has(v.trim())) english.push(`@${attr}: ${v}`);
      }
    }
  }

  const doc = document.documentElement;
  return {
    hOverflow: doc.scrollWidth > window.innerWidth + 1 ? doc.scrollWidth - window.innerWidth : 0,
    targetsTotal: targets.length,
    small44,
    small24,
    clipped: clipped.slice(0, 15),
    rawCodes,
    english: [...new Set(english)].slice(0, 30),
    title: document.title,
    lang: document.documentElement.lang,
  };
}
