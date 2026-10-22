import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { Appointment, BabyRole } from '../db/models';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import { UndoSnackbar } from '../ui/UndoSnackbar';
import { AppointmentsScreen } from './AppointmentsScreen';

/*
 * The appointments page (docs/design/15-appointments.md): the month grid (labelled cells, today,
 * dots, keyboard), the agenda (upcoming, past with status), the sheet, the detail with "Did it
 * happen?", cancel with Undo and "Add to calendar", and the read-only roles. Local times are
 * built in the test's own zone, as the device shows them.
 */

let db: BabyRoutineDb;

/** Thursday 22 October 2026, 10:00 local. */
const NOW = new Date(2026, 9, 22, 10, 0).getTime();
const local = (day: number, hour: number, minute = 0) =>
  new Date(2026, 9, day, hour, minute).toISOString();

function appointment(id: string, extra: Partial<Appointment> = {}): Appointment {
  return {
    id,
    babyId: BABY_ID,
    title: id,
    type: 'consultation',
    startsAt: local(24, 15, 30),
    durationMinutes: null,
    location: null,
    doctorName: null,
    notes: null,
    outcome: null,
    status: 'upcoming',
    reminderOffsetsMinutes: [1440, 120],
    createdBy: 'u1',
    createdAt: local(1, 9),
    updatedAt: local(1, 9),
    ...extra,
  };
}

const SEEDED: Appointment[] = [
  appointment('Pediatrician', {
    startsAt: local(24, 15, 30),
    durationMinutes: 30,
    location: 'Clinic',
    doctorName: 'Dr. Ana',
    notes: 'Bring the card',
  }),
  appointment('Vaccines', { type: 'vaccine', startsAt: local(24, 9, 0) }),
  appointment('Hip ultrasound', { type: 'exam', startsAt: local(20, 16, 0) }),
  appointment('First visit', { startsAt: local(2, 9, 0), status: 'done', outcome: 'All good' }),
  appointment('Lactation', { type: 'other', startsAt: local(30, 11), status: 'cancelled' }),
];

beforeEach(async () => {
  db = testDatabase();
  await seedBaby(db);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await settleSync();
  await db.delete();
});

async function renderScreen(role: BabyRole = 'Owner', list: Appointment[] = SEEDED) {
  await db.appointments.bulkPut(list);
  renderWithDb(
    db,
    <>
      <AppointmentsScreen
        baby={{ id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role }}
        initialNow={NOW}
      />
      <UndoSnackbar />
    </>,
  );
  return screen.findByRole('grid', { name: /October 2026|outubro de 2026/ });
}

const dayButton = (grid: HTMLElement, label: RegExp) =>
  within(grid).getByRole('button', { name: label });

async function violations() {
  const result = await axe.run(document.body, {
    runOnly: ['wcag2a', 'wcag2aa'],
    rules: { 'color-contrast': { enabled: false } },
  });
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
}

describe('the month grid', () => {
  it('labels every day, marks today and counts the appointments of a day', async () => {
    const grid = await renderScreen();

    expect(within(grid).getAllByRole('columnheader')).toHaveLength(7);
    const today = dayButton(grid, /October 22.*today/);
    expect(today.getAttribute('aria-current')).toBe('date');
    expect(today.getAttribute('tabindex')).toBe('0');
    expect(dayButton(grid, /October 24, 2 appointments$/)).toBeTruthy();
    // Cancelled appointments are no dots.
    expect(dayButton(grid, /October 30$/)).toBeTruthy();
    expect(within(grid).getAllByRole('button')).toHaveLength(31);
  });

  it('moves between days with the arrows and into the next month with Page Down', async () => {
    const grid = await renderScreen();
    const today = dayButton(grid, /October 22/);
    act(() => today.focus());

    fireEvent.keyDown(today, { key: 'ArrowRight' });
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('aria-label')).toMatch(/October 23/),
    );
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('aria-label')).toMatch(/October 30/),
    );
    fireEvent.keyDown(document.activeElement!, { key: 'PageDown' });

    expect(await screen.findByRole('grid', { name: 'November 2026' })).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('aria-label')).toMatch(/November 28/),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(await screen.findByRole('grid', { name: 'October 2026' })).toBeTruthy();
  });

  it('filters the agenda to a tapped day and shows everything again', async () => {
    const grid = await renderScreen();

    fireEvent.click(dayButton(grid, /October 24/));
    const day = await screen.findByRole('region', { name: 'Saturday, October 24' });
    expect(
      within(day)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual([expect.stringContaining('Vaccines'), expect.stringContaining('Pediatrician')]);
    expect(dayButton(grid, /October 24/).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Show all appointments' }));
    expect(await screen.findByRole('region', { name: 'Upcoming' })).toBeTruthy();
  });
});

