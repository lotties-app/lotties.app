import { describe, expect, it } from 'vitest';
import {
  calculateMedicationStatus,
  dosesFromEvents,
  type BodyWeight,
  type MedicationDose,
} from './statusCalculator';
import { asNeeded, atTimes, dose, every, local, MED_A, MED_B, calc } from './prescriptionFixtures';
import type { BabyEvent } from '../db/models';

/*
 * Parity tests: the scenarios of code/api/tests/BabyRoutine.Domain.Tests/Prescriptions/
 * MedicationStatusCalculatorTests.cs, with the same expectations.
 */

const SAO_PAULO = -180;
const HOUR = 3_600_000;

describe('MedicationStatusCalculator (parity with the API)', () => {
  it('owner example: as needed every 8h in a shared group, a dose of one blocks both until 18:00', () => {
    const x = asNeeded(MED_A, 480, { group: 'colic' });
    const z = asNeeded(MED_B, 480, { group: 'colic' });
    const given = local(2026, 3, 2, 10, 0, SAO_PAULO);

    const statuses = calc(
      [x, z],
      [dose(given, MED_A, x.id)],
      local(2026, 3, 2, 12, 0, SAO_PAULO),
      SAO_PAULO,
    );

    for (const status of statuses) {
      expect(status.availableAt).toEqual(local(2026, 3, 2, 18, 0, SAO_PAULO));
      expect(status.availableNow).toBe(false);
    }
    const sx = statuses.find((s) => s.prescription.id === x.id)!;
    const sz = statuses.find((s) => s.prescription.id === z.id)!;
    expect(sx.groupMemberIds).toEqual([z.id]);
    expect(sx.dosesLast24h).toBe(1);
    expect(sz.dosesLast24h).toBe(0);
  });

  it('as needed: available again after the interval', () => {
    const p = asNeeded(MED_A, 480);
    const given = local(2026, 3, 2, 10, 0, SAO_PAULO);
    const [status] = calc(
      [p],
      [dose(given, MED_A)],
      local(2026, 3, 2, 18, 0, SAO_PAULO),
      SAO_PAULO,
    );
    expect(status.availableNow).toBe(true);
    expect(status.lastDoseAt).toEqual(given);
    expect(status.nextScheduledAt).toBeNull();
    expect(status.overdueByMinutes).toBeNull();
  });

  it('as needed without doses is available without times', () => {
    const [s] = calc([asNeeded(MED_A, 480)], [], local(2026, 3, 2, 12, 0, SAO_PAULO), SAO_PAULO);
    expect([s.availableNow, s.availableAt, s.lastDoseAt, s.dosesLast24h]).toEqual([
      true,
      null,
      null,
      0,
    ]);
  });

  it('max per 24h reached waits for the oldest counted dose to leave the window', () => {
    const now = new Date(Date.UTC(2026, 2, 2, 12));
    const p = asNeeded(MED_A, 240, { maxDoses: 3 });
    const at = (hoursAgo: number) => dose(new Date(now.getTime() - hoursAgo * HOUR), MED_A);
    const [s] = calc([p], [at(20), at(12), at(5), at(30)], now);
    expect([s.dosesLast24h, s.limitReached, s.availableNow]).toEqual([3, true, false]);
    expect(s.availableAt).toEqual(new Date(now.getTime() + 4 * HOUR));
  });

  it('max per 24h below the limit uses the interval', () => {
    const now = new Date(Date.UTC(2026, 2, 2, 12));
    const p = asNeeded(MED_A, 240, { maxDoses: 3 });
    const [s] = calc(
      [p],
      [
        dose(new Date(now.getTime() - 5 * HOUR), MED_A),
        dose(new Date(now.getTime() - 2 * HOUR), MED_A),
      ],
      now,
    );
    expect([s.dosesLast24h, s.limitReached]).toEqual([2, false]);
    expect(s.availableAt).toEqual(new Date(now.getTime() + 2 * HOUR));
  });

  it('owner example: scheduled morning is upcoming, then overdue, then taken', () => {
    const p = atTimes(MED_A, ['08:00']);
    const [before] = calc([p], [], local(2026, 3, 2, 7, 0, SAO_PAULO), SAO_PAULO);
    const [late] = calc([p], [], local(2026, 3, 2, 9, 0, SAO_PAULO), SAO_PAULO);
    const [taken] = calc(
      [p],
      [dose(local(2026, 3, 2, 7, 45, SAO_PAULO), MED_A)],
      local(2026, 3, 2, 9, 0, SAO_PAULO),
      SAO_PAULO,
    );
    expect([before.nextScheduledAt, before.overdueByMinutes]).toEqual([
      local(2026, 3, 2, 8, 0, SAO_PAULO),
      null,
    ]);
    expect([late.nextScheduledAt, late.overdueByMinutes]).toEqual([
      local(2026, 3, 3, 8, 0, SAO_PAULO),
      60,
    ]);
    expect([taken.nextScheduledAt, taken.overdueByMinutes]).toEqual([
      local(2026, 3, 3, 8, 0, SAO_PAULO),
      null,
    ]);
    expect(taken.availableNow).toBe(true);
  });

  it('a dose outside the 90 minute window does not take the slot', () => {
    const p = atTimes(MED_A, ['08:00']);
    const [s] = calc(
      [p],
      [dose(local(2026, 3, 2, 9, 31, SAO_PAULO), MED_A)],
      local(2026, 3, 2, 10, 0, SAO_PAULO),
      SAO_PAULO,
    );
    expect(s.overdueByMinutes).toBe(120);
  });

  it('one dose takes only one slot', () => {
    const p = atTimes(MED_A, ['08:00', '09:00']);
    const [s] = calc([p], [dose(local(2026, 3, 2, 8, 30, 0), MED_A)], local(2026, 3, 2, 9, 30, 0));
    expect(s.overdueByMinutes).toBe(30);
  });

  it('two missed slots: overdue counts from the latest', () => {
    const p = atTimes(MED_A, ['08:00', '20:00']);
    const [s] = calc([p], [], local(2026, 3, 2, 21, 0, 0), 0);
    expect([s.overdueByMinutes, s.nextScheduledAt]).toEqual([60, local(2026, 3, 3, 8, 0, 0)]);
  });

  describe('midnight', () => {
    it('a dose after midnight takes yesterday late slot', () => {
      const p = atTimes(MED_A, ['23:30']);
      const [s] = calc(
        [p],
        [dose(local(2026, 3, 3, 0, 30, 0), MED_A)],
        local(2026, 3, 3, 0, 45, 0),
      );
      expect(s.overdueByMinutes).toBeNull();
      expect(s.nextScheduledAt).toEqual(local(2026, 3, 3, 23, 30, 0));
    });

    it("yesterday's slot is overdue only within the match window", () => {
      const p = atTimes(MED_A, ['23:30']);
      const [shortly] = calc([p], [], local(2026, 3, 3, 0, 45, 0));
      const [later] = calc([p], [], local(2026, 3, 3, 1, 30, 0));
      expect(shortly.overdueByMinutes).toBe(75);
      expect(later.overdueByMinutes).toBeNull();
    });

    it("a dose before midnight takes today's early slot", () => {
      const p = atTimes(MED_A, ['00:15']);
      const [s] = calc(
        [p],
        [dose(local(2026, 3, 2, 23, 50, 0), MED_A)],
        local(2026, 3, 3, 0, 30, 0),
      );
      expect(s.overdueByMinutes).toBeNull();
      expect(s.nextScheduledAt).toEqual(local(2026, 3, 4, 0, 15, 0));
    });
  });

  describe.each([-720, -180, 0, 330, 345, 840])('time zone offset %i minutes', (offset) => {
    it('local times of day follow the offset around the clock', () => {
      const p = atTimes(MED_A, ['08:00', '20:00']);
      for (let hour = 0; hour < 24; hour += 1) {
        const now = local(2026, 3, 2, hour, 10, offset);
        const [s] = calc([p], [], now, offset);
        const localNext = new Date(s.nextScheduledAt!.getTime() + offset * 60_000);
        const clock = localNext.getUTCHours() * 60 + localNext.getUTCMinutes();
        expect([480, 1200]).toContain(clock);
        expect(s.nextScheduledAt!.getTime()).toBeGreaterThan(now.getTime());
        expect(s.nextScheduledAt!.getTime() - now.getTime()).toBeLessThanOrEqual(12 * HOUR);
        const expected =
          hour >= 8 && hour < 20 ? (hour - 8) * 60 + 10 : hour >= 20 ? (hour - 20) * 60 + 10 : null;
        expect(s.overdueByMinutes).toBe(expected);
      }
    });
  });

  describe.each([-180, 0, 540])('offset %i: a dose near a slot', (offset) => {
    it('always takes the slot within 90 minutes', () => {
      const p = atTimes(MED_A, ['08:00']);
      for (let gap = -90; gap <= 90; gap += 15) {
        const given = new Date(local(2026, 3, 2, 8, 0, offset).getTime() + gap * 60_000);
        const [s] = calc([p], [dose(given, MED_A)], local(2026, 3, 2, 10, 0, offset), offset);
        expect(s.overdueByMinutes).toBeNull();
        expect(s.nextScheduledAt).toEqual(local(2026, 3, 3, 8, 0, offset));
      }
    });
  });

  it('slots before the prescription was created are never overdue', () => {
    const p = atTimes(MED_A, ['08:00'], { createdAt: local(2026, 3, 2, 15, 0, 0) });
    const [s] = calc([p], [], local(2026, 3, 2, 16, 0, 0));
    expect(s.overdueByMinutes).toBeNull();
  });

  it('a dose naming another prescription of the same medication counts for the interval, not the slot', () => {
    const scheduled = atTimes(MED_A, ['08:00']);
    const prn = asNeeded(MED_A, 360);
    const statuses = calc(
      [scheduled, prn],
      [dose(local(2026, 3, 2, 8, 0, 0), MED_A, prn.id)],
      local(2026, 3, 2, 9, 0, 0),
    );
    const sched = statuses.find((s) => s.prescription.id === scheduled.id)!;
    expect(sched.overdueByMinutes).toBe(60);
    expect(sched.dosesLast24h).toBe(1);
    expect(statuses.find((s) => s.prescription.id === prn.id)!.availableAt).toEqual(
      local(2026, 3, 2, 14, 0, 0),
    );
  });

  it('a times-of-day group member uses the smallest interval of the other members', () => {
    const scheduled = atTimes(MED_A, ['08:00'], { group: 'colic' });
    const prn = asNeeded(MED_B, 480, { group: 'colic' });
    const statuses = calc(
      [scheduled, prn],
      [dose(local(2026, 3, 2, 7, 0, 0), MED_B)],
      local(2026, 3, 2, 9, 0, 0),
    );
    const sched = statuses.find((s) => s.prescription.id === scheduled.id)!;
    expect([sched.availableAt, sched.availableNow]).toEqual([local(2026, 3, 2, 15, 0, 0), false]);
    expect(sched.overdueByMinutes).toBe(60);
  });

  it('every N minutes: next is last dose plus period and overdue when past', () => {
    const now = new Date(Date.UTC(2026, 2, 2, 12));
    const [s] = calc([every(MED_A, 360)], [dose(new Date(now.getTime() - 7 * HOUR), MED_A)], now);
    expect([s.nextScheduledAt, s.overdueByMinutes, s.availableNow]).toEqual([
      new Date(now.getTime() - HOUR),
      60,
      true,
    ]);
  });

  it('every N minutes before the first dose has no scheduled time', () => {
    const [s] = calc([every(MED_A, 360)], [], new Date(Date.UTC(2026, 2, 2, 12)));
    expect([s.nextScheduledAt, s.overdueByMinutes, s.availableNow]).toEqual([null, null, true]);
  });

  it('the end date is the last local day', () => {
    const p = asNeeded(MED_A, 60, { start: '2026-03-01', end: '2026-03-01' });
    const now = new Date(Date.UTC(2026, 2, 2, 2));
    const [stillOn] = calc([p], [], now, SAO_PAULO);
    const [ended] = calc([p], [], now, 0);
    expect([stillOn.courseEnded, stillOn.availableNow]).toEqual([false, true]);
    expect([ended.courseEnded, ended.availableNow]).toEqual([true, false]);
  });

  it('a course that has not started is not available and schedules from the start date', () => {
    const p = atTimes(MED_A, ['08:00'], { start: '2026-03-03' });
    const [s] = calc([p], [], local(2026, 3, 2, 12, 0, 0));
    expect([s.courseStarted, s.courseEnded, s.availableNow]).toEqual([false, false, false]);
    expect(s.nextScheduledAt).toEqual(local(2026, 3, 3, 8, 0, 0));
    expect(s.overdueByMinutes).toBeNull();
  });

  it('owner example: per kg suggests from the latest weight with rounding', () => {
    const p = asNeeded(MED_A, 480, {
      dose: { amount: 1, unit: 'drops', perKg: true, roundingStep: 1 },
    });
    const weight: BodyWeight = { kg: 4.6, date: '2026-02-20' };
    const [s] = calc([p], [], local(2026, 3, 2, 12, 0, 0), 0, weight);
    expect(s.suggestedDose).toEqual({
      amount: 5,
      exactAmount: 4.6,
      unit: 'drops',
      perKgAmount: 1,
      kgUsed: 4.6,
      weightDate: '2026-02-20',
      stale: false,
      roundingStep: 1,
    });
  });

  it('per kg without a rounding step keeps the exact amount; a weight older than 30 days is stale', () => {
    const p = asNeeded(MED_A, 480, {
      dose: { amount: 0.25, unit: 'ml', perKg: true, roundingStep: null },
    });
    const [s] = calc([p], [], local(2026, 3, 2, 12, 0, 0), 0, { kg: 5.2, date: '2026-01-30' });
    expect(s.suggestedDose).toMatchObject({ amount: 1.3, exactAmount: 1.3, stale: true });
  });

  it('a fixed dose has no suggestion', () => {
    const [s] = calc([asNeeded(MED_A, 60)], [], local(2026, 3, 2, 12, 0, 0), 0, {
      kg: 5,
      date: '2026-03-01',
    });
    expect(s.suggestedDose).toBeNull();
  });

  it('stopped and deleted prescriptions have no status', () => {
    const stopped = { ...asNeeded(MED_A, 60), status: 'stopped' as const };
    const deleted = { ...asNeeded(MED_A, 60), deletedAt: '2026-01-02T00:00:00.000Z' };
    expect(calc([stopped, deleted], [], new Date(Date.UTC(2026, 2, 2, 12)))).toEqual([]);
  });

  it('rejects an offset beyond 14 hours', () => {
    expect(() =>
      calculateMedicationStatus({
        prescriptions: [],
        doses: [],
        now: new Date(),
        utcOffsetMinutes: 15 * 60,
        weight: null,
      }),
    ).toThrow(RangeError);
  });
});

