import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import type { BabyRoutineDb } from '../db/database';
import type { EventType } from '../db/models';
import {
  FEEDING_TYPE,
  MILESTONE_TYPE,
  NAIL_TRIM_TYPE,
  OUTDOOR_TYPE,
  SKIN_CARE_TYPE,
  SPIT_UP_TYPE,
  SYMPTOM_TYPE,
  TEETHING_TYPE,
  TEMPERATURE_TYPE,
} from '../test/builtInTypes';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { renderWithDb } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { EventSheet } from './EventSheet';

/* The event sheet of the eight built-in types of the `MoreEventTypes` migration. */

let db: BabyRoutineDb;

beforeEach(async () => {
  db = testDatabase();
  await seedBaby(db);
});

afterEach(async () => {
  await db.delete();
});

function renderSheet(type: EventType) {
  const onDone = vi.fn();
  renderWithDb(
    db,
    <EventSheet
      babyId={BABY_ID}
      types={[type, FEEDING_TYPE]}
      initialTypeId={type.id}
      onDone={onDone}
    />,
  );
  return onDone;
}

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));

async function savedPayload(onDone: ReturnType<typeof vi.fn>) {
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  const [saved] = await db.events.toArray();
  return saved;
}

describe('EventSheet temperature', () => {
  it('asks for the required value in °C and offers where it was measured', () => {
    renderSheet(TEMPERATURE_TYPE);
    expect(screen.getByRole('dialog', { name: 'Temperature' })).toBeTruthy();
    const value = screen.getByRole('spinbutton', { name: /Temperature/ });
    expect(value.getAttribute('aria-valuemin')).toBe('30');
    expect(value.getAttribute('aria-valuemax')).toBe('45');
    expect(screen.getByText('°C')).toBeTruthy();
    for (const method of ['Armpit', 'Ear', 'Forehead', 'Rectal', 'Mouth']) {
      expect(screen.getByRole('radio', { name: method })).toBeTruthy();
    }
    expect(screen.queryByRole('switch', { name: 'Still running' })).toBeNull();
  });

  it.each([
    ['Increase', '36.5'],
    ['Decrease', '36.5'],
  ])('starts an empty reading at 36.5 when %s is pressed, range unchanged', (button, shown) => {
    renderSheet(TEMPERATURE_TYPE);
    const value = screen.getByRole('spinbutton', { name: /Temperature/ });
    expect((value as HTMLInputElement).value).toBe('');
    fireEvent.pointerDown(screen.getByRole('button', { name: button }), { button: 0 });
    fireEvent.pointerUp(screen.getByRole('button', { name: button }), { button: 0 });
    expect((value as HTMLInputElement).value).toBe(shown);
    expect(value.getAttribute('aria-valuemin')).toBe('30');
    expect(value.getAttribute('aria-valuemax')).toBe('45');
    expect(document.body.textContent).not.toMatch(/fever|febre|high|alta|normal/i);
  });

  it('keeps the generic start (the minimum) for a custom type with the same keys', () => {
    renderSheet({ ...TEMPERATURE_TYPE, id: 'custom-temperature', babyId: BABY_ID });
    const value = screen.getByRole('spinbutton', { name: /Temperature/ });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Increase' }), { button: 0 });
    fireEvent.pointerUp(screen.getByRole('button', { name: 'Increase' }), { button: 0 });
    expect((value as HTMLInputElement).value).toBe('30');
  });

  it('steps by a tenth of a degree', () => {
    renderSheet(TEMPERATURE_TYPE);
    const value = screen.getByRole('spinbutton', { name: /Temperature/ });
    fireEvent.change(value, { target: { value: '37.5' } });
    fireEvent.blur(value);
    fireEvent.keyDown(value, { key: 'ArrowUp' });
    expect((value as HTMLInputElement).value).toBe('37.6');
    expect(value.getAttribute('aria-valuetext')).toBe('37.6 °C');
  });

  it('logs the reading with one decimal and the method', async () => {
    const onDone = renderSheet(TEMPERATURE_TYPE);
    fireEvent.change(screen.getByRole('spinbutton', { name: /Temperature/ }), {
      target: { value: '37,8' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Armpit' }));
    save();
    const saved = await savedPayload(onDone);
    expect(saved.typeId).toBe(TEMPERATURE_TYPE.id);
    expect(saved.payload).toEqual({ value_c: 37.8, method: 'armpit' });
    expect(saved.endedAt).toBe(saved.startedAt);
  });

  it('does not save without a value or with more than one decimal', async () => {
    const onDone = renderSheet(TEMPERATURE_TYPE);
    save();
    expect(await screen.findByText('Temperature is required.')).toBeTruthy();
    fireEvent.change(screen.getByRole('spinbutton', { name: /Temperature/ }), {
      target: { value: '37.85' },
    });
    save();
    expect(await screen.findByText('Temperature can have at most 1 decimal place.')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
    expect(await db.events.count()).toBe(0);
  });

  it('never judges the reading', () => {
    renderSheet(TEMPERATURE_TYPE);
    fireEvent.change(screen.getByRole('spinbutton', { name: /Temperature/ }), {
      target: { value: '39.5' },
    });
    expect(document.body.textContent).not.toMatch(/fever|febre|high|alta|normal/i);
  });

  it('has no axe violation', async () => {
    renderSheet(TEMPERATURE_TYPE);
    const results = await axe.run(screen.getByRole('dialog'));
    expect(results.violations).toEqual([]);
  });
});

describe('EventSheet teething', () => {
  it('asks which tooth only once a tooth came through', async () => {
    const onDone = renderSheet(TEETHING_TYPE);
    expect(screen.getByRole('radio', { name: 'Sore gums' })).toBeTruthy();
    expect(screen.queryByText('Tooth')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Tooth came through' }));
    expect(await screen.findByText('Tooth')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Lower central incisor' }));
    save();
    const saved = await savedPayload(onDone);
    expect(saved.payload).toEqual({ stage: 'tooth_came_through', tooth: 'lower_central_incisor' });
  });

  it('drops the tooth when the stage goes back to sore gums', async () => {
    const onDone = renderSheet(TEETHING_TYPE);
    fireEvent.click(screen.getByRole('radio', { name: 'Tooth came through' }));
    fireEvent.click(await screen.findByRole('radio', { name: 'Canine' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Sore gums' }));
    await waitFor(() => expect(screen.queryByText('Tooth')).toBeNull());
    save();
    const saved = await savedPayload(onDone);
    expect(saved.payload).toEqual({ stage: 'gums_sore' });
  });

  it('has no axe violation with the tooth shown', async () => {
    renderSheet(TEETHING_TYPE);
    fireEvent.click(screen.getByRole('radio', { name: 'Tooth came through' }));
    await screen.findByText('Tooth');
    const results = await axe.run(screen.getByRole('dialog'));
    expect(results.violations).toEqual([]);
  });
});

describe('EventSheet milestone', () => {
  it('asks for the milestone in the parents words only for Other', async () => {
    const onDone = renderSheet(MILESTONE_TYPE);
    expect(screen.queryByText('Which milestone?')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Other' }));
    fireEvent.change(await screen.findByLabelText(/Which milestone\?/), {
      target: { value: 'Waved bye-bye' },
    });
    save();
    const saved = await savedPayload(onDone);
    expect(saved.payload).toEqual({ milestone: 'other', custom: 'Waved bye-bye' });
  });

  it('logs a listed milestone without the text', async () => {
    const onDone = renderSheet(MILESTONE_TYPE);
    fireEvent.click(screen.getByRole('radio', { name: 'First steps' }));
    expect(screen.queryByText('Which milestone?')).toBeNull();
    save();
    const saved = await savedPayload(onDone);
    expect(saved.payload).toEqual({ milestone: 'first_steps' });
  });

  it('has no axe violation with the text shown', async () => {
    renderSheet(MILESTONE_TYPE);
    fireEvent.click(screen.getByRole('radio', { name: 'Other' }));
    await screen.findByLabelText(/Which milestone\?/);
    const results = await axe.run(screen.getByRole('dialog'));
    expect(results.violations).toEqual([]);
  });
});

describe('EventSheet outdoor time', () => {
  it('is timed like tummy time and logs the kind', async () => {
    const onDone = renderSheet(OUTDOOR_TYPE);
    expect(screen.getByRole('dialog', { name: 'Outdoor time' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Still running' })).toBeTruthy();
    expect(screen.queryByText('Pauses')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Stroller walk' }));
    save();
    const saved = await savedPayload(onDone);
    expect(saved.payload).toEqual({ kind: 'stroller_walk' });
  });
});

describe('EventSheet select-only instants', () => {
  it.each([
    [NAIL_TRIM_TYPE, 'Nail trim', ['Feet'], { where: 'feet' }],
    [SPIT_UP_TYPE, 'Spit-up / vomit', ['Vomit', 'A little'], { kind: 'vomit', amount: 'little' }],
    [SYMPTOM_TYPE, 'Symptom', ['Cough', 'Moderate'], { symptom: 'cough', severity: 'moderate' }],
    [SKIN_CARE_TYPE, 'Skin care', ['Sunscreen'], { product: 'sunscreen' }],
  ] as const)('logs %#: %s with the chosen options', async (type, name, choices, payload) => {
    const onDone = renderSheet(type);
    expect(screen.getByRole('dialog', { name })).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Still running' })).toBeNull();
    for (const choice of choices) {
      fireEvent.click(
        screen.queryByRole('radio', { name: choice }) ??
          screen.getByRole('button', { name: choice }),
      );
    }
    save();
    const saved = await savedPayload(onDone);
    expect(saved.payload).toEqual(payload);
  });

  it.each([NAIL_TRIM_TYPE, SPIT_UP_TYPE, SYMPTOM_TYPE, SKIN_CARE_TYPE])(
    'logs %#: %s without any detail, since every field is optional',
    async (type) => {
      const onDone = renderSheet(type);
      save();
      const saved = await savedPayload(onDone);
      expect(saved.payload).toEqual({});
    },
  );
});
