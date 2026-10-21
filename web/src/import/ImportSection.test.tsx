import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import type { BabyRoutineDb } from '../db/database';
import type { BabyRole } from '../db/models';
import { SettingsPage } from '../pages/SettingsPage';
import type {
  NapperImportRequest,
  NapperImportResultDto,
  NapperPreviewDto,
  NapperSummaryBase,
} from '../sync/contract';
import { BABY_ID, fakeApi, httpError, testDatabase, type ApiCall } from '../test/fakeApi';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { ApiError } from '../api/ApiError';
import { ImportSection } from './ImportSection';

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await settleSync();
  vi.restoreAllMocks();
  await db.delete();
});

const PREVIEW_PATH = `/api/v1/babies/${BABY_ID}/import/napper/preview`;
const IMPORT_PATH = `/api/v1/babies/${BABY_ID}/import/napper`;
const LOGS_CSV =
  'start,end,category,comment\n2026-10-01T08:00:00-03:00,2026-10-01T08:00:00-03:00,MEDICINE,Colidis e Flagas\n';
const MEASUREMENTS_CSV =
  'dateOfMeasurement,weightKg,heightCm,headCircumferenceCm\n2026-10-01,5.2,,\n';

function summary(overrides: Partial<NapperSummaryBase> = {}): NapperSummaryBase {
  return {
    totalRows: 3,
    toCreate: 2,
    alreadyImported: 0,
    skipped: 1,
    from: '2026-10-01T11:00:00Z',
    to: '2026-10-02T11:00:00Z',
    skippedRows: [
      { row: 3, category: 'XYZ', code: 'unknown_category', reason: 'Unknown category XYZ' },
    ],
    ...overrides,
  };
}

function previewDto(overrides: Partial<NapperPreviewDto> = {}): NapperPreviewDto {
  return {
    logs: {
      ...summary(),
      categories: [
        {
          category: 'MEDICINE',
          eventTypeKey: 'medication',
          total: 2,
          toCreate: 2,
          alreadyImported: 0,
          skipped: 0,
        },
        {
          category: 'XYZ',
          eventTypeKey: null,
          total: 1,
          toCreate: 0,
          alreadyImported: 0,
          skipped: 1,
        },
      ],
    },
    measurements: null,
    medicationSuggestions: [
      {
        token: 'Colidis',
        occurrences: 2,
        suggestion: 'existing',
        medicationId: 'm-a',
        medicationName: 'Alpha tablet',
        distance: 3,
        similarTokens: ['Colidi'],
        isMapped: false,
      },
      {
        token: 'Flagas',
        occurrences: 1,
        suggestion: 'create',
        medicationId: null,
        medicationName: 'Flagas',
        distance: null,
        similarTokens: [],
        isMapped: false,
      },
    ],
    unmappedTokens: ['Colidis', 'Flagas'],
    ...overrides,
  };
}

const RESULT: NapperImportResultDto = {
  eventsCreated: 2,
  measurementsCreated: 1,
  createdMedications: [{ id: 'm-new', name: 'Flagas' }],
  logs: { ...summary(), categories: [] },
  measurements: summary({ toCreate: 1, skipped: 0, skippedRows: [] }),
};

/** Preview answers `unmappedTokens: []` once mappings are sent, like the real API. */
function defaultHandler(call: ApiCall): unknown {
  if (call.path === PREVIEW_PATH) {
    const body = call.body as NapperImportRequest;
    return body.medicationMappings ? previewDto({ unmappedTokens: [] }) : previewDto();
  }
  if (call.path === IMPORT_PATH) return RESULT;
  return undefined;
}

function Host() {
  const { baby } = useSelectedBaby();
  return baby ? <ImportSection baby={baby} /> : null;
}

async function setup(
  handler: (call: ApiCall) => unknown = defaultHandler,
  role: BabyRole = 'Parent',
) {
  await seedBaby(db, { medications: true, role });
  const fake = fakeApi(handler);
  renderWithDb(db, <Host />, { api: fake.api });
  return fake;
}

const csv = (name: string, content: string) => new File([content], name, { type: 'text/csv' });

