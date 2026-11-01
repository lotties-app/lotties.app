import { describe, expect, it } from 'vitest';
import { TEST_SCHEDULE } from '../test/vaccineSchedule';
import {
  ageBucketOf,
  describeStatus,
  dueNow,
  groupByAge,
  isListed,
  needsConfirmation,
  nextPendingDoseId,
  overviewOf,
  profileOf,
  type DoseView,
  type VaccineOverview,
} from './vaccineModel';

/* A baby of 82 days on 2026-10-22 and the synthetic schedule of src/test/vaccineSchedule.ts. */

const BIRTH = '2026-08-01';
const TODAY = '2026-10-22';

function overview(
  records: { id: string; doseId: string | null; givenOn: string }[] = [],
  baby: Partial<Parameters<typeof overviewOf>[0]['baby']> = {},
): VaccineOverview {
  const result = overviewOf({
    schedule: TEST_SCHEDULE,
    baby: { birthDate: BIRTH, ...baby },
    records,
    today: TODAY,
  });
  if (!result) throw new Error('expected an overview');
  return result;
}

const viewOf = (o: VaccineOverview, doseId: string): DoseView => {
  const found = o.views.find((view) => view.dose.doseId === doseId);
  if (!found) throw new Error(`no dose ${doseId}`);
  return found;
};

describe('ageBucketOf', () => {
  it('says at birth under 30 days, whole months up to 23, then years and months', () => {
    expect(ageBucketOf(0)).toEqual({ kind: 'birth' });
    expect(ageBucketOf(29)).toEqual({ kind: 'birth' });
    expect(ageBucketOf(30)).toEqual({ kind: 'months', months: 1 });
    expect(ageBucketOf(61)).toEqual({ kind: 'months', months: 2 });
    expect(ageBucketOf(183)).toEqual({ kind: 'months', months: 6 });
    expect(ageBucketOf(365)).toEqual({ kind: 'months', months: 12 });
    expect(ageBucketOf(457)).toEqual({ kind: 'months', months: 15 });
    expect(ageBucketOf(548)).toEqual({ kind: 'months', months: 18 });
    expect(ageBucketOf(730)).toEqual({ kind: 'years', years: 2, months: 0 });
    expect(ageBucketOf(1461)).toEqual({ kind: 'years', years: 4, months: 0 });
    // 5 years is 1826 days: it must not read "4 years".
    expect(ageBucketOf(1826)).toEqual({ kind: 'years', years: 5, months: 0 });
    expect(ageBucketOf(3470)).toEqual({ kind: 'years', years: 9, months: 6 });
  });
});

describe('profileOf', () => {
  it('reads a baby stored before the profile existed as the public schedule', () => {
    expect(profileOf({})).toEqual({
      coverage: 'public',
      gestationalAgeWeeks: null,
      rsvMaternalVaccination: null,
    });
    expect(
      profileOf({
        vaccineProfile: 'public+private',
        gestationalAgeWeeks: 34,
        rsvMaternalVaccination: 'no',
      }),
    ).toEqual({
      coverage: 'public+private',
      gestationalAgeWeeks: 34,
      rsvMaternalVaccination: 'no',
    });
  });
});

describe('overviewOf', () => {
  it('has no overview without a usable birth date', () => {
    for (const birthDate of ['', 'soon', '2026-13-40']) {
      expect(
        overviewOf({ schedule: TEST_SCHEDULE, baby: { birthDate }, records: [], today: TODAY }),
      ).toBeNull();
    }
  });

  it('pairs every scheduled dose with its state and leaves combined products out', () => {
    const o = overview();
    expect(o.ageDays).toBe(82);
    expect(o.views.some((view) => view.dose.recordOnly)).toBe(false);
    expect(o.views).toHaveLength(TEST_SCHEDULE.doses.filter((d) => !d.recordOnly).length);
    expect(viewOf(o, 'bcg-1').status.state).toBe('overdue');
    expect(viewOf(o, 'hepatite-b-1').status.state).toBe('expired');
    expect(viewOf(o, 'penta-1').status.state).toBe('due');
    expect(viewOf(o, 'penta-2').status.state).toBe('upcoming');
    expect(viewOf(o, 'hexavalente-1').status).toMatchObject({
      state: 'notApplicable',
      reason: 'network',
    });
  });

  it('raises the premature notice for a baby born before 37 weeks', () => {
    expect(overview().prematureNotice).toBe(false);
    expect(overview([], { gestationalAgeWeeks: 34 }).prematureNotice).toBe(true);
    expect(overview([], { gestationalAgeWeeks: 38 }).prematureNotice).toBe(false);
  });
});

