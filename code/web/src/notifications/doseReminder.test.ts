import { describe, expect, it } from 'vitest';
import { asNeeded, atTimes, calc, dose, MED_A } from '../medications/prescriptionFixtures';
import { reminderSlotAt } from './doseReminder';

const at = (iso: string) => new Date(iso);

describe('reminderSlotAt (from local data only)', () => {
  it('is the open slot when the dose is not logged yet', () => {
    const rx = atTimes(MED_A, ['18:00']);
    const now = at('2026-10-21T18:07:30Z');
    const [status] = calc([rx], [], now);
    expect(reminderSlotAt(status!, now)).toEqual(at('2026-10-21T18:00:00Z'));
  });

  it('is the next slot when the reminder came early (lead time up to 15 min)', () => {
    const rx = atTimes(MED_A, ['18:00']);
    const now = at('2026-10-21T17:50:00Z');
    const [status] = calc([rx], [], now);
    expect(reminderSlotAt(status!, now)).toEqual(at('2026-10-21T18:00:00Z'));
  });

  it('is nothing once the dose is logged locally', () => {
    const rx = atTimes(MED_A, ['18:00']);
    const now = at('2026-10-21T18:20:00Z');
    const [status] = calc([rx], [dose(at('2026-10-21T18:05:00Z'), MED_A, rx.id)], now);
    expect(reminderSlotAt(status!, now)).toBeNull();
  });

  it('is nothing for as-needed medicines', () => {
    const rx = asNeeded(MED_A, 480);
    const now = at('2026-10-21T18:20:00Z');
    const [status] = calc([rx], [], now);
    expect(reminderSlotAt(status!, now)).toBeNull();
  });
});
