import { describe, expect, it } from 'vitest';
import type { Appointment, Baby } from '../db/models';
import { HUB_ENTRIES, isEntryVisible, visibleEntries, type HubContext } from './hubEntries';
import { parsePrefs, pickShortcuts, type HubPrefs } from './hubUsage';
import { entryMatches, normalizeText } from './searchEntries';
import { appointmentsSoon } from './useHubAttention';

const baby = (role: Baby['role']): Baby => ({
  id: 'b1',
  name: 'Lia',
  birthDate: '2026-08-01',
  role,
});

const ctx = (role: Baby['role'] | null, extra: Partial<HubContext> = {}): HubContext => ({
  baby: role ? baby(role) : undefined,
  hasPatients: false,
  hasDoctorContent: false,
  native: false,
  installed: false,
  ...extra,
});

describe('who sees which entry', () => {
  it('shows the baby entries only with a baby', () => {
    const ids = visibleEntries(ctx(null)).map((e) => e.id);
    // Without a baby, a person can still restore a backup into a new one.
    expect(ids).toEqual([
      'settings',
      'backupImport',
      'install',
      'updates',
      'welcome',
      'about',
      'credits',
    ]);
  });

  it.each(['Owner', 'Parent', 'Caregiver', 'Viewer', 'Doctor', null] as const)(
    'shows the credits entry to every role, also native and without a baby: %s',
    (role) => {
      expect(isEntryVisible('credits', ctx(role))).toBe(true);
      expect(isEntryVisible('credits', ctx(role, { native: true }))).toBe(true);
    },
  );

  it.each(['Owner', 'Parent', 'Caregiver', 'Viewer', 'Doctor', null] as const)(
    'shows Home page to every role and Install the app until it is installed: %s',
    (role) => {
      expect(isEntryVisible('welcome', ctx(role))).toBe(true);
      expect(isEntryVisible('welcome', ctx(role, { native: true }))).toBe(true);
      expect(isEntryVisible('install', ctx(role))).toBe(true);
      expect(isEntryVisible('install', ctx(role, { installed: true }))).toBe(false);
      expect(isEntryVisible('install', ctx(role, { native: true }))).toBe(false);
    },
  );

  it.each([
    ['Owner', true],
    ['Parent', false],
    ['Caregiver', false],
    ['Viewer', false],
    ['Doctor', false],
  ] as const)('invite and doctor access for %s: %s', (role, expected) => {
    expect(isEntryVisible('invite', ctx(role))).toBe(expected);
    expect(isEntryVisible('doctorAccess', ctx(role))).toBe(expected);
  });

  it.each([
    ['Owner', true],
    ['Parent', true],
    ['Caregiver', false],
    ['Viewer', false],
    ['Doctor', false],
  ] as const)('import for %s: %s', (role, expected) => {
    expect(isEntryVisible('import', ctx(role))).toBe(expected);
  });

  it.each([
    ['Owner', true],
    ['Parent', true],
    ['Caregiver', false],
    ['Viewer', false],
    ['Doctor', false],
  ] as const)('export and import backup for %s: %s', (role, expected) => {
    expect(isEntryVisible('export', ctx(role))).toBe(expected);
    expect(isEntryVisible('backupImport', ctx(role))).toBe(expected);
  });

  it('offers a backup restore without a baby, except to a doctor who only has patients', () => {
    expect(isEntryVisible('export', ctx(null))).toBe(false);
    expect(isEntryVisible('backupImport', ctx(null))).toBe(true);
    expect(isEntryVisible('backupImport', ctx(null, { hasPatients: true }))).toBe(false);
  });

  it('keeps the appointments from the Doctor and the proposals for her only', () => {
    expect(isEntryVisible('appointments', ctx('Doctor'))).toBe(false);
    expect(isEntryVisible('appointments', ctx('Viewer'))).toBe(true);
    expect(isEntryVisible('providers', ctx('Doctor'))).toBe(false);
    expect(isEntryVisible('providers', ctx('Viewer'))).toBe(true);
    expect(isEntryVisible('providers', ctx('Owner'))).toBe(true);
    expect(isEntryVisible('myProposals', ctx('Doctor'))).toBe(true);
    expect(isEntryVisible('myProposals', ctx('Owner'))).toBe(false);
  });

  it('shows the inbox to Owners and Parents once there is a doctor', () => {
    expect(isEntryVisible('fromDoctor', ctx('Owner'))).toBe(false);
    expect(isEntryVisible('fromDoctor', ctx('Owner', { hasDoctorContent: true }))).toBe(true);
    expect(isEntryVisible('fromDoctor', ctx('Viewer', { hasDoctorContent: true }))).toBe(false);
  });

  it('shows Patients with patients, and hides updates in the native app', () => {
    expect(isEntryVisible('patients', ctx('Doctor', { hasPatients: true }))).toBe(true);
    expect(isEntryVisible('patients', ctx('Doctor'))).toBe(false);
    expect(isEntryVisible('updates', ctx('Owner', { native: true }))).toBe(false);
  });

  it('has a unique id and a route for every entry', () => {
    const ids = HUB_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(HUB_ENTRIES.every((e) => e.to.startsWith('/'))).toBe(true);
  });
});

