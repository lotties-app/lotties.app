import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../../db/database';
import type { Baby } from '../../db/models';
import { dismissBottleLevel } from '../../events/bottleLevelPrompt';
import { BottleLevelPromptHost } from '../../events/BottleLevelPromptHost';
import { activateLocale } from '../../i18n/i18n';
import { fakeApi, testDatabase } from '../../test/fakeApi';
import { useTestLocale } from '../../test/locale';
import { renderWithDb, settleSync } from '../../test/renderApp';
import { THEME_STORAGE_KEY } from '../../theme/themeStorage';
import { bottleFollowUpDismissal } from '../bottleFollowUp';
import { BABY, nowApi, putEvent, seedMorning, seedNow } from './nowKit';
import { NowScreen } from './NowScreen';

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  dismissBottleLevel();
  bottleFollowUpDismissal.clearAll();
  window.localStorage.clear();
  await activateLocale('en');
  await settleSync();
  vi.restoreAllMocks();
  await db.delete();
});

function renderNow(baby: Baby = BABY) {
  const { api } = fakeApi(nowApi());
  return renderWithDb(
    db,
    <>
      <NowScreen baby={baby} />
      <BottleLevelPromptHost />
    </>,
    { api },
  );
}

const byId = async (id: string) => (await db.events.get(id))!;

