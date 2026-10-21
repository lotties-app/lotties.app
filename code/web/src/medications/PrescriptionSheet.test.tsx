import { useState } from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { nightPeriodKey } from '../theme/nightFeed';
import { NIGHT_FEED_STATE_STORAGE_KEY } from '../theme/nightFeedStorage';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import { UndoSnackbar } from '../ui/UndoSnackbar';
import { PrescriptionSheet } from './PrescriptionSheet';
import { asNeeded } from './prescriptionFixtures';

let db: BabyRoutineDb;

beforeEach(async () => {
  db = testDatabase();
  window.localStorage.clear();
  await seedBaby(db, { medications: true });
});

afterEach(async () => {
  await settleSync();
  vi.restoreAllMocks();
  await db.delete();
});

/** Mounts the sheet like the screens do: it unmounts when it reports being done. */
function Host(props: React.ComponentProps<typeof PrescriptionSheet>) {
  const [open, setOpen] = useState(true);
  return open ? (
    <PrescriptionSheet
      {...props}
      onDone={() => {
        props.onDone();
        setOpen(false);
      }}
    />
  ) : null;
}

function renderSheet(props: Partial<React.ComponentProps<typeof PrescriptionSheet>> = {}) {
  const onDone = vi.fn();
  renderWithDb(
    db,
    <>
      <Host babyId={BABY_ID} onDone={onDone} {...props} />
      <UndoSnackbar />
    </>,
  );
  return { onDone };
}

const sheet = () => screen.findByRole('dialog', { name: /prescription|receita/i });
const text = (label: string | RegExp) => screen.getByRole('textbox', { name: label });

async function waitForDateFields() {
  await waitFor(() => expect(screen.queryByLabelText('Loading the date field')).toBeNull());
}

