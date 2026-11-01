import { describe, expect, it } from 'vitest';
import type { Appointment } from '../db/models';
import {
  agendaOf,
  endOf,
  hasStarted,
  needsOutcome,
  nextAppointment,
  normalizeReminders,
} from './appointmentModel';

const NOW = Date.parse('2026-10-22T12:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

function make(id: string, startsAt: string, extra: Partial<Appointment> = {}): Appointment {
  return {
    id,
    babyId: 'baby-1',
    title: id,
    type: 'consultation',
    startsAt,
    durationMinutes: null,
    location: null,
    doctorName: null,
    notes: null,
    outcome: null,
    status: 'upcoming',
    reminderOffsetsMinutes: [1440, 120],
    createdBy: null,
    createdAt: startsAt,
    updatedAt: startsAt,
    ...extra,
  };
}

describe('appointment rules', () => {
  it('ends after its duration, or after an hour without one', () => {
    expect(endOf(make('a', at(0), { durationMinutes: 30 }))).toBe(NOW + HOUR / 2);
    expect(endOf(make('b', at(0)))).toBe(NOW + HOUR);
  });

  it('offers "done" and asks "Did it happen?" only once the start has come', () => {
    expect(hasStarted(make('a', at(1000)), NOW)).toBe(false);
    expect(hasStarted(make('a', at(0)), NOW)).toBe(true);
    expect(needsOutcome(make('a', at(-HOUR)), NOW)).toBe(true);
    expect(needsOutcome(make('a', at(-HOUR), { status: 'done' }), NOW)).toBe(false);
    expect(needsOutcome(make('a', at(-HOUR), { status: 'cancelled' }), NOW)).toBe(false);
  });

  it('keeps known reminder offsets once each, largest first; absent is the default', () => {
    expect(normalizeReminders([30, 10080, 30, 60, '120'])).toEqual([10080, 30]);
    expect(normalizeReminders(null)).toEqual([1440, 120]);
    expect(normalizeReminders([])).toEqual([]);
  });
});

describe('agenda', () => {
  const list = [
    make('past-done', at(-3 * DAY), { status: 'done' }),
    make('soon', at(2 * DAY)),
    make('ongoing', at(-HOUR / 2)),
    make('missed', at(-2 * DAY)),
    make('cancelled-ahead', at(DAY), { status: 'cancelled' }),
    make('later', at(20 * DAY)),
  ];

  it('lists upcoming soonest first, then the rest newest first', () => {
    const { upcoming, past } = agendaOf(list, NOW);

    expect(upcoming.map((a) => a.id)).toEqual(['ongoing', 'soon', 'later']);
    expect(past.map((a) => a.id)).toEqual(['cancelled-ahead', 'missed', 'past-done']);
  });

  it('shows the next appointment on Now only within 14 days', () => {
    expect(nextAppointment(list, NOW)?.id).toBe('ongoing');
    expect(nextAppointment([make('later', at(20 * DAY))], NOW)).toBeNull();
    expect(nextAppointment([make('edge', at(14 * DAY))], NOW)?.id).toBe('edge');
    expect(nextAppointment([make('c', at(DAY), { status: 'cancelled' })], NOW)).toBeNull();
  });
});