describe('isListed', () => {
  it('lists public and private doses under All only once the profile shows private ones', () => {
    const publicOnly = overview();
    expect(isListed(viewOf(publicOnly, 'penta-1'), 'all')).toBe(true);
    expect(isListed(viewOf(publicOnly, 'hexavalente-1'), 'all')).toBe(false);
    expect(isListed(viewOf(publicOnly, 'meningo-b-1'), 'public')).toBe(false);
    // "Private" lists them, with the "Not in the public schedule" state.
    expect(isListed(viewOf(publicOnly, 'meningo-b-1'), 'private')).toBe(true);
    expect(isListed(viewOf(publicOnly, 'penta-1'), 'private')).toBe(false);

    const withPrivate = overview([], { vaccineProfile: 'public+private' });
    expect(isListed(viewOf(withPrivate, 'meningo-b-1'), 'all')).toBe(true);
    expect(isListed(viewOf(withPrivate, 'meningo-b-1'), 'private')).toBe(true);
    expect(isListed(viewOf(withPrivate, 'meningo-b-1'), 'public')).toBe(false);
  });

  it('hides the doses another product of the slot replaced and the ones a condition removes', () => {
    const given = overview([{ id: 'r1', doseId: 'hexavalente-1', givenOn: '2026-10-05' }], {
      vaccineProfile: 'public+private',
    });
    expect(isListed(viewOf(given, 'hexavalente-1'), 'all')).toBe(true);
    expect(viewOf(given, 'penta-1').status).toMatchObject({
      state: 'notApplicable',
      reason: 'alternative',
    });
    expect(isListed(viewOf(given, 'penta-1'), 'all')).toBe(false);
    expect(isListed(viewOf(given, 'penta-1'), 'private')).toBe(false);

    const vaccinatedMother = overview([], {
      vaccineProfile: 'public+private',
      rsvMaternalVaccination: 'yes',
    });
    expect(viewOf(vaccinatedMother, 'vsr-nirsevimabe-1').status.reason).toBe('condition');
    expect(isListed(viewOf(vaccinatedMother, 'vsr-nirsevimabe-1'), 'all')).toBe(false);
    expect(isListed(viewOf(vaccinatedMother, 'vsr-nirsevimabe-1'), 'private')).toBe(false);
  });

  it('keeps a recorded private dose listed whatever the profile', () => {
    const o = overview([{ id: 'r1', doseId: 'meningo-b-1', givenOn: '2026-09-20' }]);
    expect(viewOf(o, 'meningo-b-1').status.state).toBe('given');
    expect(isListed(viewOf(o, 'meningo-b-1'), 'all')).toBe(true);
    expect(isListed(viewOf(o, 'meningo-b-1'), 'private')).toBe(true);
    expect(isListed(viewOf(o, 'meningo-b-1'), 'public')).toBe(false);
  });
});

