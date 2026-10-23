/*
 * What the doctor's dashboard remembers on this device (docs/design/19-doctor-dashboard.md): the
 * app mode of a user who is both a parent and a doctor, the last opened patient, the last section
 * per patient, the recently opened patients and the Patients sort. Ids only, never health data. The
 * entry belongs to the signed-in account: `clearAccountDeviceState` removes it on sign-out and when
 * another account signs in. Every read tolerates a missing, foreign or broken value.
 */

const KEY = 'baby-routine.doctor-dashboard';

/** `babies`: the parents' app; `patients`: the doctor's dashboard. */
export type AppMode = 'babies' | 'patients';

/** The sections of a patient, as URL segments (`summary` is the patient's root). */
export const PATIENT_SECTIONS = ['summary', 'timeline', 'growth', 'medications', 'notes'] as const;
export type PatientSection = (typeof PATIENT_SECTIONS)[number];

export type PatientSort = 'recent' | 'name' | 'age';
export const PATIENT_SORTS: readonly PatientSort[] = ['recent', 'name', 'age'];

/** How many recently opened patients the switcher lists. */
export const MAX_RECENTS = 5;

export interface DashboardState {
  mode: AppMode | null;
  lastPatient: string | null;
  sections: Record<string, PatientSection>;
  recents: string[];
  sort: PatientSort;
}

const EMPTY: DashboardState = {
  mode: null,
  lastPatient: null,
  sections: {},
  recents: [],
  sort: 'recent',
};

const isSection = (value: unknown): value is PatientSection =>
  typeof value === 'string' && (PATIENT_SECTIONS as readonly string[]).includes(value);

function parse(raw: string | null): DashboardState {
  if (!raw) return { ...EMPTY };
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof DashboardState, unknown>>;
    const sections: Record<string, PatientSection> = {};
    if (value.sections && typeof value.sections === 'object') {
      for (const [id, section] of Object.entries(value.sections as Record<string, unknown>)) {
        if (isSection(section)) sections[id] = section;
      }
    }
    return {
      mode: value.mode === 'babies' || value.mode === 'patients' ? value.mode : null,
      lastPatient: typeof value.lastPatient === 'string' ? value.lastPatient : null,
      sections,
      recents: Array.isArray(value.recents)
        ? value.recents.filter((id): id is string => typeof id === 'string').slice(0, MAX_RECENTS)
        : [],
      sort: PATIENT_SORTS.includes(value.sort as PatientSort)
        ? (value.sort as PatientSort)
        : 'recent',
    };
  } catch {
    return { ...EMPTY };
  }
}

export function readDashboardState(): DashboardState {
  try {
    return parse(window.localStorage.getItem(KEY));
  } catch {
    return { ...EMPTY };
  }
}

function write(state: DashboardState): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable: the dashboard just forgets after a reload.
  }
}

function update(change: (state: DashboardState) => DashboardState): DashboardState {
  const next = change(readDashboardState());
  write(next);
  return next;
}

export const readAppMode = (): AppMode | null => readDashboardState().mode;

export function writeAppMode(mode: AppMode): void {
  update((state) => ({ ...state, mode }));
}

/**
 * Records that the doctor opened `section` of `babyId`: the last patient, the last section of
 * that patient and the recents (newest first, at most `MAX_RECENTS`).
 */
export function rememberVisit(babyId: string, section: PatientSection): DashboardState {
  return update((state) => ({
    ...state,
    lastPatient: babyId,
    sections: { ...state.sections, [babyId]: section },
    recents: [babyId, ...state.recents.filter((id) => id !== babyId)].slice(0, MAX_RECENTS),
  }));
}

export const lastSectionOf = (babyId: string): PatientSection =>
  readDashboardState().sections[babyId] ?? 'summary';

export function writePatientSort(sort: PatientSort): void {
  update((state) => ({ ...state, sort }));
}

/** Drops a patient the doctor no longer follows from the remembered ids. */
export function forgetPatients(keep: ReadonlySet<string>): void {
  update((state) => ({
    ...state,
    lastPatient: state.lastPatient && keep.has(state.lastPatient) ? state.lastPatient : null,
    sections: Object.fromEntries(Object.entries(state.sections).filter(([id]) => keep.has(id))),
    recents: state.recents.filter((id) => keep.has(id)),
  }));
}

export function clearDashboardState(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable: nothing was saved.
  }
}

/** The URL of a patient section (`summary` is the patient's root). */
export function patientPath(babyId: string, section: PatientSection = 'summary'): string {
  const root = `/doctor/${encodeURIComponent(babyId)}`;
  return section === 'summary' ? root : `${root}/${section}`;
}

/** The section of a `/doctor/:babyId/...` path, `summary` for the root. */
export function sectionOfPath(pathname: string): PatientSection {
  const segment = pathname.split('/')[3] ?? '';
  return isSection(segment) ? segment : 'summary';
}