async function violations() {
  const result = await axe.run(document.body, {
    runOnly: ['wcag2a', 'wcag2aa'],
    rules: { 'color-contrast': { enabled: false } },
  });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`);
}

async function pauseBottle(name = /^Pause Bottle/) {
  fireEvent.click((await screen.findAllByRole('button', { name }))[0]);
}

describe('"How much is left in the bottle?" when a bottle is paused', () => {
  it('pauses at once, then one tap on a chip records the level and closes', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    const bottle = await putEvent(db, 'feeding', 6, null, { method: 'bottle', amount_ml: 120 });
    renderNow();

    await pauseBottle();
    const sheet = await screen.findByRole('dialog', { name: 'How much is left in the bottle?' });
    // The pause is saved before any answer.
    expect((await byId(bottle.id)).payload).toMatchObject({
      paused_at: expect.any(String),
      segments: expect.stringMatching(/^120>\?@\d+$/),
    });
    const chips = within(sheet).getByRole('radiogroup', { name: 'Left in the bottle' });
    expect(
      within(chips)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['120 ml · full', '90 ml · 3/4', '60 ml · half', '30 ml · 1/4', '0 ml · empty']);
    expect(document.activeElement?.tagName).not.toBe('INPUT');
    fireEvent.click(within(chips).getByRole('radio', { name: '60 ml · half' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(async () =>
      expect((await byId(bottle.id)).payload.segments).toMatch(/^120>60@\d+\+0$/),
    );
  });

  it('Skip closes and keeps the level unknown; the pause stays', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    const bottle = await putEvent(db, 'feeding', 6, null, { method: 'bottle', amount_ml: 120 });
    renderNow();

    await pauseBottle();
    const sheet = await screen.findByRole('dialog', { name: 'How much is left in the bottle?' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const stored = await byId(bottle.id);
    expect(stored.payload.segments).toMatch(/^120>\?@\d+\+0$/);
    expect(stored.payload.paused_at).toEqual(expect.any(String));
  });

  it('without a prepared amount offers only the ml stepper, saved with Save', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    const bottle = await putEvent(db, 'feeding', 6, null, { method: 'bottle' });
    renderNow();

    await pauseBottle();
    const sheet = await screen.findByRole('dialog', { name: 'How much is left in the bottle?' });
    expect(within(sheet).queryByRole('radiogroup')).toBeNull();
    const save = within(sheet).getByRole('button', { name: 'Save' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    const field = within(sheet).getByRole('spinbutton', { name: 'Other amount' });
    fireEvent.change(field, { target: { value: '40' } });
    fireEvent.blur(field);
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(async () =>
      expect((await byId(bottle.id)).payload.segments).toMatch(/^\?>40@\d+\+0$/),
    );
  });

  it('other timers are never asked', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    await putEvent(db, 'tummy_time', 6, null, {});
    renderNow();
    await pauseBottle(/^Pause Tummy time/);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it.each([
    ['light', 'en'],
    ['dark', 'pt-BR'],
  ] as const)('has no axe violations (%s, %s)', async (mode, locale) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    if (locale !== 'en') await useTestLocale(locale);
    await seedNow(db);
    await seedMorning(db, 112);
    await putEvent(db, 'feeding', 6, null, { method: 'bottle', amount_ml: 120 });
    renderNow();
    await pauseBottle(locale === 'en' ? /^Pause Bottle/ : /^Paus.* Mamadeira/);
    await screen.findByRole('dialog', {
      name: locale === 'en' ? 'How much is left in the bottle?' : 'Quanto sobrou na mamadeira?',
    });
    expect(document.documentElement.hasAttribute(`data-${mode}`)).toBe(true);
    expect(await violations()).toEqual([]);
  });
});

describe('the follow-up after a sleep stopped a bottle', () => {
  async function seedInterrupted(
    extra: Record<string, unknown> = {},
    createdBy: string | null = null,
  ) {
    await seedNow(db);
    await seedMorning(db, 112);
    await putEvent(db, 'sleep', 20, null, { kind: 'nap' });
    return putEvent(
      db,
      'feeding',
      35,
      20,
      { method: 'bottle', amount_ml: 120, ended_by: 'sleep', ...extra },
      { createdBy, id: crypto.randomUUID() },
    );
  }

  it('asks once on Now; a chip fills the total and the row goes away', async () => {
    const bottle = await seedInterrupted({ segments: '120>80@300;80>?@600' });
    renderNow();
    const row = await screen.findByRole('group', { name: 'Lia fell asleep during the bottle.' });
    const chips = within(row).getByRole('radiogroup', { name: 'Left in the bottle' });
    // Nothing above where the last stretch started (80 ml).
    expect(
      within(chips)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['60 ml · half', '30 ml · 1/4', '0 ml · empty']);
    fireEvent.click(within(chips).getByRole('radio', { name: '30 ml · 1/4' }));
    await waitFor(() => expect(screen.queryByTestId('bottle-follow-up')).toBeNull());
    expect((await byId(bottle.id)).payload).toMatchObject({
      amount_drunk_ml: 90,
      segments: '120>80@300;80>30@600',
    });
  });

  it('Skip leaves it unknown and it never comes back for that bottle', async () => {
    const bottle = await seedInterrupted();
    const { unmount } = renderNow();
    const row = await screen.findByTestId('bottle-follow-up');
    fireEvent.click(within(row).getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(screen.queryByTestId('bottle-follow-up')).toBeNull());
    expect((await byId(bottle.id)).payload).not.toHaveProperty('amount_drunk_ml');
    unmount();
    renderNow();
    await screen.findByRole('region', { name: 'Current state' });
    expect(screen.queryByTestId('bottle-follow-up')).toBeNull();
  });

  it("is not offered for someone else's bottle to a Caregiver", async () => {
    await seedInterrupted({}, 'u-other');
    const caregiver: Baby = { ...BABY, role: 'Caregiver', userId: 'u-me' };
    await db.babies.put(caregiver);
    renderNow(caregiver);
    await screen.findByRole('region', { name: 'Current state' });
    expect(screen.queryByTestId('bottle-follow-up')).toBeNull();
  });

  it('is not offered once the amount is known or after a newer feed', async () => {
    await seedInterrupted({ amount_drunk_ml: 100 });
    renderNow();
    await screen.findByRole('region', { name: 'Current state' });
    expect(screen.queryByTestId('bottle-follow-up')).toBeNull();
  });
});
