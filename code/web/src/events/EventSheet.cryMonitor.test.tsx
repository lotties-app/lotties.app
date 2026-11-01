import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { createEvent } from '../db/eventCommands';
import type { BabyEvent } from '../db/models';
import { I18nProvider } from '../i18n/I18nProvider';
import { FEEDING_TYPE, FUSSY_TYPE } from '../test/builtInTypes';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { renderWithDb } from '../test/renderApp';
import { seedBaby } from '../test/seed';
import { AppThemeProvider } from '../theme/AppThemeProvider';
import { EventReadOnlySheet } from './EventReadOnlySheet';
import { EventSheet } from './EventSheet';

/*
 * "Detected by the cry monitor. Was she crying?" in a fussy spell's detail (docs/design/35-cry-engine.md
 * section 8): only on monitor spells, saved at once, kept by a later Save, never deleting the entry.
 */

let db: BabyRoutineDb;
const START = new Date(Date.now() - 30 * 60_000).toISOString();
const END = new Date(Date.now() - 20 * 60_000).toISOString();

beforeEach(async () => {
  db = testDatabase();
  await seedBaby(db);
  await db.eventTypes.bulkPut([FUSSY_TYPE, FEEDING_TYPE]);
});

afterEach(async () => {
  await db.delete();
});

async function spell(payload: BabyEvent['payload']) {
  return createEvent(db, {
    babyId: BABY_ID,
    typeId: FUSSY_TYPE.id,
    startedAt: START,
    endedAt: END,
    payload,
  });
}

function renderSheet(event: BabyEvent) {
  const onDone = vi.fn();
  renderWithDb(
    db,
    <EventSheet
      babyId={BABY_ID}
      types={[FUSSY_TYPE, FEEDING_TYPE]}
      event={event}
      onDone={onDone}
    />,
  );
  return onDone;
}

describe('the cry monitor answer in the fussy spell sheet', () => {
  it('asks only on a spell the monitor started', async () => {
    renderSheet(await spell({ intensity: 'mild' }));
    await screen.findByRole('dialog');
    expect(screen.queryByTestId('cry-answer')).toBeNull();
  });

  it('saves "Not crying" at once, keeps the entry, and a later Save keeps the answer', async () => {
    const event = await spell({ auto_detected: true });
    const onDone = renderSheet(event);
    const row = await screen.findByTestId('cry-answer');
    expect(within(row).getByText('Detected by the cry monitor. Was she crying?')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Not crying' }));
    await waitFor(async () =>
      expect((await db.events.get(event.id))?.payload).toEqual({
        auto_detected: true,
        cry_confirmed: false,
      }),
    );
    expect(
      within(row).getByRole('button', { name: 'Not crying' }).getAttribute('aria-pressed'),
    ).toBe('true');
    // Editing something else and saving keeps the answer and the mark.
    fireEvent.click(screen.getByRole('radio', { name: 'Mild' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const saved = await db.events.get(event.id);
    expect(saved?.payload).toMatchObject({
      auto_detected: true,
      cry_confirmed: false,
      intensity: 'mild',
    });
    expect(saved?.deletedAt).toBeNull();
  });

  it('can change the answer later', async () => {
    const event = await spell({ auto_detected: true, cry_confirmed: false });
    renderSheet(event);
    const row = await screen.findByTestId('cry-answer');
    expect(
      within(row).getByRole('button', { name: 'Not crying' }).getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.click(within(row).getByRole('button', { name: 'Yes, crying' }));
    await waitFor(async () =>
      expect((await db.events.get(event.id))?.payload.cry_confirmed).toBe(true),
    );
  });

  it('only tells a Caregiver what is known on a spell of someone else', async () => {
    const event = {
      ...(await spell({ auto_detected: true, cry_confirmed: true })),
      createdBy: 'u2',
    };
    render(
      <I18nProvider>
        <AppThemeProvider>
          <EventReadOnlySheet
            event={event}
            type={FUSSY_TYPE}
            medications={[]}
            author="Ana"
            onClose={() => undefined}
          />
        </AppThemeProvider>
      </I18nProvider>,
    );
    const row = await screen.findByTestId('cry-answer');
    expect(row.textContent).toBe('Detected by the cry monitor. You said: crying.');
    expect(within(row).queryByRole('button')).toBeNull();
  });
});
