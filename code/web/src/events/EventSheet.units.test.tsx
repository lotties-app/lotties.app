import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { createEvent } from '../db/eventCommands';
import { activateLocale } from '../i18n/i18n';
import { FEEDING_TYPE, TEMPERATURE_TYPE } from '../test/builtInTypes';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { setUnitSetting } from '../units/state';
import { EventSheet } from './EventSheet';

/*
 * US customary units in the event sheet (docs/design/37a-measurement-units-web.md): a stored
 * metric value is shown in fluid ounces / degrees F, typing converts back to whole ml / 0.1 C, and
 * saving without touching a field never rewrites it.
 */

let db: BabyRoutineDb;

beforeEach(async () => {
  window.localStorage.clear();
  setUnitSetting('us');
  db = testDatabase();
  await seedBaby(db);
});

afterEach(async () => {
  setUnitSetting('auto');
  await activateLocale('en');
  await db.delete();
});

function renderSheet(props: Partial<Parameters<typeof EventSheet>[0]> = {}) {
  const onDone = vi.fn();
  renderWithDb(
    db,
    <EventSheet
      babyId={BABY_ID}
      types={[FEEDING_TYPE, TEMPERATURE_TYPE]}
      initialTypeId={FEEDING_TYPE.id}
      onDone={onDone}
      {...props}
    />,
  );
  return onDone;
}

const save = () => fireEvent.click(screen.getByRole('button', { name: /^(Save|Salvar)$/ }));
const prepared = () =>
  screen.getByRole('spinbutton', { name: /Amount prepared|Quantidade preparada/ });

async function storedBottle(amount: number, extra: Record<string, unknown> = {}) {
  const start = new Date(2026, 9, 21, 10, 0);
  return createEvent(db, {
    babyId: BABY_ID,
    typeId: FEEDING_TYPE.id,
    startedAt: start.toISOString(),
    endedAt: start.toISOString(),
    payload: { method: 'bottle', amount_ml: amount, ...extra },
  });
}

describe('a bottle in US units', () => {
  it('shows a stored 120 ml as 4.1 fl oz and saves it untouched as 120', async () => {
    const stored = await storedBottle(120);
    const onDone = renderSheet({ event: stored });

    expect((prepared() as HTMLInputElement).value).toBe('4.1');
    expect(screen.getAllByText('fl oz').length).toBeGreaterThan(0);
    save();

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect((await db.events.get(stored.id))!.payload).toMatchObject({ amount_ml: 120 });
  });

  it('converts a typed 4 fl oz to 118 ml', async () => {
    const onDone = renderSheet();
    fireEvent.click(screen.getByRole('radio', { name: 'Bottle' }));
    fireEvent.change(prepared(), { target: { value: '4' } });
    save();

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [saved] = await db.events.toArray();
    expect(saved.payload).toMatchObject({ method: 'bottle', amount_ml: 118 });
  });

  it('accepts a comma and rounds to whole ml', async () => {
    const onDone = renderSheet();
    fireEvent.click(screen.getByRole('radio', { name: 'Bottle' }));
    fireEvent.change(prepared(), { target: { value: '4,5' } });
    save();

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect((await db.events.toArray())[0].payload).toMatchObject({ amount_ml: 133 });
  });

  it('steps by half a fluid ounce and offers presets on that grid', async () => {
    const onDone = renderSheet();
    fireEvent.click(screen.getByRole('radio', { name: 'Bottle' }));
    fireEvent.change(prepared(), { target: { value: '4' } });
    fireEvent.keyDown(prepared(), { key: 'ArrowUp' });
    expect((prepared() as HTMLInputElement).value).toBe('4.5');
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect((await db.events.toArray())[0].payload).toMatchObject({ amount_ml: 133 });
  });

  it('keeps an untouched drunk amount when only the prepared one is viewed', async () => {
    const stored = await storedBottle(150, { amount_drunk_ml: 95 });
    const onDone = renderSheet({ event: stored });
    save();

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect((await db.events.get(stored.id))!.payload).toMatchObject({
      amount_ml: 150,
      amount_drunk_ml: 95,
    });
  });
});

describe('a temperature in US units', () => {
  async function storedTemperature(value: number) {
    return createEvent(db, {
      babyId: BABY_ID,
      typeId: TEMPERATURE_TYPE.id,
      startedAt: new Date(2026, 9, 21, 10, 0).toISOString(),
      endedAt: null,
      payload: { value_c: value },
    });
  }
  const reading = () => screen.getByRole('spinbutton', { name: /Temperature|Temperatura/ });

  it('shows 37 C as 98.6 F and saves it untouched', async () => {
    const stored = await storedTemperature(37);
    const onDone = renderSheet({ event: stored, initialTypeId: TEMPERATURE_TYPE.id });
    expect((reading() as HTMLInputElement).value).toBe('98.6');
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect((await db.events.get(stored.id))!.payload).toMatchObject({ value_c: 37 });
  });

  it('converts a typed 100.4 F to 38 C', async () => {
    const onDone = renderSheet({ initialTypeId: TEMPERATURE_TYPE.id });
    fireEvent.change(reading(), { target: { value: '100.4' } });
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect((await db.events.toArray())[0].payload).toMatchObject({ value_c: 38 });
  });
});

describe('in Brazilian Portuguese', () => {
  it('types fluid ounces with a comma and shows the stored value with a comma', async () => {
    await useTestLocale('pt-BR');
    const stored = await storedBottle(120);
    const onDone = renderSheet({ event: stored });

    expect((prepared() as HTMLInputElement).value).toBe('4,1');
    fireEvent.change(prepared(), { target: { value: '4,5' } });
    save();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect((await db.events.get(stored.id))!.payload).toMatchObject({ amount_ml: 133 });
  });
});
