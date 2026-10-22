import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import type { BabyRoutineDb } from '../db/database';
import type { Baby, BabyRole, Vaccination } from '../db/models';
import { BABY_ID, fakeApi, testDatabase, type ApiHandler } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { TEST_SCHEDULE, seedSchedule } from '../test/vaccineSchedule';
import { setDateField } from '../test/dateField';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import { UndoSnackbar } from '../ui/UndoSnackbar';
import { VaccinesScreen } from './VaccinesScreen';

/*
 * The vaccines page (docs/design/18-vaccines.md): the timeline grouped by age with every state, the
 * record sheet and its default dose, "Schedule it", the "About this baby" block and its save, the
 * filters, the read-only roles, the sources and the history. A baby of 82 days on 2026-10-22 and the
 * synthetic schedule of src/test/vaccineSchedule.ts.
 */

let db: BabyRoutineDb;

/** Thursday 22 October 2026, 10:00 local. */
const NOW = new Date(2026, 9, 22, 10, 0).getTime();

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await settleSync();
  await db.delete();
});

function record(id: string, doseId: string | null, extra: Partial<Vaccination> = {}): Vaccination {
  const vaccineKey = doseId
    ? (TEST_SCHEDULE.doses.find((d) => d.doseId === doseId)?.vaccineKey ?? null)
    : null;
  return {
    id,
    babyId: BABY_ID,
    vaccineKey,
    doseId,
    customName: null,
    doseLabel: null,
    givenOn: '2026-08-03',
    network: 'public',
    clinic: null,
    lot: null,
    administeredBy: null,
    notes: null,
    createdBy: 'u1',
    createdAt: '2026-08-03T12:00:00.000Z',
    updatedAt: '2026-08-03T12:00:00.000Z',
    clientUpdatedAt: '2026-08-03T12:00:00.000Z',
    deletedAt: null,
    ...extra,
  };
}

function LiveScreen() {
  const { baby } = useSelectedBaby();
  const location = useLocation();
  return (
    <>
      <p data-testid="location">{`${location.pathname}${location.hash}`}</p>
      {baby && <VaccinesScreen baby={baby} initialNow={NOW} />}
    </>
  );
}

interface RenderOptions {
  role?: BabyRole;
  records?: Vaccination[];
  baby?: Partial<Baby>;
  schedule?: boolean;
  handler?: ApiHandler;
}

async function renderScreen({
  role = 'Owner',
  records = [],
  baby = {},
  schedule = true,
  handler,
}: RenderOptions = {}) {
  await seedBaby(db, { role });
  if (Object.keys(baby).length > 0) await db.babies.update(BABY_ID, baby);
  if (schedule) await seedSchedule(db);
  await db.vaccinations.bulkPut(records);
  renderWithDb(
    db,
    <>
      <LiveScreen />
      <UndoSnackbar />
    </>,
    { api: fakeApi(handler).api },
  );
  return screen.findByRole('heading', { level: 1 });
}

const cardOf = (vaccine: string, dose: string): HTMLElement => {
  const found = screen
    .getAllByRole('listitem')
    .find(
      (item) =>
        item.tagName === 'LI' &&
        within(item).queryByText(vaccine) !== null &&
        within(item).queryByText(dose) !== null,
    );
  if (!found) throw new Error(`No card for ${vaccine}, ${dose}`);
  return found;
};

async function violations() {
  const result = await axe.run(document.body, {
    runOnly: ['wcag2a', 'wcag2aa'],
    rules: { 'color-contrast': { enabled: false } },
  });
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
}

const openRecordSheet = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Record vaccine' }));
  return screen.findByRole('dialog', { name: 'Record vaccine' });
};

const chooseVaccine = (sheet: HTMLElement, key: string) =>
  fireEvent.change(within(sheet).getByRole('combobox', { name: /^(Vaccine|Vacina)/ }), {
    target: { value: key },
  });

