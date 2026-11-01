import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Baby } from '../db/models';
import { familyBabies, hasBothModes, isDoctorOnly, landsOnDashboard } from './appMode';
import { clinicalAge, monthsAndDays } from './clinicalAge';
import {
  clearDashboardState,
  forgetPatients,
  lastSectionOf,
  MAX_RECENTS,
  patientPath,
  readDashboardState,
  rememberVisit,
  sectionOfPath,
  writeAppMode,
  writePatientSort,
} from './dashboardStorage';
import type { DoctorPatient } from './doctorApi';
import { activeNavKey, neighbours, patientIdOfPath } from './navModel';
import { quietDays } from './patientCards';
import {
  DEFAULT_DOCTOR_SCOPES,
  DOCTOR_SCOPES,
  hasScope,
  parseScopes,
  revokedScopes,
  sameScopes,
  scopesOf,
} from './scopes';
import { matchesName, sortPatients } from './useDoctorData';

/* The doctor dashboard's pure rules (docs/design/19-doctor-dashboard.md). */

const baby = (id: string, role: Baby['role'], extra: Partial<Baby> = {}): Baby => ({
  id,
  name: id,
  birthDate: '2026-08-01',
  role,
  ...extra,
});

const patient = (babyId: string, extra: Partial<DoctorPatient> = {}): DoctorPatient => ({
  babyId,
  name: babyId,
  birthDate: '2026-08-01',
  scopes: [...DOCTOR_SCOPES],
  lastEventAt: null,
  week: null,
  latestWeight: null,
  pendingProposals: null,
  vaccinesDue: null,
  sharedNotes: null,
  ...extra,
});

beforeEach(() => window.localStorage.clear());
afterEach(() => window.localStorage.clear());

describe('doctor scopes', () => {
  it('reads the server list in canonical order, drops unknown codes and defaults to all six', () => {
    expect(parseScopes(['notes', 'growth', 'notes', 'x-ray', 7])).toEqual(['growth', 'notes']);
    expect(parseScopes([])).toEqual([]);
    expect(parseScopes(null)).toEqual([...DEFAULT_DOCTOR_SCOPES]);
    expect(parseScopes(undefined)).toEqual(DOCTOR_SCOPES);
  });

  it('applies only to a Doctor: every other role sees every section', () => {
    expect(scopesOf(baby('a', 'Owner', { doctorScopes: [] }))).toEqual(DOCTOR_SCOPES);
    expect(scopesOf(baby('a', 'Viewer'))).toEqual(DOCTOR_SCOPES);
    expect(scopesOf(baby('a', 'Doctor'))).toEqual(DOCTOR_SCOPES);
    expect(scopesOf(baby('a', 'Doctor', { doctorScopes: ['growth'] }))).toEqual(['growth']);
    expect(hasScope(baby('a', 'Doctor', { doctorScopes: ['growth'] }), 'notes')).toBe(false);
    expect(hasScope(baby('a', 'Caregiver', { doctorScopes: ['growth'] }), 'notes')).toBe(true);
  });

  it('tells what was revoked and compares sets', () => {
    expect(revokedScopes(['daily_log', 'notes', 'growth'], ['growth'])).toEqual([
      'daily_log',
      'notes',
    ]);
    expect(sameScopes(['growth', 'notes'], ['notes', 'growth'])).toBe(true);
    expect(sameScopes(['growth'], ['growth', 'notes'])).toBe(false);
  });
});

describe('app mode', () => {
  const family = baby('mine', 'Owner');
  const patientBaby = baby('patient', 'Doctor');

  it('keeps patients out of the parents app and sends a doctor-only user to the dashboard', () => {
    expect(familyBabies([family, patientBaby])).toEqual([family]);
    expect(isDoctorOnly([patientBaby])).toBe(true);
    expect(isDoctorOnly([patientBaby, family])).toBe(false);
    expect(isDoctorOnly([])).toBe(false);
    expect(landsOnDashboard([patientBaby], null)).toBe(true);
    expect(landsOnDashboard([patientBaby], 'babies')).toBe(true);
  });

  it('lets a parent who is also a doctor choose, and remembers it on the device', () => {
    expect(hasBothModes([family, patientBaby])).toBe(true);
    expect(hasBothModes([family])).toBe(false);
    expect(landsOnDashboard([family, patientBaby], null)).toBe(false);
    writeAppMode('patients');
    expect(landsOnDashboard([family, patientBaby], readDashboardState().mode)).toBe(true);
    writeAppMode('babies');
    expect(landsOnDashboard([family, patientBaby], readDashboardState().mode)).toBe(false);
    expect(landsOnDashboard([family], 'patients')).toBe(false);
  });
});