describe('describeStatus', () => {
  it('words each state without words: the kind and its numbers', () => {
    const o = overview([{ id: 'r1', doseId: 'bcg-1', givenOn: '2026-08-03' }]);
    expect(describeStatus(viewOf(o, 'bcg-1'), TODAY)).toEqual({
      kind: 'given',
      givenOn: '2026-08-03',
      coveredBy: null,
      nextDueOn: null,
    });
    expect(describeStatus(viewOf(o, 'penta-1'), TODAY)).toEqual({ kind: 'due' });
    expect(describeStatus(viewOf(o, 'hepatite-b-1'), TODAY)).toEqual({ kind: 'expired' });
    expect(describeStatus(viewOf(o, 'hexavalente-1'), TODAY)).toEqual({ kind: 'notInPublic' });
  });

  it('counts the days to a dose up to 60, then gives its date', () => {
    const o = overview();
    // penta-2 is recommended at 122 days: 2026-12-01, 40 days from today.
    expect(describeStatus(viewOf(o, 'penta-2'), TODAY)).toEqual({ kind: 'dueIn', days: 40 });
    // influenza-1 at 183 days: 2027-01-31, 101 days away.
    expect(describeStatus(viewOf(o, 'influenza-1'), TODAY)).toEqual({
      kind: 'dueOn',
      date: '2027-01-31',
    });
  });

  it('says overdue with the recommended age, and "after the earlier doses" for a waiting yearly dose', () => {
    const o = overview();
    expect(describeStatus(viewOf(o, 'bcg-1'), TODAY)).toEqual({
      kind: 'overdue',
      recommendedAgeDays: 0,
    });
    expect(describeStatus(viewOf(o, 'influenza-anual'), TODAY)).toEqual({ kind: 'waiting' });
  });

  it('shows the product that covered a dose and when a yearly dose comes next', () => {
    const covered = overview([{ id: 'r1', doseId: 'tetraviral-15m', givenOn: '2026-10-10' }]);
    expect(describeStatus(viewOf(covered, 'triplice-viral-2'), TODAY)).toMatchObject({
      kind: 'given',
      givenOn: '2026-10-10',
      coveredBy: 'tetraviral-15m',
    });
    const yearly = overview(
      [
        { id: 'r1', doseId: 'influenza-1', givenOn: '2026-03-01' },
        { id: 'r2', doseId: 'influenza-anual', givenOn: '2026-10-01' },
      ],
      { birthDate: '2025-09-01' },
    );
    expect(describeStatus(viewOf(yearly, 'influenza-anual'), TODAY)).toMatchObject({
      kind: 'given',
      givenOn: '2026-10-01',
      nextDueOn: '2027-10-01',
    });
  });
});

describe('dueNow', () => {
  it('lists the due and overdue doses, one per slot, the longest waiting first', () => {
    const o = overview([], { vaccineProfile: 'public+private' });
    const due = dueNow(o.views).map((view) => view.dose.doseId);
    // bcg-1 (due 2026-08-01) and rotavirus/penta/vip/pneumo (due 2026-10-01); hexavalente-1 shares
    // penta-1's slot, so only one of the two is listed.
    expect(due[0]).toBe('bcg-1');
    expect(due).toContain('penta-1');
    expect(due).not.toContain('hexavalente-1');
    expect(due).not.toContain('penta-2');
    expect(new Set(due).size).toBe(due.length);
  });

  it('is empty when nothing is due (everything recorded or still ahead)', () => {
    const o = overview(
      [
        { id: 'r1', doseId: 'bcg-1', givenOn: '2026-08-02' },
        { id: 'r2', doseId: 'penta-1', givenOn: '2026-10-01' },
        { id: 'r3', doseId: 'vip-1', givenOn: '2026-10-01' },
        { id: 'r4', doseId: 'rotavirus-1', givenOn: '2026-10-01' },
        { id: 'r5', doseId: 'pneumo-conjugada-1', givenOn: '2026-10-01' },
      ],
      { birthDate: BIRTH },
    );
    expect(dueNow(o.views)).toEqual([]);
  });
});