describe('shortcut choice', () => {
  const owner = visibleEntries(ctx('Owner', { hasDoctorContent: true }));
  const none: HubPrefs = { counts: {}, pinned: null };
  const ids = (prefs: HubPrefs) => pickShortcuts(owner, prefs).map((e) => e.id);

  it('starts with the default order', () => {
    expect(ids(none)).toEqual(['vaccines', 'appointments', 'growth', 'medicines']);
  });

  it('ranks by opens, ties by default order, never the app entries', () => {
    expect(
      ids({ counts: { notes: 3, formulas: 3, about: 99, settings: 50 }, pinned: null }),
    ).toEqual(['notes', 'formulas', 'vaccines', 'appointments']);
  });

  it('keeps the pinned order and drops what is not visible', () => {
    expect(ids({ counts: {}, pinned: ['notes', 'import', 'vaccines'] })).toEqual([
      'notes',
      'vaccines',
    ]);
  });
});

describe('stored preferences', () => {
  it('reads valid data and ignores everything else', () => {
    expect(parsePrefs(null)).toEqual({ counts: {}, pinned: null });
    expect(parsePrefs('not json')).toEqual({ counts: {}, pinned: null });
    expect(parsePrefs('[1]')).toEqual({ counts: {}, pinned: null });
    expect(
      parsePrefs(
        JSON.stringify({
          counts: { notes: 2.9, vaccines: -1, bogus: 4, growth: 'x' },
          pinned: ['notes', 'bogus', 'vaccines', 'growth', 'medicines', 'formulas'],
        }),
      ),
    ).toEqual({
      counts: { notes: 2 },
      pinned: ['notes', 'vaccines', 'growth', 'medicines'],
    });
  });
});

describe('search matching', () => {
  it('ignores case and accents and matches word starts', () => {
    expect(normalizeText('  Vacínas ')).toBe('vacinas');
    expect(entryMatches('', 'anything')).toBe(true);
    expect(entryMatches('vac', 'Vaccines', 'Schedule and card')).toBe(true);
    expect(entryMatches('cines', 'Vaccines')).toBe(false);
    expect(entryMatches('vac card', 'Vaccines', 'Schedule and card')).toBe(true);
    expect(entryMatches('vac zzz', 'Vaccines', 'Schedule and card')).toBe(false);
    expect(entryMatches('MEDICO', 'Do seu médico')).toBe(true);
  });
});

describe('appointments soon', () => {
  const NOW = Date.parse('2026-10-22T10:00:00Z');
  const at = (id: string, plusDays: number, extra: Partial<Appointment> = {}): Appointment => ({
    id,
    babyId: 'b1',
    title: id,
    type: 'consultation',
    startsAt: new Date(NOW + plusDays * 86_400_000).toISOString(),
    durationMinutes: 30,
    location: null,
    doctorName: null,
    notes: null,
    outcome: null,
    status: 'upcoming',
    reminderOffsetsMinutes: [],
    createdBy: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...extra,
  });

  it('counts the upcoming ones within three days, not later, past or cancelled ones', () => {
    expect(
      appointmentsSoon(
        [at('a', 1), at('b', 2.9), at('c', 4), at('d', -2), at('e', 1, { status: 'cancelled' })],
        NOW,
      ),
    ).toBe(2);
  });
});