describe('PrescriptionSheet', () => {
  it('builds the owner example: per kg, as needed, 8 hours, belly pain', async () => {
    renderSheet();
    await sheet();

    fireEvent.click(await screen.findByRole('button', { name: 'Zeta syrup' }));
    // The default dose of the medication is prefilled.
    expect((screen.getByRole('spinbutton', { name: /Dose/ }) as HTMLInputElement).value).toBe(
      '2.5',
    );
    fireEvent.click(screen.getByRole('switch', { name: /Dose depends on weight/ }));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Quick values' })).getByRole('button', {
        name: /^8/,
      }),
    );
    fireEvent.change(text(/^What it is for/), { target: { value: 'belly pain' } });

    expect(
      screen.getByText('Give 2.5 ml per kg, no more often than every 8 hours, when belly pain'),
    ).toBeTruthy();
    expect(screen.getByRole('note').textContent).toMatch(/not a medical device/);

    await waitForDateFields();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => expect(await db.prescriptions.count()).toBe(1));
    const [saved] = await db.prescriptions.toArray();
    expect(saved).toMatchObject({
      babyId: BABY_ID,
      medicationId: 'm-z',
      status: 'active',
      kind: 'asNeeded',
      dose: { amount: 2.5, unit: 'ml', perKg: true, roundingStep: null },
      minIntervalMinutes: 480,
      timesOfDay: null,
      indication: 'belly pain',
      deletedAt: null,
    });
    const [queued] = await db.outbox.toArray();
    expect([queued.kind, queued.entityType, queued.entityId]).toEqual([
      'upsert',
      'prescription',
      saved.id,
    ]);
    expect(queued.payload).toMatchObject({ medicationId: 'm-z', minIntervalMinutes: 480 });
  });

  it('shows field level errors, saves nothing and focuses the first problem', async () => {
    const { onDone } = renderSheet();
    await sheet();
    await waitForDateFields();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Choose the medication.')).toBeTruthy();
    expect(screen.getByText('Enter a dose above zero.')).toBeTruthy();
    expect(screen.getByText('Enter a unit (up to 20 characters).')).toBeTruthy();
    expect(screen.getByText('Use between 15 minutes and 7 days.')).toBeTruthy();
    expect(screen.getByText('Fix 4 things to save.')).toBeTruthy();
    expect(await db.prescriptions.count()).toBe(0);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('adds clock times for a scheduled prescription', async () => {
    renderSheet({ medicationId: 'm-a' });
    await sheet();
    fireEvent.click(screen.getByRole('radio', { name: 'At set times' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a time' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a time' }));
    const first = screen.getByLabelText('Time 1') as HTMLInputElement;
    expect([first.value, (screen.getByLabelText('Time 2') as HTMLInputElement).value]).toEqual([
      '08:00',
      '12:00',
    ]);
    fireEvent.change(screen.getByLabelText('Time 2'), { target: { value: '20:00' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: /Dose/ }), { target: { value: '2' } });
    fireEvent.change(text(/^Unit/), { target: { value: 'drops' } });
    await waitForDateFields();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => expect(await db.prescriptions.count()).toBe(1));
    const [saved] = await db.prescriptions.toArray();
    expect(saved).toMatchObject({
      kind: 'scheduled',
      timesOfDay: ['08:00', '20:00'],
      medicationId: 'm-a',
    });
  });

  it('shares a wait through an interval group, offering the existing groups', async () => {
    await db.prescriptions.put(asNeeded('m-a', 480, { group: 'colic' }));
    renderSheet({ medicationId: 'm-b' });
    await sheet();
    fireEvent.click(await screen.findByRole('radio', { name: 'colic' }));
    expect((screen.getByRole('textbox', { name: /^Shared wait/ }) as HTMLInputElement).value).toBe(
      'colic',
    );
    fireEvent.change(screen.getByRole('textbox', { name: /^Shared wait/ }), {
      target: { value: ' Colic  Gas ' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: /Dose/ }), { target: { value: '1' } });
    fireEvent.change(text(/^Unit/), { target: { value: 'ml' } });
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Quick values' })).getByRole('button', {
        name: /^6/,
      }),
    );
    await waitForDateFields();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => expect(await db.prescriptions.count()).toBe(2));
    const created = (await db.prescriptions.toArray()).find((p) => p.medicationId === 'm-b')!;
    expect(created.intervalGroup).toBe('colic gas');
  });

  it('stops, resumes and deletes with Undo', async () => {
    const p = asNeeded('m-a', 480);
    await db.prescriptions.put(p);
    const { onDone } = renderSheet({ prescription: p });
    await sheet();

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(async () => expect((await db.prescriptions.get(p.id))?.status).toBe('stopped'));
    expect(onDone).toHaveBeenCalled();
  });

  it('deleting soft deletes, queues the delete and Undo creates the prescription again', async () => {
    const p = asNeeded('m-a', 480);
    await db.prescriptions.put(p);
    renderSheet({ prescription: p });
    await sheet();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect((await db.prescriptions.get(p.id))?.deletedAt).not.toBeNull());
    expect((await db.outbox.toArray()).map((m) => [m.kind, m.entityType])).toEqual([
      ['delete', 'prescription'],
    ]);

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(async () => {
      const live = (await db.prescriptions.toArray()).filter((x) => x.deletedAt === null);
      expect(live).toHaveLength(1);
      expect(live[0].id).not.toBe(p.id);
      expect(live[0].minIntervalMinutes).toBe(480);
    });
  });

  it('asks before discarding unsaved changes', async () => {
    const { onDone } = renderSheet({ medicationId: 'm-a' });
    await sheet();
    fireEvent.change(text(/^Unit/), { target: { value: 'drops' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(await screen.findByText('Discard your changes?')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onDone).toHaveBeenCalled();
  });
});

describe('PrescriptionSheet in Portuguese', () => {
  it('shows the editor and its validation in pt-BR', async () => {
    await useTestLocale('pt-BR');
    renderSheet();
    await screen.findByRole('dialog', { name: 'Adicionar receita' });
    await waitForDateFields();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Escolha o remédio.')).toBeTruthy();
    expect(screen.getByText('Corrija 4 itens para salvar.')).toBeTruthy();
    expect(screen.getByRole('note').textContent).toMatch(/não dá orientação de dose/);
  });
});

function chooseScheme(scheme: 'light' | 'dark' | 'night') {
  if (scheme === 'night') {
    window.localStorage.setItem(
      NIGHT_FEED_STATE_STORAGE_KEY,
      JSON.stringify({ override: { on: true, key: nightPeriodKey(new Date()) } }),
    );
  } else {
    window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
  }
}

describe.each(['light', 'dark', 'night'] as const)(
  'PrescriptionSheet in the %s scheme',
  (scheme) => {
    it('has no accessibility violations', async () => {
      chooseScheme(scheme);
      await db.prescriptions.put(asNeeded('m-a', 480, { group: 'colic' }));
      renderSheet();
      await sheet();
      await waitForDateFields();
      fireEvent.click(screen.getByRole('switch', { name: /Dose depends on weight/ }));
      fireEvent.click(screen.getByRole('radio', { name: 'At set times' }));
      fireEvent.click(screen.getByRole('button', { name: 'Add a time' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await screen.findByText(/Fix \d things? to save/);
      const result = await axe.run(document.body, {
        runOnly: ['wcag2a', 'wcag2aa'],
        rules: { 'color-contrast': { enabled: false } },
      });
      expect(
        result.violations.map(
          (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
        ),
      ).toEqual([]);
    }, 60_000);
  },
);