describe('the timeline', () => {
  it('groups the doses by recommended age and words every state', async () => {
    await renderScreen({ records: [record('r1', 'hepatite-b-1', { givenOn: '2026-08-02' })] });

    expect(await screen.findByRole('heading', { name: 'At birth', level: 3 })).toBeTruthy();
    const ages = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(ages.slice(0, 4)).toEqual(['At birth', '2 months', '4 months', '6 months']);

    // Given, overdue (with the age it is recommended at), expired and due.
    expect(within(cardOf('Hepatitis B', 'Birth dose')).getByText(/^Given on .*2026$/)).toBeTruthy();
    const bcg = cardOf('BCG', 'Single dose');
    expect(within(bcg).getByText('Overdue')).toBeTruthy();
    expect(within(bcg).getByText('Recommended at birth')).toBeTruthy();
    expect(within(bcg).getByText('Protects against severe forms of tuberculosis')).toBeTruthy();
    const penta = cardOf('Pentavalent', '1st dose');
    expect(within(penta).getByText('Due now')).toBeTruthy();
    expect(
      within(penta).getByText(
        'Protects against diphtheria, tetanus, whooping cough, Hib, and hepatitis B',
      ),
    ).toBeTruthy();
    // Ahead: soon in days, far in a date, waiting on earlier doses.
    expect(within(cardOf('Pentavalent', '2nd dose')).getByText('Due in 40 days')).toBeTruthy();
    expect(within(cardOf('Influenza (flu)', '1st dose')).getByText(/^Due on .*2027$/)).toBeTruthy();
    const yearly = cardOf('Influenza (flu)', 'Yearly dose');
    expect(within(yearly).getByText('After the earlier doses')).toBeTruthy();
    expect(within(yearly).getByText('Yearly')).toBeTruthy();
  });

  it('shows the source badges and the confirm marker on a dose flagged for review', async () => {
    await renderScreen();

    const yearly = cardOf('Influenza (flu)', 'Yearly dose');
    expect(within(yearly).getByText('PNI')).toBeTruthy();
    const marker = within(yearly).getByRole('button', {
      name: 'Confirm this with your pediatrician',
    });
    expect(marker.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(marker);
    expect(within(yearly).getByText('Notes of influenza-anual.')).toBeTruthy();
    expect(
      within(cardOf('BCG', 'Single dose')).queryByText('Confirm this with your pediatrician'),
    ).toBeNull();
  });

  it('expires a dose calmly, in words and not as an error', async () => {
    await renderScreen();

    const expired = within(cardOf('Hepatitis B', 'Birth dose')).getByText(
      'No longer in the schedule: ask your pediatrician',
    );
    expect(expired).toBeTruthy();
    expect(expired.closest('[role="alert"]')).toBeNull();
  });

  it('says which product covered a dose, and when a yearly dose comes next', async () => {
    await renderScreen({
      records: [
        record('r1', 'tetraviral-15m', { givenOn: '2026-10-10' }),
        record('r2', 'influenza-1', { givenOn: '2026-03-01' }),
        record('r3', 'influenza-anual', { givenOn: '2026-10-01' }),
      ],
      baby: { birthDate: '2025-09-01' },
    });

    expect(
      within(cardOf('MMR', '2nd dose')).getByText(/^Given on .*2026 \(with MMRV\)$/),
    ).toBeTruthy();
    const yearly = cardOf('Influenza (flu)', 'Yearly dose');
    expect(within(yearly).getByText(/^Given on .*2026$/)).toBeTruthy();
    expect(within(yearly).getByText(/^Next on .*2027$/)).toBeTruthy();
  });

  it('keeps combined products out of the timeline', async () => {
    await renderScreen();
    expect(screen.queryByText('MMRV')).toBeNull();
  });
});

describe('the filters and private recommendations', () => {
  it('lists private doses under Private with "Not in the public schedule"', async () => {
    await renderScreen();
    expect(screen.queryByText('Meningococcal B')).toBeNull();
    expect(screen.queryByText('Hexavalent, acellular')).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'Private' }));

    const card = cardOf('Meningococcal B', '1st dose');
    expect(within(card).getByText('Not in the public schedule')).toBeTruthy();
    expect(within(card).queryByText('Private clinic')).toBeNull();
    expect(screen.getByText(/Turn on private clinic recommendations above/)).toBeTruthy();
    expect(screen.queryByText('BCG')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Public (SUS)' }));
    expect(screen.queryByText('Meningococcal B')).toBeNull();
    expect(screen.getByText('BCG')).toBeTruthy();
  });

  it('shows the private doses with a Private clinic marker once the profile includes them', async () => {
    await renderScreen({ baby: { vaccineProfile: 'public+private' } });

    const card = cardOf('Meningococcal B', '1st dose');
    expect(within(card).getByText('Private clinic')).toBeTruthy();
    expect(within(card).getByText('Due in 9 days')).toBeTruthy();
    // The sources disagree on the dtp slot: both products carry the confirm marker.
    expect(
      within(cardOf('Pentavalent', '1st dose')).getByText('Confirm this with your pediatrician'),
    ).toBeTruthy();
    expect(
      within(cardOf('Hexavalent, acellular', '1st dose')).getByText(
        'Confirm this with your pediatrician',
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Private' }));
    expect(screen.queryByText(/Turn on private clinic recommendations above/)).toBeNull();
  });

  it('hides a dose when the other product of its slot was given', async () => {
    await renderScreen({
      baby: { vaccineProfile: 'public+private' },
      records: [record('r1', 'hexavalente-1', { givenOn: '2026-10-05', network: 'private' })],
    });

    expect(
      within(cardOf('Hexavalent, acellular', '1st dose')).getByText(/^Given on /),
    ).toBeTruthy();
    expect(() => cardOf('Pentavalent', '1st dose')).toThrow();
  });

  it('lists the nirsevimab dose among the private recommendations by default', async () => {
    await renderScreen({ baby: { vaccineProfile: 'public+private' } });
    expect(cardOf('RSV antibody (nirsevimab)', 'Single dose')).toBeTruthy();
  });

  it('hides the nirsevimab dose when the mother had the RSV vaccine', async () => {
    await renderScreen({
      baby: { vaccineProfile: 'public+private', rsvMaternalVaccination: 'yes' },
    });
    expect(screen.queryByText('RSV antibody (nirsevimab)')).toBeNull();
  });
});

describe('the About this baby block', () => {
  it('saves the answers with one PUT and the schedule follows', async () => {
    const handler: ApiHandler = (call) =>
      call.method === 'PUT' && call.path.endsWith('/vaccine-profile')
        ? {
            id: BABY_ID,
            name: 'Lia',
            birthDate: '2026-08-01',
            role: 'Owner',
            ...(call.body as object),
          }
        : undefined;
    const { api, calls } = (() => {
      const fake = fakeApi(handler);
      return fake;
    })();
    await seedBaby(db);
    await seedSchedule(db);
    renderWithDb(
      db,
      <>
        <LiveScreen />
      </>,
      { api },
    );
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();

    fireEvent.click(screen.getByRole('switch', { name: 'Born before 37 weeks?' }));
    const weeks = screen.getByRole('spinbutton', { name: /Weeks of pregnancy at birth/ });
    expect(weeks).toHaveProperty('value', '36');
    fireEvent.click(screen.getByRole('button', { name: 'Decrease' }));
    fireEvent.click(screen.getByRole('radio', { name: 'No' }));
    fireEvent.click(screen.getByRole('switch', { name: /Show private clinic recommendations/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(calls.find((call) => call.method === 'PUT')).toMatchObject({
        path: `/api/v1/babies/${BABY_ID}/vaccine-profile`,
        body: {
          vaccineProfile: 'public+private',
          gestationalAgeWeeks: 35,
          rsvMaternalVaccination: 'no',
        },
      }),
    );
    await waitFor(async () =>
      expect(await db.babies.get(BABY_ID)).toMatchObject({
        vaccineProfile: 'public+private',
        gestationalAgeWeeks: 35,
        rsvMaternalVaccination: 'no',
      }),
    );
    expect(
      await screen.findByText(
        "Premature babies may follow a special schedule. Follow your pediatrician's guidance.",
      ),
    ).toBeTruthy();
    expect(cardOf('Meningococcal B', '1st dose')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull());
    expect(screen.getByText('Saved')).toBeTruthy();
  });

  it('clears the weeks when the baby was not premature after all', async () => {
    const handler: ApiHandler = (call) =>
      call.method === 'PUT' && call.path.endsWith('/vaccine-profile')
        ? {
            id: BABY_ID,
            name: 'Lia',
            birthDate: '2026-08-01',
            role: 'Owner',
            ...(call.body as object),
          }
        : undefined;
    const fake = fakeApi(handler);
    await seedBaby(db);
    await db.babies.update(BABY_ID, { gestationalAgeWeeks: 33, rsvMaternalVaccination: 'unknown' });
    await seedSchedule(db);
    renderWithDb(db, <LiveScreen />, { api: fake.api });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText(/Premature babies may follow a special schedule/)).toBeTruthy();
    expect(screen.getByRole('radio', { name: "Don't know" }).getAttribute('aria-checked')).toBe(
      'true',
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Born before 37 weeks?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(fake.calls.find((call) => call.method === 'PUT')?.body).toEqual({
        vaccineProfile: 'public',
        gestationalAgeWeeks: null,
        rsvMaternalVaccination: 'unknown',
      }),
    );
    await waitFor(() =>
      expect(screen.queryByText(/Premature babies may follow a special schedule/)).toBeNull(),
    );
  });

  it('cannot be saved while offline, and says so', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    await renderScreen();

    fireEvent.click(screen.getByRole('switch', { name: /Show private clinic recommendations/ }));

    expect(screen.getByText('You are offline. Connect to the internet to do this.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveProperty('disabled', true);
  });

  it('shows the answers as text to someone who cannot change them', async () => {
    await renderScreen({
      role: 'Viewer',
      baby: {
        vaccineProfile: 'public+private',
        gestationalAgeWeeks: 34,
        rsvMaternalVaccination: 'yes',
      },
    });

    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByText('Public schedule and private clinic recommendations')).toBeTruthy();
    expect(screen.getByText('Born at 34 weeks')).toBeTruthy();
    expect(screen.getByText('RSV vaccine in pregnancy: Yes')).toBeTruthy();
  });
});

describe('recording a vaccine', () => {
  it('defaults to the next pending dose of the chosen vaccine', async () => {
    await renderScreen({ records: [record('r1', 'penta-1', { givenOn: '2026-10-01' })] });
    const sheet = await openRecordSheet();

    chooseVaccine(sheet, 'penta');

    const doses = within(sheet).getByRole('radiogroup', { name: 'Dose' });
    expect(
      within(doses)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['1st dose · already recorded', '2nd dose', 'Not in the schedule']);
    expect(
      within(doses).getByRole('radio', { name: '2nd dose' }).getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('records the chosen dose with its label, today and the public network', async () => {
    await renderScreen();
    const sheet = await openRecordSheet();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(await within(sheet).findByText('Choose the vaccine.')).toBeTruthy();

    chooseVaccine(sheet, 'penta');
    fireEvent.change(within(sheet).getByRole('textbox', { name: /^Lot number/ }), {
      target: { value: ' AB123 ' },
    });
    fireEvent.change(within(sheet).getByRole('textbox', { name: /^Clinic or health post/ }), {
      target: { value: 'UBS Centro' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const [stored] = await db.vaccinations.toArray();
    expect(stored).toMatchObject({
      vaccineKey: 'penta',
      doseId: 'penta-1',
      customName: null,
      doseLabel: '1st dose',
      givenOn: '2026-10-22',
      network: 'public',
      lot: 'AB123',
      clinic: 'UBS Centro',
      deletedAt: null,
    });
    expect((await db.outbox.toArray()).map((m) => [m.entityType, m.kind])).toEqual([
      ['vaccination', 'upsert'],
    ]);
    const penta = await waitFor(() => {
      const card = cardOf('Pentavalent', '1st dose');
      expect(within(card).getByText(/^Given on /)).toBeTruthy();
      return card;
    });
    expect(within(penta).queryByRole('button', { name: /^Record / })).toBeNull();
  });

  it('starts from the dose of the card it was opened from, and follows a private dose to Private clinic', async () => {
    await renderScreen({ baby: { vaccineProfile: 'public+private' } });

    fireEvent.click(screen.getByRole('button', { name: 'Record Meningococcal B, 1st dose' }));

    const sheet = await screen.findByRole('dialog', { name: 'Record vaccine' });
    expect(within(sheet).getByRole('combobox', { name: /^Vaccine/ })).toHaveProperty(
      'value',
      'meningo-b',
    );
    expect(
      within(sheet).getByRole('radio', { name: '1st dose' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      within(sheet).getByRole('radio', { name: 'Private clinic' }).getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('records a vaccine that is not in the schedule only with a name', async () => {
    await renderScreen();
    const sheet = await openRecordSheet();

    chooseVaccine(sheet, '__custom__');
    expect(within(sheet).queryByRole('radiogroup', { name: 'Dose' })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(
      await within(sheet).findByText('Enter the vaccine name, up to 80 characters.'),
    ).toBeTruthy();
    expect(await db.vaccinations.count()).toBe(0);

    fireEvent.change(within(sheet).getByRole('textbox', { name: /^Vaccine name/ }), {
      target: { value: ' Travel vaccine ' },
    });
    fireEvent.change(within(sheet).getByRole('textbox', { name: /^Dose/ }), {
      target: { value: '1st dose' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await db.vaccinations.toArray())[0]).toMatchObject({
      vaccineKey: null,
      doseId: null,
      customName: 'Travel vaccine',
      doseLabel: '1st dose',
    });
    const history = screen.getByRole('region', { name: 'History' });
    expect(within(history).getByText('Travel vaccine')).toBeTruthy();
  });

  it('records a dose the schedule does not list under the vaccine, without a dose', async () => {
    await renderScreen();
    const sheet = await openRecordSheet();

    chooseVaccine(sheet, 'bcg');
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Not in the schedule' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await db.vaccinations.toArray())[0]).toMatchObject({
      vaccineKey: 'bcg',
      doseId: null,
      customName: null,
    });
  });

  it('records a combined product on its own record-only dose', async () => {
    await renderScreen();
    const sheet = await openRecordSheet();

    chooseVaccine(sheet, 'tetraviral');
    expect(
      within(sheet)
        .getAllByRole('radio', { checked: true })
        .map((radio) => radio.textContent),
    ).toContain('15-month dose (2nd MMR + 1st varicella)');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await db.vaccinations.toArray())[0]).toMatchObject({
      vaccineKey: 'tetraviral',
      doseId: 'tetraviral-15m',
    });
  });

  it('refuses a date in the future', async () => {
    await renderScreen();
    const sheet = await openRecordSheet();
    chooseVaccine(sheet, 'bcg');

    await setDateField(/Date given/, '2026-12-01');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));

    expect(await within(sheet).findByText("The date can't be in the future.")).toBeTruthy();
    expect(await db.vaccinations.count()).toBe(0);
  });

  it('works without the schedule on the device: only Other vaccine', async () => {
    await renderScreen({ schedule: false });

    expect(await screen.findByText("The vaccine schedule isn't on this device yet")).toBeTruthy();
    const sheet = await openRecordSheet();
    expect(within(sheet).getByRole('combobox', { name: /^Vaccine/ })).toHaveProperty(
      'value',
      '__custom__',
    );
    expect(within(sheet).getByRole('textbox', { name: /^Vaccine name/ })).toBeTruthy();
  });
});

describe('changing records', () => {
  it('edits a recorded dose from its card', async () => {
    await renderScreen({
      records: [record('r1', 'bcg-1', { givenOn: '2026-08-03', doseLabel: 'Single dose' })],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Edit the record of BCG, Single dose' }));

    const sheet = await screen.findByRole('dialog', { name: 'Edit vaccine record' });
    expect(within(sheet).getByRole('combobox', { name: /^Vaccine/ })).toHaveProperty(
      'value',
      'bcg',
    );
    fireEvent.change(within(sheet).getByRole('textbox', { name: /^Lot number/ }), {
      target: { value: 'LOT-7' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));

    await waitFor(async () => expect((await db.vaccinations.get('r1'))?.lot).toBe('LOT-7'));
    expect(await db.vaccinations.count()).toBe(1);
    expect((await db.outbox.toArray()).map((m) => m.entityId)).toEqual(['r1']);
  });

  it('deletes a record and brings it back with Undo (as a new record)', async () => {
    await renderScreen({
      records: [record('r1', 'bcg-1', { givenOn: '2026-08-03', lot: 'LOT-1' })],
    });

    const history = screen.getByRole('region', { name: 'History' });
    fireEvent.click(within(history).getByRole('button', { name: /^Delete the record of BCG/ }));

    await waitFor(async () => expect((await db.vaccinations.get('r1'))?.deletedAt).not.toBeNull());
    expect(await screen.findByText('BCG record deleted')).toBeTruthy();
    expect(within(cardOf('BCG', 'Single dose')).getByText('Overdue')).toBeTruthy();
    expect((await db.outbox.toArray()).map((m) => m.kind)).toEqual(['delete']);

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));

    await waitFor(async () => {
      const live = (await db.vaccinations.toArray()).filter((v) => v.deletedAt === null);
      expect(live).toHaveLength(1);
      expect(live[0]).toMatchObject({ doseId: 'bcg-1', lot: 'LOT-1', givenOn: '2026-08-03' });
      expect(live[0]?.id).not.toBe('r1');
    });
    expect(within(cardOf('BCG', 'Single dose')).getByText(/^Given on /)).toBeTruthy();
  });

  it('lists the history newest first, with custom vaccines and doses the schedule dropped', async () => {
    await renderScreen({
      records: [
        record('r1', 'bcg-1', { givenOn: '2026-08-03' }),
        record('r2', null, {
          customName: 'Travel vaccine',
          givenOn: '2026-10-01',
          doseLabel: 'Booster',
        }),
        record('r3', 'penta-retired', {
          vaccineKey: 'penta',
          givenOn: '2026-09-15',
          doseLabel: 'Old 1st dose',
          network: 'private',
          clinic: 'Clínica Sul',
          lot: 'L9',
        }),
        record('r4', 'bcg-1', { givenOn: '2026-08-04', deletedAt: '2026-08-05T00:00:00.000Z' }),
      ],
    });

    const history = screen.getByRole('region', { name: 'History' });
    const rows = within(history).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Travel vaccine'),
      expect.stringContaining('Pentavalent'),
      expect.stringContaining('BCG'),
    ]);
    expect(rows[0]?.textContent).toContain('Booster');
    expect(rows[1]?.textContent).toContain('Old 1st dose');
    expect(rows[1]?.textContent).toContain('Private clinic');
    expect(rows[1]?.textContent).toContain('Clínica Sul');
    expect(rows[1]?.textContent).toContain('Lot L9');
  });

  it('says nothing is recorded yet', async () => {
    await renderScreen();
    expect(
      within(screen.getByRole('region', { name: 'History' })).getByText('Nothing recorded yet.'),
    ).toBeTruthy();
  });
});

describe('scheduling a dose', () => {
  it('opens the appointment sheet for a vaccine on the due day, and saves a vaccine appointment', async () => {
    await renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'Schedule Pentavalent, 2nd dose' }));

    const sheet = await screen.findByRole('dialog', { name: 'New appointment' });
    expect(within(sheet).getByRole('textbox', { name: /^Title/ })).toHaveProperty(
      'value',
      'Vaccine: Pentavalent',
    );
    expect(within(sheet).getByRole('radio', { name: 'Vaccine' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const [appointment] = await db.appointments.toArray();
    expect(appointment).toMatchObject({
      title: 'Vaccine: Pentavalent',
      type: 'vaccine',
      status: 'upcoming',
      // The 2nd dose is recommended on 1 December: the appointment starts that day at 09:00.
      startsAt: new Date(2026, 11, 1, 9, 0).toISOString(),
    });
    expect((await db.outbox.toArray()).map((m) => m.entityType)).toEqual(['appointment']);
  });

  it('uses today for a dose that is due now', async () => {
    await renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'Schedule Pentavalent, 1st dose' }));
    const sheet = await screen.findByRole('dialog', { name: 'New appointment' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));

    await waitFor(async () => expect(await db.appointments.count()).toBe(1));
    const [appointment] = await db.appointments.toArray();
    expect(
      appointment?.startsAt.startsWith(new Date(2026, 9, 22, 11, 0).toISOString().slice(0, 13)),
    ).toBe(true);
  });
});

describe('read-only roles', () => {
  it.each(['Caregiver', 'Viewer', 'Doctor'] as const)(
    'a %s sees everything without dead buttons',
    async (role) => {
      await renderScreen({
        role,
        records: [record('r1', 'bcg-1', { givenOn: '2026-08-03' })],
      });

      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Record vaccine' })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Record / })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Schedule / })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Delete / })).toBeNull();
      expect(screen.queryByRole('switch')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
      // They still read the schedule, the history and the sources.
      expect(within(cardOf('BCG', 'Single dose')).getByText(/^Given on /)).toBeTruthy();
      expect(
        within(screen.getByRole('region', { name: 'History' })).getAllByRole('listitem'),
      ).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'Sources' })).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Vaccination card' })).toBeTruthy();
    },
  );

  it('tells a Caregiver that only parents change the records', async () => {
    await renderScreen({ role: 'Caregiver' });
    expect(screen.getByRole('alert').textContent).toBe(
      'You can see the vaccine schedule and the records. Only parents add or change them.',
    );
  });
});

describe('the birth date', () => {
  it('asks the owner for it and opens the baby settings', async () => {
    await renderScreen({ baby: { birthDate: '' } });

    expect(await screen.findByRole('heading', { name: 'Add the birth date' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'All' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add the birth date' }));

    expect(screen.getByTestId('location').textContent).toBe('/settings#baby');
  });

  it('asks a parent to tell the owner instead of offering a dead button', async () => {
    await renderScreen({ role: 'Parent', baby: { birthDate: '' } });

    expect(await screen.findByText("Ask the baby's owner to add the birth date.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add the birth date' })).toBeNull();
  });
});

describe('the sources', () => {
  it('lists the three sources with their edition, date and link, and the informational note', async () => {
    await renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'Sources' }));

    const sheet = await screen.findByRole('dialog', { name: 'Sources' });
    expect(
      within(sheet).getByText(
        'This schedule is informational. Follow your pediatrician and your vaccination card.',
      ),
    ).toBeTruthy();
    const items = within(sheet).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toContain('PNI');
    expect(items[0]?.textContent).toContain('Ministério da Saúde');
    expect(items[0]?.textContent).toContain('Edition: 2026');
    expect(items[0]?.textContent).toMatch(/Retrieved on .*2026/);
    const link = within(items[1]!).getByRole('link', { name: 'Open the source: SBP' });
    expect(link.getAttribute('href')).toBe('https://www.sbp.com.br/?p=63971');
    expect(link.getAttribute('rel')).toContain('noopener');
  });
});

describe('opening the card', () => {
  it('links to the vaccination card', async () => {
    await renderScreen();
    expect(screen.getByRole('link', { name: 'Vaccination card' }).getAttribute('href')).toBe(
      '/vaccines/card',
    );
  });
});

describe('pt-BR', () => {
  it('reads the page, the states and the sheet in Portuguese', async () => {
    await useTestLocale('pt-BR');
    await renderScreen({ records: [record('r1', 'hepatite-b-1', { givenOn: '2026-08-02' })] });

    expect(await screen.findByRole('heading', { name: 'Vacinas', level: 1 })).toBeTruthy();
    const ages = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(ages.slice(0, 3)).toEqual(['Ao nascer', '2 meses', '4 meses']);
    expect(within(cardOf('Pentavalente', '1ª dose')).getByText('Prevista agora')).toBeTruthy();
    const bcg = cardOf('BCG', 'Dose única');
    expect(within(bcg).getByText('Em atraso')).toBeTruthy();
    expect(within(bcg).getByText('Recomendada ao nascer')).toBeTruthy();
    expect(within(cardOf('Pentavalente', '2ª dose')).getByText('Prevista em 40 dias')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Nasceu antes de 37 semanas?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fontes' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Registrar vacina' }));
    const sheet = await screen.findByRole('dialog', { name: 'Registrar vacina' });
    expect(within(sheet).getByRole('combobox', { name: /^Vacina/ })).toBeTruthy();
  });
});

describe.each(['light', 'dark'] as const)('the vaccines page in the %s scheme', (scheme) => {
  it.each(['en', 'pt-BR'] as const)(
    'has no accessibility violations in %s, with the page and the record sheet open',
    async (locale) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
      if (locale === 'pt-BR') await useTestLocale('pt-BR');
      await renderScreen({
        baby: { vaccineProfile: 'public+private', gestationalAgeWeeks: 34 },
        records: [
          record('r1', 'hepatite-b-1', { givenOn: '2026-08-02' }),
          record('r2', null, { customName: 'Travel vaccine', givenOn: '2026-10-01' }),
        ],
      });
      expect(await violations()).toEqual([]);

      fireEvent.click(
        screen.getByRole('button', {
          name: locale === 'en' ? 'Record vaccine' : 'Registrar vacina',
        }),
      );
      const sheet = await screen.findByRole('dialog', {
        name: locale === 'en' ? 'Record vaccine' : 'Registrar vacina',
      });
      chooseVaccine(sheet, 'penta');
      await act(async () => undefined);
      expect(await violations()).toEqual([]);
    },
    60_000,
  );
});
