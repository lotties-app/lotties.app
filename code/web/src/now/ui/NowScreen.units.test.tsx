import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../../db/database';
import { activateLocale } from '../../i18n/i18n';
import { fakeApi, testDatabase } from '../../test/fakeApi';
import { useTestLocale } from '../../test/locale';
import { renderWithDb, settleSync } from '../../test/renderApp';
import { setUnitSetting } from '../../units/state';
import { BABY, nowApi, seedMorning, seedNow } from './nowKit';
import { NowScreen } from './NowScreen';

/*
 * The Feed tray in US customary units (docs/design/37a-measurement-units-web.md): presets on half
 * fluid ounces stored as whole ml, the toast and the buttons in fluid ounces.
 */

let db: BabyRoutineDb;

beforeEach(() => {
  window.localStorage.clear();
  setUnitSetting('us');
  db = testDatabase();
});

afterEach(async () => {
  await settleSync();
  setUnitSetting('auto');
  await activateLocale('en');
  vi.useRealTimers();
  vi.restoreAllMocks();
  await db.delete();
});

function renderNow() {
  const { api } = fakeApi(nowApi());
  return renderWithDb(db, <NowScreen baby={BABY} />, { api });
}

const live = async () => (await db.events.toArray()).filter((e) => e.deletedAt === null);
const logged = async () =>
  (await live()).filter((e) => Date.now() - Date.parse(e.createdAt) < 60_000);

describe('the Feed tray in fluid ounces', () => {
  it('labels the presets in fl oz and stores the chosen one as whole ml', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow();

    fireEvent.click(await screen.findByRole('button', { name: /^Feed/ }));
    const tray = await screen.findByRole('dialog', { name: 'Feed' });
    const amounts = within(tray).getByRole('radiogroup', { name: 'Amount' });
    const labels = within(amounts)
      .getAllByRole('radio')
      .map((r) => r.textContent);
    expect(labels).toContain('4 fl oz');
    expect(labels.every((label) => label === 'Other amount' || label!.endsWith('fl oz'))).toBe(
      true,
    );

    fireEvent.click(within(amounts).getByRole('radio', { name: '4 fl oz' }));
    fireEvent.click(within(tray).getByRole('button', { name: /^Log 4 fl oz/ }));

    await screen.findByText('Bottle logged, 4 fl oz');
    const [bottle] = (await logged()).filter((e) => e.payload.method === 'bottle');
    expect(bottle.payload).toMatchObject({ method: 'bottle', amount_ml: 118 });
  });

  it('steps the other amount by half a fluid ounce', async () => {
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow();

    fireEvent.click(await screen.findByRole('button', { name: /^Feed/ }));
    const tray = await screen.findByRole('dialog', { name: 'Feed' });
    fireEvent.click(within(tray).getByRole('radio', { name: 'Other amount' }));
    fireEvent.click(within(tray).getByRole('button', { name: 'Increase' }));
    fireEvent.click(within(tray).getByRole('button', { name: /^Log 4\.5 fl oz/ }));

    await screen.findByText('Bottle logged, 4.5 fl oz');
    const [bottle] = (await logged()).filter((e) => e.payload.method === 'bottle');
    expect(bottle.payload).toMatchObject({ amount_ml: 133 });
  });

  it('speaks Portuguese with a decimal comma', async () => {
    await useTestLocale('pt-BR');
    await seedNow(db);
    await seedMorning(db, 112);
    renderNow();

    fireEvent.click(await screen.findByRole('button', { name: /^Mamada/ }));
    const tray = await screen.findByRole('dialog', { name: 'Mamada' });
    fireEvent.click(within(tray).getByRole('radio', { name: 'Outra quantidade' }));
    fireEvent.click(within(tray).getByRole('button', { name: 'Aumentar' }));
    expect(within(tray).getByRole('button', { name: /^Registrar 4,5 fl oz/ })).toBeTruthy();
  });
});