describe('dashboard memory', () => {
  it('remembers the last patient, the last section of each and up to five recents', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) rememberVisit(id, 'summary');
    rememberVisit('c', 'growth');
    const state = readDashboardState();
    expect(state.lastPatient).toBe('c');
    expect(state.recents).toEqual(['c', 'f', 'e', 'd', 'b']);
    expect(state.recents).toHaveLength(MAX_RECENTS);
    expect(lastSectionOf('c')).toBe('growth');
    expect(lastSectionOf('unknown')).toBe('summary');
  });

  it('forgets patients the doctor no longer follows', () => {
    rememberVisit('a', 'notes');
    rememberVisit('b', 'timeline');
    forgetPatients(new Set(['a']));
    const state = readDashboardState();
    expect(state.lastPatient).toBeNull();
    expect(state.recents).toEqual(['a']);
    expect(state.sections).toEqual({ a: 'notes' });
  });

  it('survives a broken or foreign value and is cleared with the account', () => {
    window.localStorage.setItem(
      'baby-routine.doctor-dashboard',
      '{"mode":"x","sort":"weight","recents":[1,"a"],"sections":{"a":"labs","b":"growth"}}',
    );
    expect(readDashboardState()).toEqual({
      mode: null,
      lastPatient: null,
      sections: { b: 'growth' },
      recents: ['a'],
      sort: 'recent',
    });
    window.localStorage.setItem('baby-routine.doctor-dashboard', 'not json');
    expect(readDashboardState().recents).toEqual([]);
    writePatientSort('age');
    expect(readDashboardState().sort).toBe('age');
    clearDashboardState();
    expect(readDashboardState().sort).toBe('recent');
  });

  it('builds and reads the patient URLs', () => {
    expect(patientPath('lia')).toBe('/doctor/lia');
    expect(patientPath('lia', 'growth')).toBe('/doctor/lia/growth');
    expect(sectionOfPath('/doctor/lia')).toBe('summary');
    expect(sectionOfPath('/doctor/lia/notes')).toBe('notes');
    expect(sectionOfPath('/doctor/lia/unknown')).toBe('summary');
    expect(patientIdOfPath('/doctor/lia/notes')).toBe('lia');
    expect(patientIdOfPath('/doctor')).toBeNull();
    expect(patientIdOfPath('/doctor/settings')).toBeNull();
    expect(activeNavKey('/doctor')).toBe('patients');
    expect(activeNavKey('/doctor/lia/timeline')).toBe('timeline');
    expect(activeNavKey('/doctor/settings')).toBeNull();
    // Her own pages are not patient ids.
    for (const page of ['credits', 'privacy']) {
      expect(patientIdOfPath(`/doctor/${page}`)).toBeNull();
      expect(activeNavKey(`/doctor/${page}`)).toBeNull();
    }
    expect(activeNavKey('/day')).toBeNull();
  });
});

describe('patients order and search', () => {
  const lia = patient('lia', {
    name: 'Lia',
    birthDate: '2026-08-01',
    lastEventAt: '2026-10-20T10:00:00Z',
  });
  const theo = patient('theo', { name: 'Théo', birthDate: '2026-04-01', lastEventAt: null });
  const ana = patient('ana', {
    name: 'Ana',
    birthDate: '2025-12-01',
    lastEventAt: '2026-10-21T08:00:00Z',
  });

  it('sorts by latest activity (none last), by name or youngest first', () => {
    const ids = (list: DoctorPatient[]) => list.map((p) => p.babyId);
    expect(ids(sortPatients([lia, theo, ana], 'recent'))).toEqual(['ana', 'lia', 'theo']);
    expect(ids(sortPatients([lia, theo, ana], 'name'))).toEqual(['ana', 'lia', 'theo']);
    expect(ids(sortPatients([lia, theo, ana], 'age'))).toEqual(['lia', 'theo', 'ana']);
  });

  it('finds names whatever the case and accents', () => {
    expect(matchesName('Théo', 'theo')).toBe(true);
    expect(matchesName('Théo', ' THÉ ')).toBe(true);
    expect(matchesName('Lia', 'theo')).toBe(false);
  });

  it('moves to the previous and next patient, wrapping around', () => {
    const order = [ana, lia, theo];
    expect(neighbours(order, 'ana')).toMatchObject({ previous: theo, next: lia, index: 0 });
    expect(neighbours(order, 'theo')).toMatchObject({ previous: lia, next: ana, index: 2 });
    expect(neighbours([lia], 'lia')).toBeNull();
    expect(neighbours(order, 'gone')).toBeNull();
  });
});

describe('patient cards', () => {
  const now = Date.parse('2026-10-22T12:00:00Z');

  it('flags a patient quiet for three days or more (rounded like the last log line)', () => {
    expect(quietDays(null, now)).toBeNull();
    expect(quietDays('2026-10-20T13:00:00Z', now)).toBeNull();
    expect(quietDays('2026-10-20T01:00:00Z', now)).toBeNull();
    expect(quietDays('2026-10-19T11:00:00Z', now)).toBe(3);
    expect(quietDays('2026-10-18T11:00:00Z', now)).toBe(4);
  });

  it('gives the age in months and days', () => {
    expect(monthsAndDays('2026-08-20', new Date(2026, 9, 22))).toEqual({ months: 2, days: 2 });
    expect(monthsAndDays('2026-01-31', new Date(2026, 2, 1))).toEqual({ months: 1, days: 1 });
    expect(monthsAndDays('2026-10-10', new Date(2026, 9, 22))).toEqual({ months: 0, days: 12 });
    expect(clinicalAge('2026-08-20', new Date(2026, 9, 22), 'en')).toBe('2 months, 2 days');
    expect(clinicalAge('2026-08-22', new Date(2026, 9, 22), 'en')).toBe('2 months');
    expect(clinicalAge('2026-10-21', new Date(2026, 9, 22), 'en')).toBe('1 day');
    expect(clinicalAge('2026-12-01', new Date(2026, 9, 22), 'en')).toBe('0 days');
  });
});