describe('dosesFromEvents', () => {
  const event = (over: Partial<BabyEvent>): BabyEvent => ({
    id: 'e',
    babyId: 'b',
    typeId: 'type-med',
    startedAt: '2026-03-02T10:00:00.000Z',
    endedAt: '2026-03-02T10:00:00.000Z',
    payload: {},
    notes: null,
    createdBy: null,
    createdAt: '2026-03-02T10:00:00.000Z',
    updatedAt: '2026-03-02T10:00:00.000Z',
    deletedAt: null,
    ...over,
  });

  it('reads the entries of live medication events only', () => {
    const doses: MedicationDose[] = dosesFromEvents(
      [
        event({
          payload: {
            medications: [
              { medicationId: 'm1', name: 'A', prescriptionId: 'p1', override: true },
              { medicationId: 'm2' },
            ],
          },
        }),
        event({
          id: 'gone',
          deletedAt: '2026-03-02T11:00:00.000Z',
          payload: { medications: [{ medicationId: 'm3' }] },
        }),
        event({
          id: 'other',
          typeId: 'type-feeding',
          payload: { medications: [{ medicationId: 'm4' }] },
        }),
      ],
      new Set(['type-med']),
    );
    expect(doses).toEqual([
      {
        givenAt: Date.parse('2026-03-02T10:00:00.000Z'),
        medicationId: 'm1',
        prescriptionId: 'p1',
        override: true,
      },
      {
        givenAt: Date.parse('2026-03-02T10:00:00.000Z'),
        medicationId: 'm2',
        prescriptionId: null,
        override: false,
      },
    ]);
  });
});
