import { expect, type Page } from '@playwright/test';
import { API_URL } from '../playwright.config';

export const SELECTED_BABY_KEY = 'baby-routine.selected-baby';

/** Unique, recognisable name for anything the suite creates (test data is never deleted). */
export function e2eName(label: string): string {
  return `E2E-${label}-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export interface BabyDto {
  id: string;
  name: string;
  birthDate: string;
  role?: string;
}

export interface EventDto {
  id: string;
  typeId: string;
  startedAt: string;
  endedAt: string | null;
  payload: Record<string, unknown> | null;
  notes: string | null;
  deletedAt: string | null;
}

/** The OIDC user the app keeps in localStorage (oidc-client-ts); renewed by the app itself. */
export async function accessToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((k) => k.startsWith('oidc.user:'));
    if (!key) return null;
    const user = JSON.parse(window.localStorage.getItem(key) ?? 'null') as {
      access_token?: string;
    } | null;
    return user?.access_token ?? null;
  });
  if (!token) throw new Error('No OIDC session in localStorage.');
  return token;
}

async function authHeaders(page: Page) {
  return { Authorization: `Bearer ${await accessToken(page)}` };
}

export async function apiGet<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(`${API_URL}${path}`, {
    headers: await authHeaders(page),
  });
  expect(response.ok(), `GET ${path} -> ${response.status()}`).toBe(true);
  return (await response.json()) as T;
}

export async function apiPost<T>(page: Page, path: string, body: unknown): Promise<T> {
  const response = await page.request.post(`${API_URL}${path}`, {
    headers: await authHeaders(page),
    data: body,
  });
  expect(response.ok(), `POST ${path} -> ${response.status()}`).toBe(true);
  return (await response.json()) as T;
}

/** Events of a baby straight from the API, soft-deleted ones included. */
export function serverEvents(page: Page, babyId: string): Promise<EventDto[]> {
  return apiGet<EventDto[]>(page, `/api/v1/babies/${babyId}/events`);
}

export function serverBabies(page: Page): Promise<BabyDto[]> {
  return apiGet<BabyDto[]>(page, '/api/v1/babies');
}

/** Waits until the signed-in app shell is up (the stored session is picked up). */
export async function openApp(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole('navigation').getByText('Home')).toBeVisible();
}

/** Creates a baby through the API, makes it the selected one and opens Home. */
export async function createAndOpenBaby(page: Page, label: string): Promise<BabyDto> {
  await openApp(page);
  const baby = await apiPost<BabyDto>(page, '/api/v1/babies', {
    name: e2eName(label),
    birthDate: '2025-01-15',
  });
  await page.evaluate(([key, id]) => window.localStorage.setItem(key, id), [
    SELECTED_BABY_KEY,
    baby.id,
  ]);
  await page.reload();
  await expect(page.getByRole('banner').getByText(baby.name)).toBeVisible();
  // Event types arrive with the first sync.
  await expect(page.getByRole('button', { name: 'Start Feeding' })).toBeVisible();
  return baby;
}

export type Tab = 'Home' | 'Timeline' | 'Growth' | 'Settings';

export async function goTo(page: Page, tab: Tab): Promise<void> {
  await page.getByRole('navigation').getByRole('link', { name: tab }).click();
}

/** Opens a settings accordion section by its title (content mounts only while expanded). */
export async function openSettingsSection(page: Page, title: string): Promise<void> {
  await goTo(page, 'Settings');
  const header = page.getByRole('button', { name: title, exact: true });
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click();
  await expect(header).toHaveAttribute('aria-expanded', 'true');
}

/** Visits the lazy pages once so their chunks are cached before the browser goes offline. */
export async function preloadPages(page: Page): Promise<void> {
  await goTo(page, 'Timeline');
  await expect(page.getByRole('heading', { name: 'Timeline' })).toBeVisible();
  await goTo(page, 'Settings');
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await goTo(page, 'Home');
  await expect(page.getByRole('button', { name: 'Start Feeding' })).toBeVisible();
}

/** Logs an instant Diaper event from Home through the add sheet. */
export async function logDiaper(page: Page, content: 'WET' | 'DIRTY' | 'MIXED'): Promise<void> {
  await page.getByRole('button', { name: 'Log Diaper' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add event' });
  await sheet.getByRole('button', { name: content, exact: true }).click();
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toBeHidden();
}

/** Timeline row (list item button) of an event type; rows are named "Edit <type>". */
export function timelineRow(page: Page, typeName: string) {
  return page.getByRole('button', { name: `Edit ${typeName}`, exact: true });
}

export function syncChip(page: Page) {
  return page.getByRole('status', { name: /^Sync status:/ });
}

/** Signs in through the real Keycloak page, starting from the app's /login screen. */
export async function signInThroughKeycloak(page: Page): Promise<void> {
  const username = process.env.E2E_USERNAME;
  const password = process.env.E2E_PASSWORD;
  if (!username || !password) {
    throw new Error('E2E_USERNAME / E2E_PASSWORD are not set (see docs/E2E.md).');
  }
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();
  // Back in the app with the session established.
  await expect(page.getByRole('navigation').getByText('Home')).toBeVisible({ timeout: 30_000 });
}
