import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { seedSchedule } from '../test/vaccineSchedule';
import { VaccinesScreen } from './VaccinesScreen';
import { isSlug, VACCINATION_LIMITS } from './vaccinationModel';
import { groupByAge, isListed, overviewOf } from './vaccineModel';
import { isReadableSchedule } from './scheduleCache';
import type { VaccineSchedule } from './vaccineSchedule';

/*
 * The real schedule the API serves (code/api/data/vaccine-schedule.br.json, schema v2) read by the
 * web code: the shape the app relies on, labels that fit a record's dose label, and a page that
 * renders all of it.
 */

// The tests run from code/web (`npm --prefix code/web run test`).
const FILE = resolve(process.cwd(), '../api/data/vaccine-schedule.br.json');
const schedule = JSON.parse(readFileSync(FILE, 'utf8')) as VaccineSchedule;
const LANGUAGES = ['en', 'pt-BR'] as const;

describe('the real vaccine schedule', () => {
  it('is a schedule of the schema this app reads', () => {
    expect(isReadableSchedule(schedule)).toBe(true);
    expect(schedule.profile).toBe('BR');
    expect(schedule.sources.map((source) => source.id).sort()).toEqual(['pni', 'sbim', 'sbp']);
    for (const source of schedule.sources) expect(source.url).toMatch(/^https?:\/\//);
  });

  it('has names, protections and dose labels in both languages that fit a record', () => {
    for (const vaccine of schedule.vaccines) {
      expect(isSlug(vaccine.key, VACCINATION_LIMITS.vaccineKey), vaccine.key).toBe(true);
      for (const language of LANGUAGES) {
        expect(vaccine.names[language]?.trim(), `${vaccine.key} name ${language}`).toBeTruthy();
      }
    }
    for (const dose of schedule.doses) {
      expect(isSlug(dose.doseId, VACCINATION_LIMITS.doseId), dose.doseId).toBe(true);
      for (const language of LANGUAGES) {
        const label = dose.label[language] ?? '';
        expect(label.trim(), `${dose.doseId} label ${language}`).toBeTruthy();
        // The label is saved with a record, which accepts 80 characters.
        expect(label.length, `${dose.doseId} label ${language}`).toBeLessThanOrEqual(
          VACCINATION_LIMITS.doseLabel,
        );
      }
    }
  });

  it('points every dose at a known vaccine and every product at doses that exist', () => {
    const vaccines = new Set(schedule.vaccines.map((vaccine) => vaccine.key));
    const doses = new Set(schedule.doses.map((dose) => dose.doseId));
    expect(doses.size).toBe(schedule.doses.length);
    for (const dose of schedule.doses) {
      expect(vaccines.has(dose.vaccineKey), dose.doseId).toBe(true);
      for (const id of [...dose.covers, ...dose.previousDoseIds]) {
        expect(doses.has(id), `${dose.doseId} -> ${id}`).toBe(true);
      }
    }
  });

  it('gives every dose a state for a baby, and the page lists them under the right age', () => {
    const overview = overviewOf({
      schedule,
      baby: { birthDate: '2026-05-01', vaccineProfile: 'public+private' },
      records: [],
      today: '2026-10-22',
    });
    expect(overview?.views).toHaveLength(schedule.doses.filter((dose) => !dose.recordOnly).length);
    const listed = overview?.views.filter((view) => isListed(view, 'all')) ?? [];
    expect(listed.length).toBeGreaterThan(30);
    const groups = groupByAge(listed);
    expect(groups[0]?.bucket).toEqual({ kind: 'birth' });
    expect(groups.reduce((total, group) => total + group.views.length, 0)).toBe(listed.length);
  });
});

describe('the real schedule on the vaccines page', () => {
  let db: BabyRoutineDb;

  beforeEach(() => {
    db = testDatabase();
  });

  afterEach(async () => {
    await settleSync();
    await db.delete();
  });

  it('renders every listed dose with its age heading', async () => {
    await seedBaby(db);
    await db.babies.update(BABY_ID, { vaccineProfile: 'public+private' });
    await seedSchedule(db, schedule);
    const baby = { id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role: 'Owner' as const };
    renderWithDb(
      db,
      <VaccinesScreen
        baby={{ ...baby, vaccineProfile: 'public+private' }}
        initialNow={Date.parse('2026-10-22T13:00:00Z')}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'At birth', level: 3 })).toBeTruthy();
    const overview = overviewOf({
      schedule,
      baby: { ...baby, vaccineProfile: 'public+private' },
      records: [],
      today: '2026-10-22',
    });
    const listed = overview?.views.filter((view) => isListed(view, 'all')) ?? [];
    const timeline = screen.getByRole('group', { name: 'Vaccine schedule' });
    expect(within(timeline).getAllByRole('listitem')).toHaveLength(listed.length);
    expect(screen.getAllByRole('heading', { level: 3 }).length).toBeGreaterThan(8);
  }, 60_000);
});