describe('nextPendingDoseId', () => {
  const statusesOf = (o: VaccineOverview) => o.views.map((view) => view.status);

  it('defaults to the first dose that is not given', () => {
    const none = overview();
    expect(nextPendingDoseId(TEST_SCHEDULE, statusesOf(none), 'penta')).toBe('penta-1');
    const one = overview([{ id: 'r1', doseId: 'penta-1', givenOn: '2026-10-01' }]);
    expect(nextPendingDoseId(TEST_SCHEDULE, statusesOf(one), 'penta')).toBe('penta-2');
  });

  it('skips a dose another product of its slot already satisfied', () => {
    const o = overview([{ id: 'r1', doseId: 'penta-1', givenOn: '2026-10-01' }]);
    // hexavalente-1 shares penta-1's slot; the next hexavalent dose is its second.
    expect(nextPendingDoseId(TEST_SCHEDULE, statusesOf(o), 'hexavalente')).toBe('hexavalente-2');
  });

  it('still offers the first dose of a private vaccine under the public profile', () => {
    expect(nextPendingDoseId(TEST_SCHEDULE, statusesOf(overview()), 'meningo-b')).toBe(
      'meningo-b-1',
    );
  });

  it('defaults a combined product to its first dose whose covered doses are not all given', () => {
    const open = overview([{ id: 'r1', doseId: 'triplice-viral-2', givenOn: '2026-10-10' }]);
    expect(nextPendingDoseId(TEST_SCHEDULE, statusesOf(open), 'tetraviral')).toBe('tetraviral-15m');
  });

  it('has no default for a vaccine without schedule entries', () => {
    expect(nextPendingDoseId(TEST_SCHEDULE, statusesOf(overview()), 'vop')).toBeNull();
    expect(nextPendingDoseId(TEST_SCHEDULE, statusesOf(overview()), 'unknown')).toBeNull();
  });

  it('falls back to the yearly dose when every other dose is given', () => {
    const o = overview(
      [
        { id: 'r1', doseId: 'influenza-1', givenOn: '2026-03-01' },
        { id: 'r2', doseId: 'influenza-anual', givenOn: '2026-10-01' },
      ],
      { birthDate: '2025-09-01' },
    );
    expect(nextPendingDoseId(TEST_SCHEDULE, statusesOf(o), 'influenza')).toBe('influenza-anual');
  });
});

describe('needsConfirmation', () => {
  it('marks the doses the data flags for review', () => {
    const o = overview();
    expect(needsConfirmation(viewOf(o, 'influenza-anual'), o.views, 'all')).toBe(true);
    expect(needsConfirmation(viewOf(o, 'bcg-1'), o.views, 'all')).toBe(false);
  });

  it('marks the alternatives the sources disagree on while both are listed', () => {
    const publicOnly = overview();
    // The hexavalent dose is not listed under the public profile: penta-1 has no visible rival.
    expect(needsConfirmation(viewOf(publicOnly, 'penta-1'), publicOnly.views, 'all')).toBe(false);
    const withPrivate = overview([], { vaccineProfile: 'public+private' });
    expect(needsConfirmation(viewOf(withPrivate, 'penta-1'), withPrivate.views, 'all')).toBe(true);
    // Under "Public" the rival is not listed either.
    expect(needsConfirmation(viewOf(withPrivate, 'penta-1'), withPrivate.views, 'public')).toBe(
      false,
    );
  });
});

describe('groupByAge', () => {
  it('groups doses by recommended age, youngest first', () => {
    const o = overview([], { vaccineProfile: 'public+private' });
    const groups = groupByAge(o.views);
    expect(groups[0]).toMatchObject({ bucket: { kind: 'birth' } });
    expect(groups.map((group) => group.ageDays)).toEqual(
      [...groups.map((group) => group.ageDays)].sort((a, b) => a - b),
    );
    const twoMonths = groups.find(
      (group) => group.bucket.kind === 'months' && group.bucket.months === 2,
    );
    expect(twoMonths?.views.map((view) => view.dose.doseId)).toEqual(
      expect.arrayContaining(['penta-1', 'hexavalente-1', 'vip-1', 'rotavirus-1']),
    );
    // 12 months holds the doses recommended at 365 days.
    const year = groups.find(
      (group) => group.bucket.kind === 'months' && group.bucket.months === 12,
    );
    expect(year?.views.map((view) => view.dose.doseId)).toContain('triplice-viral-1');
  });
});
