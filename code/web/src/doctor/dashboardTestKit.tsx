import { Routes } from 'react-router-dom';
import { LocationProbe } from '../test/LocationProbe';
import type { BabyRoutineDb } from '../db/database';
import type { Baby } from '../db/models';
import { fakeApi, type ApiHandler } from '../test/fakeApi';
import { renderWithDb } from '../test/renderApp';
import type { ClinicalSummaryDto, DoctorPatientDto } from './doctorApi';
import { doctorRoutes } from './doctorRoutes';
import { DOCTOR_SCOPES, type DoctorScope } from './scopes';

/*
 * Test kit of the doctor's dashboard (docs/design/19-doctor-dashboard.md): patients, the server's
 * patient cards and clinical summaries, and the dashboard routes with a probe of the current URL.
 * Synthetic data only.
 */

export const DOCTOR_USER = 'doc';

export function patientBaby(
  id: string,
  name: string,
  birthDate: string,
  doctorScopes: DoctorScope[] = [...DOCTOR_SCOPES],
): Baby {
  return { id, name, birthDate, role: 'Doctor', userId: DOCTOR_USER, doctorScopes };
}

export function patientDto(baby: Baby, extra: Partial<DoctorPatientDto> = {}): DoctorPatientDto {
  return {
    babyId: baby.id,
    name: baby.name,
    birthDate: baby.birthDate,
    doctorScopes: baby.doctorScopes ?? [...DOCTOR_SCOPES],
    lastEventAt: null,
    week: null,
    latestWeight: null,
    pendingProposals: null,
    vaccinesDue: null,
    sharedNotes: null,
    ...extra,
  };
}

/** The local `yyyy-mm-dd` days from `from` to `to`, both included. */
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  const [y, m, d] = from.split('-').map(Number);
  for (
    let day = new Date(y, m - 1, d);
    ;
    day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)
  ) {
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    if (key > to) break;
    days.push(key);
  }
  return days;
}

/** A summary with data in every section the scopes allow, for the requested range. */
export function summaryDto(
  babyId: string,
  range: { from: string; to: string },
  scopes: readonly DoctorScope[] = DOCTOR_SCOPES,
  extra: Partial<ClinicalSummaryDto> = {},
): ClinicalSummaryDto {
  const days = daysBetween(range.from, range.to);
  const has = (scope: DoctorScope) => scopes.includes(scope);
  return {
    babyId,
    ...range,
    today: range.to,
    timeZone: 'America/Sao_Paulo',
    generatedAt: new Date().toISOString(),
    scopes: [...scopes],
    sleep: has('daily_log')
      ? {
          days: days.map((date) => ({
            date,
            totalMinutes: 845,
            nightMinutes: 600,
            napMinutes: 245,
            naps: 3,
            longestMinutes: 300,
          })),
          averageTotalMinutes: 845,
          averageNightMinutes: 600,
          averageNapMinutes: 245,
          napsPerDay: 3.2,
          daysCounted: Math.max(1, days.length - 1),
          longestStretchMinutes: 342,
          longestStretchStartedAt: `${range.from}T23:10:00Z`,
          bedtimeMedian: '20:30',
          wakeMedian: '06:15',
        }
      : null,
    feeding: has('daily_log')
      ? {
          days: days.map((date) => ({
            date,
            feeds: 8,
            bottleMl: 480,
            breast: 4,
            bottle: 4,
            solid: 0,
          })),
          feedsPerDay: 8.1,
          averageIntervalMinutes: 172,
          bottleMlPerDay: 480,
          breastCount: 28,
          bottleCount: 28,
          solidCount: 0,
          formulas: [{ formulaId: 'f1', name: 'Aptamil 1', feeds: 28, ml: 3360 }],
        }
      : null,
    diapers: has('daily_log')
      ? {
          days: days.map((date) => ({ date, total: 7, wet: 6, dirty: 2 })),
          perDay: 7,
          wetPerDay: 6,
          dirtyPerDay: 2,
        }
      : null,
    symptoms: has('daily_log')
      ? {
          items: [
            {
              id: 'temp-1',
              babyId,
              typeId: 'type-temperature',
              startedAt: `${range.to}T14:05:00Z`,
              endedAt: `${range.to}T14:05:00Z`,
              payload: { value_c: 37.8 },
              notes: null,
              createdBy: 'mom',
              createdAt: `${range.to}T14:05:00Z`,
              updatedAt: `${range.to}T14:05:00Z`,
              deletedAt: null,
            },
          ],
        }
      : null,
    medications: has('medications')
      ? {
          doses: [
            {
              medicationId: 'm1',
              name: 'Vitamin D',
              count: 6,
              lastGivenAt: `${range.to}T09:00:00Z`,
            },
          ],
          activePrescriptions: [],
        }
      : null,
    vaccines: has('vaccines')
      ? {
          given: 9,
          due: 1,
          overdue: 1,
          upcoming: 12,
          dueDoses: [
            {
              doseId: 'penta-2',
              vaccineKey: 'penta',
              vaccineNames: { en: 'Pentavalent', 'pt-BR': 'Pentavalente' },
              doseLabel: { en: '2nd dose', 'pt-BR': '2ª dose' },
              state: 'overdue',
              dueOn: range.from,
            },
          ],
        }
      : null,
    growth: has('growth')
      ? {
          measurements: [
            {
              id: 'w1',
              babyId,
              date: range.from,
              weightKg: 5.42,
              heightCm: 58.5,
              headCircumferenceCm: null,
              notes: null,
              createdBy: 'mom',
              createdAt: `${range.from}T10:00:00Z`,
              updatedAt: `${range.from}T10:00:00Z`,
            },
          ],
        }
      : null,
    formulas: has('formulas')
      ? {
          current: {
            id: 'f1',
            babyId,
            name: 'Aptamil 1',
            brand: 'Danone',
            startedOn: range.from,
            isCurrent: true,
            createdAt: `${range.from}T10:00:00Z`,
            updatedAt: `${range.from}T10:00:00Z`,
          },
          history: [],
        }
      : null,
    ...extra,
  };
}

/** Seeds `babies` and renders the dashboard routes at `route` over a scripted API. */
export async function renderDashboard(
  db: BabyRoutineDb,
  route: string,
  babies: Baby[],
  handler?: ApiHandler,
) {
  await db.babies.bulkPut(babies);
  const fake = fakeApi(handler);
  const view = renderWithDb(
    db,
    <>
      <Routes>{doctorRoutes()}</Routes>
      <LocationProbe />
    </>,
    { route, api: fake.api },
  );
  return { ...fake, view };
}

/** The query parameters of the last call to a path ending with `suffix`. */
export function lastQuery(calls: readonly { path: string }[], suffix: string): URLSearchParams {
  const call = [...calls].reverse().find((c) => c.path.split('?')[0].endsWith(suffix));
  return new URL(call?.path ?? '/', 'http://test').searchParams;
}