describe('the agenda', () => {
  it('lists upcoming soonest first, then past ones newest first with their status', async () => {
    await renderScreen();

    const upcoming = await screen.findByRole('region', { name: 'Upcoming' });
    expect(
      within(upcoming)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual([expect.stringContaining('Vaccines'), expect.stringContaining('Pediatrician')]);
    const past = screen.getByRole('region', { name: 'Past' });
    const rows = within(past).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/Lactation.*Cancelled/),
      expect.stringMatching(/Hip ultrasound.*Did it happen\?/),
      expect.stringMatching(/First visit.*Done/),
    ]);
  });

  it('invites the first appointment when there is none', async () => {
    await renderScreen('Owner', []);

    expect(await screen.findByRole('heading', { name: 'No appointments yet' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'New appointment' })).toHaveLength(2);
  });
});

describe('adding and changing appointments', () => {
  it('adds an appointment with a type and the default reminders', async () => {
    await renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'New appointment' }));
    const sheet = await screen.findByRole('dialog', { name: 'New appointment' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(await within(sheet).findByText('Enter a title of up to 80 characters.')).toBeTruthy();

    fireEvent.change(within(sheet).getByRole('textbox', { name: /^Title/ }), {
      target: { value: 'Ear exam' },
    });
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Exam' }));
    expect(
      within(sheet)
        .getAllByRole('button', { pressed: true })
        .map((chip) => chip.textContent),
    ).toEqual(['1 day', '2 hours']);
    const remindMe = within(sheet).getByRole('group', { name: 'Remind me' });
    fireEvent.click(within(remindMe).getByRole('button', { name: '30 min' }));
    const lengths = within(sheet).getByRole('radiogroup', { name: 'Usual lengths' });
    expect(
      within(lengths)
        .getAllByRole('radio')
        .map((chip) => chip.textContent),
    ).toEqual(['15 minutes', '30 minutes', '1 hour']);
    fireEvent.click(within(lengths).getByRole('radio', { name: '1 hour' }));
    expect(within(sheet).getByRole('spinbutton', { name: /^Duration/ })).toHaveProperty(
      'value',
      '60',
    );
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const stored = (await db.appointments.toArray()).find((a) => a.title === 'Ear exam');
    expect(stored).toMatchObject({
      type: 'exam',
      status: 'upcoming',
      reminderOffsetsMinutes: [1440, 120, 30],
      durationMinutes: 60,
      startsAt: local(22, 11, 0),
    });
    expect((await db.outbox.toArray()).map((m) => m.entityType)).toEqual(['appointment']);
  });

  it('marks a visit that has passed as done with how it went', async () => {
    await renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: /Hip ultrasound/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Hip ultrasound' });
    const ask = within(sheet).getByRole('region', { name: /Did it happen\?/ });
    fireEvent.click(within(ask).getByRole('button', { name: /Add a note|How it went/ }));
    fireEvent.change(within(ask).getByRole('textbox'), { target: { value: 'Normal' } });
    expect(within(ask).getByRole('button', { name: 'Add measurements' })).toBeTruthy();
    fireEvent.click(within(ask).getByRole('button', { name: 'Mark as done' }));

    await waitFor(async () =>
      expect(await db.appointments.get('Hip ultrasound')).toMatchObject({
        status: 'done',
        outcome: 'Normal',
      }),
    );
  });

  it('offers no "Mark as done" before the start, and cancels with Undo', async () => {
    await renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: /Pediatrician/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Pediatrician' });
    expect(within(sheet).queryByRole('button', { name: 'Mark as done' })).toBeNull();
    expect(within(sheet).getByText('Dr. Ana')).toBeTruthy();
    expect(within(sheet).getByText('1 day and 2 hours before')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel appointment' }));

    await waitFor(async () =>
      expect((await db.appointments.get('Pediatrician'))?.status).toBe('cancelled'),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(async () =>
      expect((await db.appointments.get('Pediatrician'))?.status).toBe('upcoming'),
    );
  });

  it('exports the appointment as an .ics file', async () => {
    const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    const created: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob);
      return 'blob:appointment';
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      await renderScreen();

      fireEvent.click(await screen.findByRole('button', { name: /Pediatrician/ }));
      fireEvent.click(await screen.findByRole('button', { name: 'Add to calendar' }));

      expect(click).toHaveBeenCalledTimes(1);
      const text = await created[0]!.text();
      expect(text).toMatch(/^BEGIN:VCALENDAR\r\n/);
      expect(text).toContain('UID:Pediatrician@lotties.app');
      expect(created[0]!.type).toBe('text/calendar;charset=utf-8');
    } finally {
      URL.createObjectURL = original.create;
      URL.revokeObjectURL = original.revoke;
    }
  });
});

