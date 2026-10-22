import { useState } from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { PrescriptionSheet } from './PrescriptionSheet';
import { byParts } from './prescriptionFixtures';

let db: BabyRoutineDb;

beforeEach(async () => {
  db = testDatabase();
  window.localStorage.clear();
  await seedBaby(db, { medications: true });
});

afterEach(async () => {
  await settleSync();
  vi.restoreAllMocks();
  await db.delete();
});

function Host(props: React.ComponentProps<typeof PrescriptionSheet>) {
  const [open, setOpen] = useState(true);
  return open ? (
    <PrescriptionSheet
      {...props}
      onDone={() => {
        props.onDone();
        setOpen(false);
      }}
    />
  ) : null;
}

function renderSheet(props: Partial<React.ComponentProps<typeof PrescriptionSheet>> = {}) {
  const onDone = vi.fn();
  renderWithDb(db, <Host babyId={BABY_ID} onDone={onDone} {...props} />);
  return { onDone };
}

const sheet = () => screen.findByRole('dialog', { name: /prescription|receita/i });

async function waitForDateFields() {
  await waitFor(() => expect(screen.queryByLabelText('Loading the date field')).toBeNull());
}

async function chooseParts(...names: string[]) {
  fireEvent.click(screen.getByRole('radio', { name: 'At set times' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Part of the day' }));
  const parts = screen.getByRole('group', { name: /^Parts of the day/ });
  for (const name of names) fireEvent.click(within(parts).getByRole('button', { name }));
  fireEvent.change(screen.getByRole('spinbutton', { name: /Dose/ }), { target: { value: '1' } });
  fireEvent.change(screen.getByRole('textbox', { name: /^Unit/ }), {
    target: { value: 'drops' },
  });
}

describe('PrescriptionSheet: part of the day', () => {
  it('saves the chosen parts with reminders off by default', async () => {
    renderSheet({ medicationId: 'm-a' });
    await sheet();
    await chooseParts('Night', 'Morning');

    expect(screen.getByText('Give 1 drop, in the morning and at night')).toBeTruthy();
    expect(screen.getByText(/Morning 05:00–12:00/)).toBeTruthy();
    const reminders = screen.getByRole('switch', { name: /Remind me in each part/ });
    expect(reminders.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByLabelText('Morning reminder')).toBeNull();
    await waitForDateFields();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => expect(await db.prescriptions.count()).toBe(1));
    const [saved] = await db.prescriptions.toArray();
    expect(saved).toMatchObject({
      kind: 'scheduled',
      dayParts: ['morning', 'night'],
      dayPartReminders: null,
      timesOfDay: null,
      everyMinutes: null,
    });
    const [queued] = await db.outbox.toArray();
    expect(queued.payload).toMatchObject({
      dayParts: ['morning', 'night'],
      dayPartReminders: null,
    });
  });

  it('turns reminders on with a default time per chosen part and checks the window', async () => {
    renderSheet({ medicationId: 'm-a' });
    await sheet();
    await chooseParts('Night', 'Evening');
    fireEvent.click(screen.getByRole('switch', { name: /Remind me in each part/ }));

    const evening = screen.getByLabelText('Evening reminder') as HTMLInputElement;
    const night = screen.getByLabelText('Night reminder') as HTMLInputElement;
    expect([evening.type, evening.value, night.value]).toEqual(['time', '19:00', '22:00']);
    fireEvent.change(night, { target: { value: '21:00' } });
    await waitForDateFields();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Night: choose a time between 22:00 and 05:00.')).toBeTruthy();
    expect(await db.prescriptions.count()).toBe(0);

    fireEvent.change(screen.getByLabelText('Night reminder'), { target: { value: '01:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect(await db.prescriptions.count()).toBe(1));
    const [saved] = await db.prescriptions.toArray();
    expect(saved.dayPartReminders).toEqual([
      { part: 'evening', time: '19:00' },
      { part: 'night', time: '01:30' },
    ]);
  });

  it('needs at least one part', async () => {
    renderSheet({ medicationId: 'm-a' });
    await sheet();
    await chooseParts();
    await waitForDateFields();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Choose at least one part of the day.')).toBeTruthy();
    expect(await db.prescriptions.count()).toBe(0);
  });

  it('opens an existing part-of-the-day prescription with its parts and reminders', async () => {
    const existing = byParts('m-a', ['afternoon'], {
      reminders: [{ part: 'afternoon', time: '15:30' }],
    });
    await db.prescriptions.put(existing);
    renderSheet({ prescription: existing });
    await sheet();

    expect(
      (screen.getByRole('radio', { name: 'Part of the day' }) as HTMLInputElement).getAttribute(
        'aria-checked',
      ),
    ).toBe('true');
    expect(
      within(screen.getByRole('group', { name: /^Parts of the day/ }))
        .getByRole('button', { name: 'Afternoon' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect((screen.getByLabelText('Afternoon reminder') as HTMLInputElement).value).toBe('15:30');
  });

  it('reads the parts in Portuguese', async () => {
    await useTestLocale('pt-BR');
    renderSheet({ medicationId: 'm-a' });
    await sheet();
    fireEvent.click(screen.getByRole('radio', { name: 'Em horários fixos' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Período do dia' }));
    const parts = screen.getByRole('group', { name: /^Períodos do dia/ });
    expect(
      within(parts)
        .getAllByRole('button')
        .map((chip) => chip.textContent),
    ).toEqual(['Manhã', 'Tarde', 'Noite', 'Madrugada']);
    await useTestLocale('en');
  });

  it('has no accessibility violations with reminders on', async () => {
    renderSheet({ medicationId: 'm-a' });
    await sheet();
    await chooseParts('Morning');
    fireEvent.click(screen.getByRole('switch', { name: /Remind me in each part/ }));
    await waitForDateFields();

    const result = await axe.run(document.body, {
      runOnly: ['wcag2a', 'wcag2aa'],
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(
      result.violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
      ),
    ).toEqual([]);
  }, 60_000);
});
