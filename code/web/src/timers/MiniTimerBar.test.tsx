import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../AppRoutes';
import type { BabyRoutineDb } from '../db/database';
import { createEvent } from '../db/eventCommands';
import type { BabyEvent, BabyRole, EventPayload } from '../db/models';
import { fakeApi, testDatabase, BABY_ID } from '../test/fakeApi';
import { FEEDING_TYPE, SLEEP_TYPE, TUMMY_TIME_TYPE } from '../test/builtInTypes';
import { useTestLocale } from '../test/locale';
import { renderWithDb, settleSync } from '../test/renderApp';
import { nightPeriodKey } from '../theme/nightFeed';
import { NIGHT_FEED_STATE_STORAGE_KEY } from '../theme/nightFeedStorage';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import { MINUTE_MS } from '../now/eventFacts';

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await settleSync();
  vi.restoreAllMocks();
  await db.delete();
});

async function seed(role: BabyRole = 'Owner') {
  await db.babies.put({ id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role });
  await db.eventTypes.bulkPut([SLEEP_TYPE, FEEDING_TYPE, TUMMY_TIME_TYPE]);
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * MINUTE_MS).toISOString();

function start(
  type: { id: string },
  payload: EventPayload,
  startedMinutesAgo: number,
): Promise<BabyEvent> {
  return createEvent(db, {
    babyId: BABY_ID,
    typeId: type.id,
    startedAt: minutesAgo(startedMinutesAgo),
    payload,
  });
}

const renderShell = (route = '/', api = fakeApi().api) =>
  renderWithDb(db, <AppRoutes />, { route, api });

const stored = async (id: string) => (await db.events.get(id))!;