describe('read-only roles', () => {
  it.each(['Caregiver', 'Viewer'] as const)(
    'a %s sees everything without dead buttons',
    async (role) => {
      await renderScreen(role);

      expect(screen.queryByRole('button', { name: 'New appointment' })).toBeNull();
      expect(screen.getByRole('alert')).toBeTruthy();
      fireEvent.click(await screen.findByRole('button', { name: /Hip ultrasound/ }));
      const sheet = await screen.findByRole('dialog', { name: 'Hip ultrasound' });
      expect(within(sheet).getByRole('button', { name: 'Add to calendar' })).toBeTruthy();
      for (const name of ['Edit', 'Cancel appointment', 'Mark as done']) {
        expect(within(sheet).queryByRole('button', { name })).toBeNull();
      }
      expect(
        within(sheet).getByText('You can see the appointments but not change them.'),
      ).toBeTruthy();
    },
  );
});

describe('pt-BR', () => {
  it('reads Consultas, the type chips and the actions in Portuguese', async () => {
    await useTestLocale('pt-BR');
    await renderScreen();

    expect(await screen.findByRole('heading', { name: 'Consultas' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Pediatrician/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Pediatrician' });
    expect(within(sheet).getByRole('button', { name: 'Adicionar ao calendário' })).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Cancelar consulta' })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Editar' }));
    const edit = await screen.findByRole('dialog', { name: 'Editar consulta' });
    expect(
      within(within(edit).getByRole('radiogroup', { name: /^Tipo/ }))
        .getAllByRole('radio')
        .map((chip) => chip.textContent),
    ).toEqual(['Consulta', 'Vacina', 'Exame', 'Outro']);
    expect(within(edit).getByRole('group', { name: 'Me lembrar' })).toBeTruthy();
    expect(within(edit).getByRole('radio', { name: '30 minutos' })).toBeTruthy();
    expect(
      within(edit)
        .getAllByRole('button', { pressed: false })
        .map((chip) => chip.textContent),
    ).toEqual(expect.arrayContaining(['1 semana', '30 min']));
  });
});

describe.each(['light', 'dark'] as const)('appointments in the %s scheme', (scheme) => {
  it.each(['en', 'pt-BR'] as const)(
    'has no accessibility violations in %s, with the detail and the sheet open',
    async (locale) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
      if (locale === 'pt-BR') await useTestLocale('pt-BR');
      await renderScreen();
      expect(await violations()).toEqual([]);

      fireEvent.click(screen.getByRole('button', { name: /Hip ultrasound/ }));
      await screen.findByRole('dialog', { name: 'Hip ultrasound' });
      expect(await violations()).toEqual([]);

      fireEvent.click(screen.getByRole('button', { name: locale === 'en' ? 'Edit' : 'Editar' }));
      await screen.findByRole('dialog', {
        name: locale === 'en' ? 'Edit appointment' : 'Editar consulta',
      });
      expect(await violations()).toEqual([]);
    },
    60_000,
  );
});