async function pick(label: RegExp, file: File) {
  const input = (await screen.findByLabelText(label)) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

async function toReview(logs = LOGS_CSV) {
  await pick(/Choose logs CSV/, csv('logs.csv', logs));
  await screen.findByText('logs.csv (1 KB)');
  fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
  await screen.findByText('This is a preview: nothing has been saved yet.');
}

async function toMedications() {
  await toReview();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByLabelText('Action for Colidis');
}

const next = () => screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement;

describe('Napper import', () => {
  it('goes through all steps and refreshes the local data', async () => {
    const { calls, writes } = await setup();
    await pick(/Choose measurements CSV/, csv('m.csv', MEASUREMENTS_CSV));
    await pick(/Choose logs CSV/, csv('logs.csv', LOGS_CSV));
    await screen.findByText('logs.csv (1 KB)');
    expect(screen.getByText(/Importing the same file again is safe/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    await screen.findByText('This is a preview: nothing has been saved yet.');
    expect(writes()[0]).toMatchObject({
      method: 'POST',
      path: PREVIEW_PATH,
      body: { logsCsv: LOGS_CSV, measurementsCsv: MEASUREMENTS_CSV },
    });
    expect((writes()[0].body as NapperImportRequest).medicationMappings).toBeUndefined();
    expect(screen.getByText(/3 rows: 2 to create, 0 already imported, 1 skipped/)).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'MEDICINE' })).toBeTruthy();

    // Skipped rows stay collapsed until asked for.
    expect(screen.queryByText('Unknown category XYZ')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Show 1 skipped log row/ }));
    expect(screen.getByText('Unknown category XYZ')).toBeTruthy();

    fireEvent.click(next());
    await screen.findByLabelText('Action for Colidis');
    // Prefilled from the suggestions, with occurrences and similar names shown.
    expect((screen.getByLabelText('Action for Colidis') as HTMLSelectElement).value).toBe(
      'existing',
    );
    expect((screen.getByLabelText('Medication for Colidis') as HTMLSelectElement).value).toBe(
      'm-a',
    );
    expect(
      (screen.getByLabelText('New medication name for Flagas') as HTMLInputElement).value,
    ).toBe('Flagas');
    expect(screen.getByText(/Appears 2 times. Similar names: Colidi/)).toBeTruthy();
    expect(next().disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Re-check' }));
    await screen.findByText('All medication names are covered.');
    expect(writes()[1].body).toMatchObject({
      medicationMappings: [
        { token: 'Colidis', action: 'existing', medicationId: 'm-a' },
        { token: 'Flagas', action: 'create', name: 'Flagas' },
      ],
    });
    expect(next().disabled).toBe(false);

    fireEvent.click(next());
    expect(await screen.findByText(/Ready to import 2 events and 0 measurements/)).toBeTruthy();
    const before = calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    expect(await screen.findByText('Imported 2 events and 1 measurement.')).toBeTruthy();
    expect(screen.getByText(/New medications: Flagas/)).toBeTruthy();
    expect(writes()[2]).toMatchObject({ path: IMPORT_PATH, body: { logsCsv: LOGS_CSV } });
    // The sync engine was asked to pull the imported data.
    await waitFor(() =>
      expect(
        calls.slice(before).some((c) => c.method === 'GET' && c.path === '/api/v1/babies'),
      ).toBe(true),
    );
  });

  it('blocks continuing while tokens are unmapped, until re-checked again after a change', async () => {
    await setup();
    await toMedications();

    expect(screen.getByText(/2 names still need to be checked: Colidis, Flagas/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Re-check' }));
    await screen.findByText('All medication names are covered.');
    expect(next().disabled).toBe(false);

    fireEvent.change(screen.getByLabelText('Action for Flagas'), { target: { value: 'ignore' } });
    expect(next().disabled).toBe(true);
    expect(screen.getByText(/still need to be checked/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Re-check' }));
    await waitFor(() => expect(next().disabled).toBe(false));
  });

  it('does not allow re-checking a new medication without a name', async () => {
    const { writes } = await setup();
    await toMedications();
    fireEvent.change(screen.getByLabelText('New medication name for Flagas'), {
      target: { value: ' ' },
    });
    expect(await screen.findByText('Enter a name.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Re-check' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(writes()).toHaveLength(1);
  });

  it('keeps the server-reported unmapped tokens blocking after a re-check', async () => {
    await setup((call) =>
      call.path === PREVIEW_PATH
        ? previewDto({
            unmappedTokens: (call.body as NapperImportRequest).medicationMappings
              ? ['Flagas']
              : ['Colidis', 'Flagas'],
          })
        : undefined,
    );
    await toMedications();
    fireEvent.click(screen.getByRole('button', { name: 'Re-check' }));
    await screen.findByText(/1 name still needs to be checked: Flagas/);
    expect(next().disabled).toBe(true);
  });

  it('skips the mapping decision when there are no medication names', async () => {
    await setup((call) =>
      call.path === PREVIEW_PATH
        ? previewDto({ medicationSuggestions: [], unmappedTokens: [] })
        : defaultHandler(call),
    );
    await toReview();
    fireEvent.click(next());
    expect(await screen.findByText('No new medication names need a decision.')).toBeTruthy();
    expect(next().disabled).toBe(false);
  });

  it('rejects files over 5 MB on the client', async () => {
    const { writes } = await setup();
    const big = csv('big.csv', 'x');
    Object.defineProperty(big, 'size', { value: 5 * 1024 * 1024 + 1 });
    await pick(/Choose logs CSV/, big);
    expect(await screen.findByText(/big.csv is larger than 5 MB/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Preview import' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(writes()).toHaveLength(0);
  });

  it.each([
    [
      'preview 413',
      new ApiError(413, { code: 'import_file_too_large', maxBytes: 5242880, field: 'logsCsv' }),
      /too large for the server \(limit 5 MB\)/,
    ],
    [
      'preview too many rows',
      new ApiError(400, { code: 'import_too_many_rows', maxRows: 20000 }),
      /too many rows \(limit 20000\)/,
    ],
    [
      'preview invalid file',
      new ApiError(400, { code: 'import_invalid_file', field: 'logsCsv' }),
      /logsCsv file is not a valid Napper export/,
    ],
  ])('shows a friendly message for %s', async (_name, error, message) => {
    await setup((call) => {
      if (call.path === PREVIEW_PATH) throw error;
    });
    await pick(/Choose logs CSV/, csv('logs.csv', LOGS_CSV));
    await screen.findByText('logs.csv (1 KB)');
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByText('This is a preview: nothing has been saved yet.')).toBeNull();
  });

  async function toConfirm() {
    await toMedications();
    fireEvent.click(screen.getByRole('button', { name: 'Re-check' }));
    await screen.findByText('All medication names are covered.');
    fireEvent.click(next());
    await screen.findByText(/Ready to import/);
  }

  it('reports a concurrent import (409) and allows trying again', async () => {
    let failing = true;
    await setup((call) => {
      if (call.path === IMPORT_PATH && failing) throw httpError(409, 'import_conflict');
      return defaultHandler(call);
    });
    await toConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText(/Nothing was saved; try again/)).toBeTruthy();
    failing = false;
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText('Imported 2 events and 1 measurement.')).toBeTruthy();
  });

  it('returns to the medication step when the server still wants a mapping (422)', async () => {
    await setup((call) => {
      if (call.path === IMPORT_PATH) {
        throw new ApiError(422, { code: 'import_unmapped_medications', tokens: ['Flagas'] });
      }
      return defaultHandler(call);
    });
    await toConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText(/still need a decision: Flagas/)).toBeTruthy();
    expect(await screen.findByLabelText('Action for Flagas')).toBeTruthy();
    expect(next().disabled).toBe(true);
  });

  it('shows the size limit when the import answers 413', async () => {
    await setup((call) => {
      if (call.path === IMPORT_PATH) throw httpError(413);
      return defaultHandler(call);
    });
    await toConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText(/too large for the server/)).toBeTruthy();
  });

  it('shows the bad mapping token for a 422 invalid mapping', async () => {
    await setup((call) => {
      if (call.path === IMPORT_PATH) {
        throw new ApiError(422, { code: 'import_invalid_medication_mapping', token: 'Colidis' });
      }
      return defaultHandler(call);
    });
    await toConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText(/choice for "Colidis" is not valid/)).toBeTruthy();
  });

  it('sends the import only once when the button is pressed twice', async () => {
    let release: (value: NapperImportResultDto) => void = () => {};
    const pending = new Promise<NapperImportResultDto>((resolve) => (release = resolve));
    const { writes } = await setup((call) =>
      call.path === IMPORT_PATH ? pending : defaultHandler(call),
    );
    await toConfirm();

    const button = screen.getByRole('button', { name: 'Import' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(await screen.findByRole('progressbar', { name: 'Importing' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Importing…' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    release(RESULT);
    await screen.findByText('Imported 2 events and 1 measurement.');
    expect(writes().filter((c) => c.path === IMPORT_PATH)).toHaveLength(1);
  });

  it('needs a connection', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { writes } = await setup();
    expect(await screen.findByText(/You are offline/)).toBeTruthy();
    await pick(/Choose logs CSV/, csv('logs.csv', LOGS_CSV));
    await screen.findByText('logs.csv (1 KB)');
    fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
    expect((await screen.findAllByText(/You are offline/)).length).toBeGreaterThan(1);
    expect(writes()).toHaveLength(0);
  });

  it('is not available to viewers', async () => {
    await setup(defaultHandler, 'Viewer');
    expect(
      await screen.findByText('Only parents and owners can import data into this baby.'),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/Choose logs CSV/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Preview import' })).toBeNull();
  });
});

describe('Settings page import section', () => {
  it('appears for parents and hides the controls from viewers', async () => {
    await seedBaby(db, { role: 'Viewer' });
    renderWithDb(db, <SettingsPage />, { api: fakeApi().api });
    fireEvent.click(await screen.findByRole('button', { name: 'Import' }));
    expect(
      await screen.findByText('Only parents and owners can import data into this baby.'),
    ).toBeTruthy();
  });
});
