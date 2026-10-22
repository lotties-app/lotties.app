import { describe, expect, it } from 'vitest';
import type { Appointment } from '../db/models';
import {
  addDays,
  appointmentsByDay,
  dayKeyOf,
  firstDayOfWeek,
  instantOf,
  monthGrid,
  shiftMonth,
  timeOfDayOf,
} from './calendarModel';

/*
 * Calendar maths across daylight saving changes: Europe/Lisbon (clocks forward on 29 March 2026,
 * back on 25 October 2026) and America/New_York (forward on 8 March, back on 1 November 2026).
 */

const LISBON = 'Europe/Lisbon';
const NEW_YORK = 'America/New_York';

const appointment = (id: string, startsAt: string): Appointment => ({
  id,
  babyId: 'baby-1',
  title: id,
  type: 'other',
  startsAt,
  durationMinutes: null,
  location: null,
  doctorName: null,
  notes: null,
  outcome: null,
  status: 'upcoming',
  reminderOffsetsMinutes: [],
  createdBy: null,
  createdAt: startsAt,
  updatedAt: startsAt,
});

describe('local days and times', () => {
  it('reads the local date and time in the zone, on both sides of a change', () => {
    expect(dayKeyOf('2026-03-28T23:30:00Z', LISBON)).toBe('2026-03-28');
    expect(dayKeyOf('2026-03-29T23:30:00Z', LISBON)).toBe('2026-03-30');
    expect(timeOfDayOf('2026-03-29T23:30:00Z', LISBON)).toBe('00:30');
    expect(dayKeyOf('2026-11-01T04:30:00Z', NEW_YORK)).toBe('2026-11-01');
    expect(dayKeyOf('2026-11-02T04:30:00Z', NEW_YORK)).toBe('2026-11-01');
    expect(timeOfDayOf('2026-11-02T04:30:00Z', NEW_YORK)).toBe('23:30');
  });

  it('turns a local date and time into the right instant before and after a change', () => {
    expect(instantOf('2026-03-28', '09:00', LISBON)).toBe('2026-03-28T09:00:00.000Z');
    expect(instantOf('2026-03-30', '09:00', LISBON)).toBe('2026-03-30T08:00:00.000Z');
    expect(instantOf('2026-10-31', '15:30', NEW_YORK)).toBe('2026-10-31T19:30:00.000Z');
    expect(instantOf('2026-11-02', '15:30', NEW_YORK)).toBe('2026-11-02T20:30:00.000Z');
  });

  it('moves a time the clocks skip to just after the gap, and takes the first of a repeated one', () => {
    expect(instantOf('2026-03-08', '02:30', NEW_YORK)).toBe('2026-03-08T07:30:00.000Z');
    expect(timeOfDayOf(instantOf('2026-03-08', '02:30', NEW_YORK), NEW_YORK)).toBe('03:30');
    expect(instantOf('2026-11-01', '01:30', NEW_YORK)).toBe('2026-11-01T05:30:00.000Z');
    expect(instantOf('2026-03-29', '01:30', LISBON)).toBe('2026-03-29T01:30:00.000Z');
    expect(timeOfDayOf(instantOf('2026-03-29', '01:30', LISBON), LISBON)).toBe('02:30');
  });

  it('round-trips every hour of a change day', () => {
    for (const zone of [LISBON, NEW_YORK]) {
      for (const day of ['2026-03-08', '2026-03-29', '2026-10-25', '2026-11-01']) {
        for (const hour of [0, 4, 9, 12, 18, 23]) {
          const time = `${String(hour).padStart(2, '0')}:15`;
          const instant = instantOf(day, time, zone);
          expect(dayKeyOf(instant, zone)).toBe(day);
          expect(timeOfDayOf(instant, zone)).toBe(time);
        }
      }
    }
  });
});

describe('month grid', () => {
  it('fills whole weeks, starting on Sunday or Monday', () => {
    const sunday = monthGrid({ year: 2026, month: 3 }, 0);
    const monday = monthGrid({ year: 2026, month: 3 }, 1);

    expect(sunday[0]!.map((cell) => cell.key)).toEqual([
      '2026-03-01',
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
      '2026-03-06',
      '2026-03-07',
    ]);
    expect(monday[0]![0]).toEqual({ key: '2026-02-23', day: 23, inMonth: false });
    expect(monday.at(-1)!.at(-1)).toEqual({ key: '2026-04-05', day: 5, inMonth: false });
    expect(sunday.flat().filter((cell) => cell.inMonth)).toHaveLength(31);
    expect([sunday.length, monday.length]).toEqual([5, 6]);
  });

  it('never repeats or skips a day in a month with a daylight saving change', () => {
    for (const month of [3, 10, 11]) {
      const days = monthGrid({ year: 2026, month }, 1)
        .flat()
        .map((cell) => cell.key);
      days.slice(1).forEach((key, index) => expect(key).toBe(addDays(days[index]!, 1)));
    }
  });

  it('a February starting on the week start takes four rows', () => {
    expect(monthGrid({ year: 2026, month: 2 }, 0)).toHaveLength(4);
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });
});

describe('week start per locale', () => {
  it('follows the app language, refined by the device region of the same language', () => {
    expect(firstDayOfWeek('pt-BR', [])).toBe(0);
    expect(firstDayOfWeek('en', ['en-US'])).toBe(0);
    expect(firstDayOfWeek('en', ['en-GB', 'pt-BR'])).toBe(1);
    expect(firstDayOfWeek('en', ['pt-PT'])).toBe(0);
    expect(firstDayOfWeek('en', ['en-IE'])).toBe(1);
    expect(firstDayOfWeek('pt-BR', ['pt'])).toBe(0);
  });
});

describe('appointments by day', () => {
  it('groups by the local day of the zone, by start', () => {
    const late = appointment('late', '2026-11-02T04:30:00Z');
    const morning = appointment('morning', '2026-11-01T13:00:00Z');
    const next = appointment('next', '2026-11-02T14:00:00Z');

    const byDay = appointmentsByDay([next, late, morning], NEW_YORK);

    expect([...byDay.keys()]).toEqual(['2026-11-01', '2026-11-02']);
    expect(byDay.get('2026-11-01')!.map((a) => a.id)).toEqual(['morning', 'late']);
  });
});
