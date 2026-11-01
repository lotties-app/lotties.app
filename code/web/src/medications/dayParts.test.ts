import { describe, expect, it } from 'vitest';
import type { DayPart, DayPartReminder, Prescription } from '../db/models';
import {
  DAY_PARTS,
  DEFAULT_REMINDER_TIMES,
  dayPartEnd,
  dayPartOf,
  dayPartWindow,
  instantInPart,
  partAt,
  sortDayParts,
} from './dayParts';
import vectors from './dayPartVectors.json';
import { MED_A, prescription } from './prescriptionFixtures';
import { calculateMedicationStatus, type MedicationDose } from './statusCalculator';

/*
 * The shared vectors (dayPartVectors.json) are also read by the API's DayPartVectorTests: the same
 * inputs must give the same windows and states on both sides.
 */

interface StatusVector {
  name: string;
  offsetMinutes: number;
  now: string;
  prescription: {
    parts: string[];
    reminders?: { part: string; time: string }[];
    startDate: string;
    endDate?: string;
    createdAt?: string;
  };
  doses: { at: string; named?: boolean; otherPrescription?: boolean }[];
  expected: {
    day: string;
    parts: {
      part: string;
      state: string;
      givenAt?: string;
      doseCount?: number;
      reminderAt?: string;
    }[];
    current: string | null;
    next: { part: string; day: string } | null;
    givenCount: number;
    guard: string;
    courseStarted: boolean;
    courseEnded: boolean;
  };
}

const iso = (value: string | number | Date) => new Date(value).toISOString();
const isoOrNull = (value: Date | null) => (value ? value.toISOString() : null);

function prescriptionOf(v: StatusVector): Prescription {
  return prescription({
    medicationId: MED_A,
    kind: 'scheduled',
    dayParts: v.prescription.parts as DayPart[],
    dayPartReminders: (v.prescription.reminders as DayPartReminder[] | undefined) ?? null,
    startDate: v.prescription.startDate,
    endDate: v.prescription.endDate ?? null,
    createdAt: iso(v.prescription.createdAt ?? '2026-01-01T00:00:00Z'),
  });
}

function doseOf(d: StatusVector['doses'][number], rxId: string): MedicationDose {
  const prescriptionId = d.named ? rxId : d.otherPrescription ? 'rx-other' : null;
  return { givenAt: Date.parse(d.at), medicationId: MED_A, prescriptionId, override: false };
}

describe('day parts (shared vectors with the API)', () => {
  it.each(vectors.dayPartOf)('dayPartOf: $name', (v) => {
    expect(dayPartOf(Date.parse(v.at), v.offsetMinutes)).toEqual({ day: v.day, part: v.part });
  });

  it.each(vectors.windows)('window: $name', (v) => {
    const window = dayPartWindow(v.day, v.part as DayPart, v.offsetMinutes);
    expect([iso(window.start), iso(window.end)]).toEqual([iso(v.start), iso(v.end)]);
  });

  it.each(vectors.status as StatusVector[])('status: $name', (v) => {
    const p = prescriptionOf(v);
    const [status] = calculateMedicationStatus({
      prescriptions: [p],
      doses: v.doses.map((d) => doseOf(d, p.id)),
      now: new Date(v.now),
      utcOffsetMinutes: v.offsetMinutes,
      weight: null,
    });
    const parts = status.dayParts!;
    const e = v.expected;
    expect(parts.day).toBe(e.day);
    expect(
      parts.parts.map((slot) => ({
        part: slot.part,
        state: slot.state,
        givenAt: isoOrNull(slot.givenAt),
        doseCount: slot.doseCount,
        reminderAt: isoOrNull(slot.reminderAt),
      })),
    ).toEqual(
      e.parts.map((slot) => ({
        part: slot.part,
        state: slot.state,
        givenAt: slot.givenAt ? iso(slot.givenAt) : null,
        doseCount: slot.doseCount ?? 0,
        reminderAt: slot.reminderAt ? iso(slot.reminderAt) : null,
      })),
    );
    expect(parts.current?.part ?? null).toBe(e.current);
    expect(parts.next ? { part: parts.next.part, day: parts.next.day } : null).toEqual(e.next);
    expect([parts.givenCount, parts.guard]).toEqual([e.givenCount, e.guard]);
    expect([status.courseStarted, status.courseEnded]).toEqual([e.courseStarted, e.courseEnded]);
  });
});

describe('day part windows', () => {
  it('cover the whole day without gaps, in day order', () => {
    expect(DAY_PARTS.map(dayPartEnd)).toEqual(['12:00', '18:00', '22:00', '05:00']);
    expect(sortDayParts(['night', 'morning', 'night'])).toEqual(['morning', 'night']);
  });

  it('suggest a default reminder inside each window', () => {
    for (const part of DAY_PARTS) expect(partAt(DEFAULT_REMINDER_TIMES[part])).toBe(part);
  });

  it('place a night time after midnight on the next date', () => {
    expect(iso(instantInPart('2026-03-02', 'night', '01:30', -180))).toBe(
      '2026-03-03T04:30:00.000Z',
    );
    expect(iso(instantInPart('2026-03-02', 'night', '22:30', -180))).toBe(
      '2026-03-03T01:30:00.000Z',
    );
  });

  it('other schedules have no part status', () => {
    const [status] = calculateMedicationStatus({
      prescriptions: [prescription({ kind: 'scheduled', timesOfDay: ['08:00'] })],
      doses: [],
      now: new Date('2026-03-02T12:00:00Z'),
      utcOffsetMinutes: 0,
      weight: null,
    });
    expect(status.dayParts).toBeNull();
  });
});