describe('the global mini timer bar', () => {
  it.each(['/', '/day', '/insights', '/settings'])(
    'floats above the navigation on %s while a timer runs',
    async (route) => {
      await seed();
      await start(SLEEP_TYPE, { kind: 'nap' }, 12);
      renderShell(route);
      const bar = await screen.findByRole('region', { name: 'Running timers' });
      expect(within(bar).getByTestId('mini-timer-elapsed').textContent).toMatch(/^1[12]:\d\d$/);
      expect(within(bar).getByRole('button', { name: 'Open the Nap timer' })).toBeTruthy();
      expect(within(bar).getByRole('button', { name: 'Pause Nap' })).toBeTruthy();
      expect(within(bar).getByRole('button', { name: 'Stop Nap' })).toBeTruthy();
      // It sits in the document before the navigation pill it floats above.
      const nav = screen.getByRole('navigation', { name: 'Main' });
      expect(bar.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    },
  );

  it('is not there without a running timer, and appears when one starts', async () => {
    await seed();
    renderShell('/day');
    await screen.findByRole('heading', { name: 'Day' });
    expect(screen.queryByRole('region', { name: 'Running timers' })).toBeNull();
    await start(SLEEP_TYPE, { kind: 'nap' }, 1);
    expect(await screen.findByRole('region', { name: 'Running timers' })).toBeTruthy();
  });

  it('keeps the page clear of the bar with a root variable and removes it when it goes', async () => {
    await seed();
    const timer = await start(SLEEP_TYPE, { kind: 'nap' }, 5);
    renderShell('/day');
    await screen.findByRole('region', { name: 'Running timers' });
    // The variable is set by a passive effect that can run just after the bar is in the document.
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--timer-bar-offset')).toMatch(/px$/),
    );
    await db.events.update(timer.id, { endedAt: new Date().toISOString() });
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Running timers' })).toBeNull(),
    );
    expect(document.documentElement.style.getPropertyValue('--timer-bar-offset')).toBe('');
  });

  it('pauses and resumes: paused_at, then paused_seconds and pause_count, announced politely', async () => {
    await seed();
    const timer = await start(SLEEP_TYPE, { kind: 'nap' }, 20);
    renderShell('/day');
    const bar = await screen.findByRole('region', { name: 'Running timers' });
    fireEvent.click(within(bar).getByRole('button', { name: 'Pause Nap' }));

    expect(await within(bar).findByRole('button', { name: 'Resume Nap' })).toBeTruthy();
    expect((await stored(timer.id)).payload.paused_at).toEqual(expect.any(String));
    expect(within(bar).getByTestId('timer-paused').textContent).toMatch(/^Paused 00:0\d$/);
    expect(await within(bar).findByText('Nap paused')).toBeTruthy();
    // The change is queued for sync like any edit (works offline).
    expect(await db.outbox.count()).toBe(2);

    fireEvent.click(within(bar).getByRole('button', { name: 'Resume Nap' }));
    expect(await within(bar).findByRole('button', { name: 'Pause Nap' })).toBeTruthy();
    const resumed = await stored(timer.id);
    expect(resumed.payload).toMatchObject({ pause_count: 1, paused_seconds: expect.any(Number) });
    expect(resumed.payload).not.toHaveProperty('paused_at');
    expect(within(bar).queryByTestId('timer-paused')).toBeNull();
    expect(await within(bar).findByText('Nap resumed')).toBeTruthy();
  });

  it('freezes the time while paused: the elapsed shown is the effective one', async () => {
    await seed();
    await start(
      SLEEP_TYPE,
      {
        kind: 'nap',
        pause_count: 1,
        paused_seconds: 600,
      },
      30,
    );
    renderShell('/day');
    const bar = await screen.findByRole('region', { name: 'Running timers' });
    // 30 minutes minus the 10 paused.
    expect(within(bar).getByTestId('mini-timer-elapsed').textContent).toMatch(/^(19|20):\d\d$/);
  });

  it('shows the main timer with a count chip and lists the others on tap', async () => {
    await seed();
    await start(TUMMY_TIME_TYPE, {}, 3);
    const nap = await start(SLEEP_TYPE, { kind: 'nap' }, 25);
    renderShell('/insights');
    const bar = await screen.findByRole('region', { name: 'Running timers' });
    // A sleep is the main timer even though it started later.
    expect(within(bar).getByRole('button', { name: 'Open the Nap timer' })).toBeTruthy();
    const chip = within(bar).getByTestId('mini-timer-count');
    expect(chip.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(chip);
    const list = await screen.findByRole('list', { name: 'All running timers' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    fireEvent.click(within(list).getByRole('button', { name: 'Pause Tummy time' }));
    await waitFor(async () => {
      const others = (await db.events.toArray()).filter((e) => e.typeId === TUMMY_TIME_TYPE.id);
      expect(others[0].payload.paused_at).toEqual(expect.any(String));
    });
    expect((await stored(nap.id)).payload).not.toHaveProperty('paused_at');
    expect(chip.getAttribute('aria-expanded')).toBe('true');
  });

  it('stops a timer through the stop flow: required fields are asked first', async () => {
    await seed();
    const feeding = await start(FEEDING_TYPE, {}, 8);
    renderShell('/day');
    const bar = await screen.findByRole('region', { name: 'Running timers' });
    fireEvent.click(within(bar).getByRole('button', { name: 'Stop Feeding' }));
    const sheet = await screen.findByRole('dialog', { name: /Finish this feeding/i });
    expect(sheet).toBeTruthy();
    // Nothing was stopped yet.
    expect((await stored(feeding.id)).endedAt).toBeNull();
  });

  it('stops a complete timer at once and offers Undo', async () => {
    await seed();
    const nap = await start(SLEEP_TYPE, { kind: 'nap' }, 8);
    renderShell('/day');
    const bar = await screen.findByRole('region', { name: 'Running timers' });
    fireEvent.click(within(bar).getByRole('button', { name: 'Stop Nap' }));
    await waitFor(async () => expect((await stored(nap.id)).endedAt).not.toBeNull());
    expect(await screen.findByText('Nap stopped')).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Running timers' })).toBeNull(),
    );
  });

  it('stopping while paused finalizes the pause (no paused_at once ended)', async () => {
    await seed();
    const nap = await start(SLEEP_TYPE, { kind: 'nap' }, 15);
    renderShell('/day');
    const bar = await screen.findByRole('region', { name: 'Running timers' });
    fireEvent.click(within(bar).getByRole('button', { name: 'Pause Nap' }));
    await within(bar).findByRole('button', { name: 'Resume Nap' });
    fireEvent.click(within(bar).getByRole('button', { name: 'Stop Nap' }));
    await waitFor(async () => expect((await stored(nap.id)).endedAt).not.toBeNull());
    const done = await stored(nap.id);
    expect(done.payload).not.toHaveProperty('paused_at');
    expect(done.payload).toMatchObject({ pause_count: 1 });
  });

  it('is hidden in the Night view, which keeps its own giant buttons', async () => {
    window.localStorage.setItem(
      NIGHT_FEED_STATE_STORAGE_KEY,
      JSON.stringify({ override: { on: true, key: nightPeriodKey(new Date()) } }),
    );
    await seed();
    await start(SLEEP_TYPE, { kind: 'night' }, 90);
    renderShell('/');
    await screen.findByRole('region', { name: 'Night view' });
    expect(screen.queryByRole('region', { name: 'Running timers' })).toBeNull();
  });

  it('lets viewers see the timer but not change it', async () => {
    await seed('Viewer');
    await start(SLEEP_TYPE, { kind: 'nap' }, 9);
    renderShell('/day');
    const bar = await screen.findByRole('region', { name: 'Running timers' });
    expect(
      (within(bar).getByRole('button', { name: 'Pause Nap' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (within(bar).getByRole('button', { name: 'Stop Nap' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('shows the quiet target of a running nap from the predictions, with its progress', async () => {
    await seed();
    const nap = await start(SLEEP_TYPE, { kind: 'nap' }, 10);
    const expectedEnd = Date.parse(nap.startedAt) + 45 * MINUTE_MS;
    const { api } = fakeApi((call) => {
      if (!call.path.includes('/predictions')) return undefined;
      return {
        babyId: BABY_ID,
        generatedAt: new Date().toISOString(),
        predictions: [
          {
            typeKey: 'sleep',
            nextStart: {
              earliest: new Date(expectedEnd + 90 * MINUTE_MS).toISOString(),
              expected: new Date(expectedEnd + 120 * MINUTE_MS).toISOString(),
              latest: new Date(expectedEnd + 150 * MINUTE_MS).toISOString(),
            },
            expectedDuration: null,
            confidence: 'Medium',
            sampleCount: 9,
            reason: 'x',
            basis: {
              kind: 'AwakeWindow',
              medianGapMinutes: 120,
              lookBackDays: 14,
              ageBand: '0-3m',
              dayPhase: 'day',
              assumesEventInProgressEnds: true,
            },
          },
        ],
        insufficientData: [],
      };
    });
    renderShell('/day', api);
    const bar = await screen.findByRole('region', { name: 'Running timers' });
    expect(await within(bar).findByText('Usual nap about 45m')).toBeTruthy();
    const progress = within(bar).getByRole('progressbar');
    expect(progress.getAttribute('aria-valuenow')).toBe('22');
    expect(progress.getAttribute('aria-label')).toMatch(/of about 45m$/);
  });

  it('shows no target when the predictions have no figure', async () => {
    await seed();
    await start(SLEEP_TYPE, { kind: 'nap' }, 10);
    renderShell('/day');
    const bar = await screen.findByRole('region', { name: 'Running timers' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(within(bar).queryByTestId('timer-target')).toBeNull();
  });
});

describe('the timer sheet', () => {
  async function openSheet(kind = 'Nap') {
    const bar = await screen.findByRole('region', { name: 'Running timers' });
    fireEvent.click(within(bar).getByRole('button', { name: `Open the ${kind} timer` }));
    return screen.findByRole('dialog', { name: kind });
  }

  it('opens from the bar with the big time, Pause, Stop and Discard', async () => {
    await seed();
    await start(SLEEP_TYPE, { kind: 'nap' }, 14);
    renderShell('/insights');
    const sheet = await openSheet();
    expect(within(sheet).getByTestId('timer-sheet-elapsed').textContent).toMatch(/^1[34]:\d\d$/);
    expect(within(sheet).getByRole('button', { name: 'Pause Nap' })).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Stop Nap' })).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Discard' })).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'More options' })).toBeTruthy();
  });

  it('pauses from the sheet and shows Paused live', async () => {
    await seed();
    const nap = await start(SLEEP_TYPE, { kind: 'nap' }, 14);
    renderShell('/day');
    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Pause Nap' }));
    expect(await within(sheet).findByRole('button', { name: 'Resume Nap' })).toBeTruthy();
    expect(within(sheet).getByTestId('timer-paused').textContent).toMatch(/^Paused 00:0\d$/);
    expect((await stored(nap.id)).payload.paused_at).toEqual(expect.any(String));
  });

  it('discards with a soft delete and an Undo snackbar', async () => {
    await seed();
    const nap = await start(SLEEP_TYPE, { kind: 'nap' }, 4);
    renderShell('/day');
    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Discard' }));
    await waitFor(async () => expect((await stored(nap.id)).deletedAt).not.toBeNull());
    expect(await screen.findByText('Nap deleted')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(async () => {
      const live = (await db.events.toArray()).filter((e) => e.deletedAt === null);
      expect(live).toHaveLength(1);
      expect(live[0].endedAt).toBeNull();
    });
  });

  it('switches a nap to night sleep from the overflow menu', async () => {
    await seed();
    const nap = await start(SLEEP_TYPE, { kind: 'nap' }, 30);
    renderShell('/day');
    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByRole('button', { name: 'More options' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Switch to night sleep' }));
    await waitFor(async () => expect((await stored(nap.id)).payload.kind).toBe('night'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'More options' }));
    expect(await screen.findByRole('menuitem', { name: 'Switch to nap' })).toBeTruthy();
  });

  it('adjusts the start time but never after now', async () => {
    await seed();
    const nap = await start(SLEEP_TYPE, { kind: 'nap' }, 5);
    renderShell('/day');
    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByRole('button', { name: 'More options' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Adjust start time' }));
    const panel = await within(sheet).findByRole('group', { name: 'Start time' });
    fireEvent.click(within(panel).getByRole('button', { name: /30 min ago/ }));
    await waitFor(async () => {
      const startedAt = Date.parse((await stored(nap.id)).startedAt);
      expect(Date.now() - startedAt).toBeGreaterThan(29 * MINUTE_MS);
      expect(Date.now() - startedAt).toBeLessThan(31 * MINUTE_MS);
    });
    expect(within(panel).getByText('When did it start? It cannot be after now.')).toBeTruthy();
  });

  it('saves a note', async () => {
    await seed();
    const nap = await start(SLEEP_TYPE, { kind: 'nap' }, 5);
    renderShell('/day');
    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByRole('button', { name: 'More options' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Add a note' }));
    const box = await within(sheet).findByRole('textbox');
    fireEvent.change(box, { target: { value: 'Teething' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    await waitFor(async () => expect((await stored(nap.id)).notes).toBe('Teething'));
  });

  it('opens the full event sheet for "Edit all details"', async () => {
    await seed();
    await start(SLEEP_TYPE, { kind: 'nap' }, 5);
    renderShell('/day');
    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByRole('button', { name: 'More options' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit all details' }));
    expect(await screen.findByRole('dialog', { name: 'Sleep' })).toBeTruthy();
  });

  it('switches the nursing side from the menu', async () => {
    await seed();
    const feed = await start(FEEDING_TYPE, { method: 'breast', side: 'left' }, 6);
    renderShell('/day');
    const sheet = await openSheet('Nursing');
    fireEvent.click(within(sheet).getByRole('button', { name: 'More options' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Switch side' }));
    await waitFor(async () => expect((await stored(feed.id)).payload.side).toBe('right'));
  });

  it('keeps the sleep details collapsed and saves a pick as soon as it is made', async () => {
    await seed();
    const nap = await start(SLEEP_TYPE, { kind: 'nap' }, 12);
    renderShell('/day');
    const sheet = await openSheet();
    const toggle = within(sheet).getByRole('button', { name: /Sleep details/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(within(sheet).queryByRole('radio', { name: 'Held' })).toBeNull();
    fireEvent.click(toggle);
    fireEvent.click(await within(sheet).findByRole('radio', { name: 'Held' }));
    await waitFor(async () => expect((await stored(nap.id)).payload.how_slept).toBe('held'));
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Woke naturally' }));
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Good' }));
    await waitFor(async () =>
      expect((await stored(nap.id)).payload).toMatchObject({
        kind: 'nap',
        how_slept: 'held',
        how_woke: 'naturally',
        mood_on_wake: 'good',
      }),
    );
    // Picking the same option again clears it.
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Held' }));
    await waitFor(async () =>
      expect((await stored(nap.id)).payload).not.toHaveProperty('how_slept'),
    );
  });

  it('saves the minutes to fall asleep as a whole number', async () => {
    await seed();
    const nap = await start(SLEEP_TYPE, { kind: 'nap' }, 12);
    renderShell('/day');
    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByRole('button', { name: /Sleep details/ }));
    fireEvent.click(await within(sheet).findByRole('button', { name: '10 min' }));
    await waitFor(async () =>
      expect((await stored(nap.id)).payload.time_to_fall_asleep_minutes).toBe(10),
    );
  });

  it('has no sleep details for a tummy time timer', async () => {
    await seed();
    await start(TUMMY_TIME_TYPE, {}, 3);
    renderShell('/day');
    const sheet = await openSheet('Tummy time');
    expect(within(sheet).queryByRole('button', { name: /Sleep details/ })).toBeNull();
  });
});

describe('in Portuguese', () => {
  it('names the bar, the buttons and the sheet in pt-BR', async () => {
    await useTestLocale('pt-BR');
    await seed();
    await start(SLEEP_TYPE, { kind: 'nap' }, 12);
    renderShell('/day');
    const bar = await screen.findByRole('region', { name: 'Cronômetros em andamento' });
    expect(within(bar).getByRole('button', { name: 'Pausar Soneca' })).toBeTruthy();
    expect(within(bar).getByRole('button', { name: 'Parar Soneca' })).toBeTruthy();
    fireEvent.click(within(bar).getByRole('button', { name: 'Abrir o cronômetro de Soneca' }));
    const sheet = await screen.findByRole('dialog', { name: 'Soneca' });
    fireEvent.click(within(sheet).getByRole('button', { name: /Detalhes do sono/ }));
    expect(await within(sheet).findByRole('radio', { name: 'No colo' })).toBeTruthy();
    expect(within(sheet).getByRole('radio', { name: 'Na cama' })).toBeTruthy();
    expect(within(sheet).getByRole('radio', { name: 'Carrinho de bebê' })).toBeTruthy();
    expect(within(sheet).getByRole('radio', { name: 'Acordou naturalmente' })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Pausar Soneca' }));
    expect(await within(sheet).findByText(/^Pausado 00:0\d$/)).toBeTruthy();
  });
});

describe('accessibility (axe)', () => {
  async function violations() {
    const result = await axe.run(document.body, {
      runOnly: ['wcag2a', 'wcag2aa'],
      rules: { 'color-contrast': { enabled: false } },
    });
    return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`);
  }

  it.each(['light', 'dark'])(
    'the bar, its list and the sheet have no violations (%s)',
    async (mode) => {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
      await seed();
      await start(TUMMY_TIME_TYPE, { pause_count: 1, paused_seconds: 90 }, 4);
      await start(SLEEP_TYPE, { kind: 'nap' }, 12);
      renderShell('/day');
      const bar = await screen.findByRole('region', { name: 'Running timers' });
      fireEvent.click(within(bar).getByTestId('mini-timer-count'));
      await screen.findByRole('list', { name: 'All running timers' });
      expect(await violations()).toEqual([]);

      fireEvent.click(within(bar).getByTestId('mini-timer-count'));
      fireEvent.click(within(bar).getByRole('button', { name: 'Open the Nap timer' }));
      const sheet = await screen.findByRole('dialog', { name: 'Nap' });
      fireEvent.click(within(sheet).getByRole('button', { name: /Sleep details/ }));
      await within(sheet).findByRole('radio', { name: 'Held' });
      fireEvent.click(within(sheet).getByRole('button', { name: 'Pause Nap' }));
      await within(sheet).findByTestId('timer-paused');
      expect(await violations()).toEqual([]);
    },
  );

  it('the night view, where the bar hides, has no violations either', async () => {
    window.localStorage.setItem(
      NIGHT_FEED_STATE_STORAGE_KEY,
      JSON.stringify({ override: { on: true, key: nightPeriodKey(new Date()) } }),
    );
    await seed();
    await start(SLEEP_TYPE, { kind: 'night' }, 60);
    renderShell('/');
    await screen.findByRole('region', { name: 'Night view' });
    expect(await violations()).toEqual([]);
  });
});
