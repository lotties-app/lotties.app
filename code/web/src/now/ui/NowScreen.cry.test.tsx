import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../../db/database';
import type { Baby, BabyEvent, BabyRole } from '../../db/models';
import { BELLY_MASSAGE_TYPE, FUSSY_TYPE } from '../../test/builtInTypes';
import { BABY_ID, fakeApi, networkError, testDatabase } from '../../test/fakeApi';
import { useTestLocale } from '../../test/locale';
import { renderWithDb, settleSync } from '../../test/renderApp';
import { nightPeriodKey } from '../../theme/nightFeed';
import { NIGHT_FEED_STATE_STORAGE_KEY } from '../../theme/nightFeedStorage';
import { THEME_STORAGE_KEY } from '../../theme/themeStorage';
import { rankCryReasons } from '../cryReasons';
import {
  BABY,
  NOW_TYPES,
  holdToast,
  minutesAgo,
  nowApi,
  pinClock,
  putEvent,
  seedMorning,
  seedNow,
} from './nowKit';
import { NowScreen } from './NowScreen';

/*
 * "Why is she crying?" on Now (docs/design/27-cry-reasons.md section 9): the quiet entry, the sheet
 * (red flags always, the ranked causes with their facts, tries, hints and shortcuts, "What worked?"
 * and the disclaimer), the spell it logs, and who sees it.
 */

const TYPES = [...NOW_TYPES, FUSSY_TYPE, BELLY_MASSAGE_TYPE];
const ENTRY = 'Why is she crying?';
/** Writes and live queries can take a while when the whole suite runs in parallel. */
const SLOW = { timeout: 5000 };
const CAUSE_NAMES = ['Hunger', 'Sleepiness', 'Diaper', 'Gas', 'Comfort'];

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await settleSync();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'wakeLock');
  await db.delete();
});

function renderNow(options: { baby?: Baby; offline?: boolean } = {}) {
  const handler = options.offline
    ? () => {
        throw networkError();
      }
    : nowApi();
  const { api } = fakeApi(handler);
  return renderWithDb(db, <NowScreen baby={options.baby ?? BABY} />, { api });
}

async function seed(role: BabyRole = 'Owner') {
  await seedNow(db, { types: TYPES, role });
  await seedMorning(db, 112);
}

/** A fussy spell started `startAgo` minutes ago (running when `endAgo` is null). */
async function putFussy(
  startAgo: number,
  endAgo: number | null,
  payload: BabyEvent['payload'] = {},
): Promise<BabyEvent> {
  const startedAt = minutesAgo(startAgo);
  const event: BabyEvent = {
    id: `fussy-${startAgo}`,
    babyId: BABY_ID,
    typeId: FUSSY_TYPE.id,
    startedAt,
    endedAt: endAgo === null ? null : minutesAgo(endAgo),
    payload,
    notes: null,
    createdBy: null,
    createdAt: startedAt,
    updatedAt: startedAt,
    deletedAt: null,
  };
  await db.events.put(event);
  return event;
}

const live = async () => (await db.events.toArray()).filter((e) => e.deletedAt === null);
const fussySpells = async () => (await live()).filter((e) => e.typeId === FUSSY_TYPE.id);

async function openSheet(name = ENTRY) {
  const entry = await screen.findByRole('button', { name });
  entry.focus();
  fireEvent.click(entry);
  const sheet = await screen.findByRole('dialog', { name });
  return { entry, sheet };
}

const cards = (sheet: HTMLElement) => within(sheet).getAllByRole('listitem').filter(isCause);
const isCause = (item: HTMLElement) => item.dataset.testid?.startsWith('cry-cause-') === true;
const card = (sheet: HTMLElement, cause: string) => within(sheet).getByTestId(`cry-cause-${cause}`);

describe('"Why is she crying?" on Now', () => {
  it('is a quiet button under Quick log that opens the sheet with the red flags first', async () => {
    pinClock(14, 0);
    await seed();
    renderNow();

    const { sheet } = await openSheet();
    const banner = within(sheet).getByRole('region', { name: 'When to call for help' });
    expect(
      within(banner).getByText('Call your pediatrician or emergency services if she has:'),
    ).toBeTruthy();
    expect(
      within(banner)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'A fever. Babies under 3 months with a fever need a call right away.',
      'Crying that you cannot soothe',
      'Refusing feeds',
      'Unusual sleepiness, or is hard to wake',
      'A bulging or stiff soft spot on the head',
    ]);
    // The banner comes before the list.
    const list = within(sheet).getByRole('heading', { name: 'What your log suggests' });
    expect(banner.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      within(sheet).getByText(
        'This list only uses what you have logged. It is not a diagnosis or medical advice, and Lotties is not a medical device.',
      ),
    ).toBeTruthy();
  });

  it('lists the five causes in the order of the ranking, with level, facts and what to try', async () => {
    pinClock(14, 0);
    await seed();
    renderNow();

    const { sheet } = await openSheet();
    const expected = rankCryReasons({
      events: await db.events.toArray(),
      types: TYPES,
      now: new Date(),
      birthDate: BABY.birthDate,
      predictions: null,
    }).causes.map((c) => `cry-cause-${c.cause}`);
    const shown = cards(sheet);
    expect(shown.map((item) => item.dataset.testid)).toEqual(expected);
    for (const item of shown) {
      expect(within(item).getByRole('heading').textContent).toMatch(
        new RegExp(`^(${CAUSE_NAMES.join('|')})$`),
      );
      expect(item.textContent).toMatch(/Likely|Possible|Unlikely/);
    }
    const hunger = card(sheet, 'hunger');
    expect(within(hunger).getByText(/^Last fed 4h 0?2m ago\.$/)).toBeTruthy();
    expect(within(hunger).getByText('Try offering a feed.')).toBeTruthy();
    expect(within(card(sheet, 'comfort')).getByText(/^Try holding her skin to skin/)).toBeTruthy();
    // No answered spells yet: no "Helped" hint.
    expect(within(sheet).queryByText(/^Helped/)).toBeNull();
  });

  it('says "Not enough logged yet." for the causes with nothing logged', async () => {
    pinClock(14, 0);
    await seedNow(db, { types: TYPES });
    await putEvent(db, 'bath', 30, 30);
    renderNow();

    const { sheet } = await openSheet();
    for (const cause of ['hunger', 'sleepy', 'diaper', 'gas']) {
      expect(within(card(sheet, cause)).getByText('Not enough logged yet.')).toBeTruthy();
      expect(within(card(sheet, cause)).getByText('Possible')).toBeTruthy();
    }
  });

  it('while a sleep timer runs, every cause says the log may be behind', async () => {
    pinClock(14, 0);
    await seed();
    await putEvent(db, 'sleep', 30, null, { kind: 'nap' });
    renderNow();

    const { sheet } = await openSheet();
    expect(
      within(sheet).getAllByText('A sleep timer is still running, so the log may be behind.'),
    ).toHaveLength(4);
    expect(within(sheet).getByRole('region', { name: 'When to call for help' })).toBeTruthy();
  });

  it('while a feed runs, hunger is unlikely and says so', async () => {
    pinClock(14, 0);
    await seed();
    await putEvent(db, 'feeding', 10, null, {
      method: 'breast',
      side: 'left',
      side_since: minutesAgo(10),
    });
    renderNow();

    const { sheet } = await openSheet();
    const hunger = card(sheet, 'hunger');
    expect(within(hunger).getByText('A feed is running, started 10m ago.')).toBeTruthy();
    expect(within(hunger).getByText('Unlikely')).toBeTruthy();
  });

  it('shows what helped before once three spells were answered', async () => {
    pinClock(14, 0);
    await seed();
    await putFussy(26 * 60, 26 * 60 - 20, { what_helped: 'feeding' });
    await putFussy(50 * 60, 50 * 60 - 20, { what_helped: 'holding' });
    await putFussy(74 * 60, 74 * 60 - 20, { what_helped: 'feeding' });
    renderNow();

    const { sheet } = await openSheet();
    await waitFor(
      () =>
        expect(
          within(card(sheet, 'hunger')).getByText('Helped 2 of your last 3 times'),
        ).toBeTruthy(),
      SLOW,
    );
    expect(within(card(sheet, 'comfort')).getByText('Helped 1 of your last 3 times')).toBeTruthy();
    expect(within(card(sheet, 'gas')).queryByText(/Helped 0/)).toBeNull();
  });

  it('returns the focus to the entry when closed, and closing logs nothing', async () => {
    pinClock(14, 0);
    await seed();
    renderNow();

    const before = (await live()).length;
    const { entry, sheet } = await openSheet();
    fireEvent.keyDown(sheet, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: ENTRY })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(entry));
    expect(await live()).toHaveLength(before);
  });
});

describe('the shortcuts of the causes', () => {
  it('hunger opens the feed tray and diaper the diaper tray, closing the sheet', async () => {
    pinClock(14, 0);
    await seed();
    renderNow();

    let { sheet } = await openSheet();
    fireEvent.click(within(card(sheet, 'hunger')).getByRole('button', { name: 'Log a feed' }));
    expect(await screen.findByRole('dialog', { name: 'Feed' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: ENTRY })).toBeNull();
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Feed' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Feed' })).toBeNull());

    ({ sheet } = await openSheet());
    fireEvent.click(within(card(sheet, 'diaper')).getByRole('button', { name: 'Log a diaper' }));
    expect(await screen.findByRole('dialog', { name: 'Diaper' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: ENTRY })).toBeNull();
  });

  it('gas starts the belly massage (not offered while one runs), comfort has none', async () => {
    pinClock(14, 0);
    await seed();
    renderNow();

    let { sheet } = await openSheet();
    expect(within(card(sheet, 'comfort')).queryByRole('button')).toBeNull();
    fireEvent.click(
      within(card(sheet, 'gas')).getByRole('button', { name: 'Start belly massage' }),
    );
    await waitFor(
      async () =>
        expect(
          (await live()).some((e) => e.typeId === BELLY_MASSAGE_TYPE.id && e.endedAt === null),
        ).toBe(true),
      SLOW,
    );
    await waitFor(() => expect(screen.queryByRole('dialog', { name: ENTRY })).toBeNull());
    // The running massage reached the Now model (its card shows) before the sheet opens again.
    await screen.findByRole('button', { name: /^Stop Belly massage/ }, SLOW);

    ({ sheet } = await openSheet());
    expect(within(card(sheet, 'gas')).queryByRole('button')).toBeNull();
  });

  it('sleepiness starts the sleep like Fell asleep', async () => {
    pinClock(14, 0);
    await seed();
    renderNow();

    const { sheet } = await openSheet();
    fireEvent.click(within(card(sheet, 'sleepy')).getByRole('button', { name: 'Fell asleep' }));
    await waitFor(
      async () =>
        expect((await live()).some((e) => e.payload.kind === 'nap' && e.endedAt === null)).toBe(
          true,
        ),
      SLOW,
    );
    await waitFor(() => expect(screen.queryByRole('dialog', { name: ENTRY })).toBeNull());
  });
});

describe('"What worked?"', () => {
  it('is a radio group; a choice logs one spell with what helped and the first cause, undoable', async () => {
    pinClock(14, 0);
    await seed();
    renderNow();

    const opened = Date.now();
    const { sheet } = await openSheet();
    const first = cards(sheet)[0].dataset.testid?.replace('cry-cause-', '');
    const group = within(sheet).getByRole('radiogroup', { name: 'What worked?' });
    expect(
      within(group)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual([
      'Fed',
      'Changed diaper',
      'Slept',
      'Burped',
      'Held',
      'Rocked',
      'Pacifier',
      'Massage',
      'Nothing yet',
    ]);
    // Arrows move the focus only: a stray arrow never logs.
    const fed = within(group).getByRole('radio', { name: 'Fed' });
    fed.focus();
    fireEvent.keyDown(fed, { key: 'ArrowRight' });
    expect(document.activeElement?.textContent).toBe('Changed diaper');
    expect(await fussySpells()).toHaveLength(0);

    fireEvent.click(within(group).getByRole('radio', { name: 'Held' }));
    await holdToast();
    expect(await screen.findByText('Crying spell logged, Held')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: ENTRY })).toBeNull());
    const spells = await fussySpells();
    expect(spells).toHaveLength(1);
    expect(spells[0].payload).toEqual({ what_helped: 'holding', suggested_cause: first });
    expect(Date.parse(spells[0].startedAt)).toBeGreaterThanOrEqual(opened - 1000);
    expect(spells[0].endedAt).not.toBeNull();
    // No time-shift chips for a spell with a length: Undo only.
    expect(screen.queryByRole('group', { name: 'When it happened' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect(await fussySpells()).toHaveLength(0), SLOW);
  });

  it('stops a running fussy timer instead of logging a second spell', async () => {
    pinClock(14, 0);
    await seed();
    const running = await putFussy(12, null, { intensity: 'moderate' });
    renderNow();

    const { sheet } = await openSheet();
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Fed' }));
    await waitFor(async () => {
      const spells = await fussySpells();
      expect(spells).toHaveLength(1);
      expect(spells[0].id).toBe(running.id);
      expect(spells[0].endedAt).not.toBeNull();
      expect(spells[0].payload).toMatchObject({ intensity: 'moderate', what_helped: 'feeding' });
    }, SLOW);

    await holdToast();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () => {
      const [spell] = await fussySpells();
      expect(spell.endedAt).toBeNull();
      expect(spell.payload).toEqual({ intensity: 'moderate' });
    }, SLOW);
  });

  it('works offline: the spell goes to the outbox with no network', async () => {
    pinClock(14, 0);
    await seed();
    renderNow({ offline: true });

    const { sheet } = await openSheet();
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Nothing yet' }));
    await waitFor(async () => expect(await fussySpells()).toHaveLength(1), SLOW);
    const [spell] = await fussySpells();
    expect(spell.payload.what_helped).toBe('nothing');
    const outbox = await db.outbox.toArray();
    expect(outbox.some((entry) => entry.entityId === spell.id)).toBe(true);
  });
});

describe('who sees it', () => {
  it.each(['Viewer', 'Doctor'] as const)('is hidden for a %s', async (role) => {
    pinClock(14, 0);
    await seed(role);
    renderNow({ baby: { ...BABY, role, userId: 'u-me' } });

    await screen.findByRole('button', { name: /^Feed/ });
    expect(screen.queryByRole('button', { name: ENTRY })).toBeNull();
  });

  it('a Caregiver opens it', async () => {
    pinClock(14, 0);
    await seed('Caregiver');
    renderNow({ baby: { ...BABY, role: 'Caregiver', userId: 'u-me' } });
    expect((await openSheet()).sheet).toBeTruthy();
  });

  it('is in the More sheet too', async () => {
    pinClock(14, 0);
    await seed();
    renderNow();

    fireEvent.click(await screen.findByRole('button', { name: /^More/ }));
    const more = await screen.findByRole('dialog', { name: 'More' });
    fireEvent.click(within(more).getByRole('button', { name: ENTRY }));
    expect(await screen.findByRole('dialog', { name: ENTRY })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'More' })).toBeNull();
  });

  it('is in the night view', async () => {
    startNightView();
    stubWakeLock();
    await seed();
    renderNow();

    const night = await screen.findByRole('region', { name: 'Night view' });
    fireEvent.click(within(night).getByRole('button', { name: ENTRY }));
    expect(await screen.findByRole('dialog', { name: ENTRY })).toBeTruthy();
  });

  it('reads in Portuguese', async () => {
    await useTestLocale('pt-BR');
    pinClock(14, 0);
    await seed();
    renderNow();

    const { sheet } = await openSheet('Por que ela está chorando?');
    const banner = within(sheet).getByRole('region', { name: 'Quando pedir ajuda' });
    expect(
      within(banner).getByText('Ligue para o pediatra ou para a emergência se ela tiver:'),
    ).toBeTruthy();
    expect(
      within(sheet).getByRole('heading', { name: 'O que o seu registro sugere' }),
    ).toBeTruthy();
    expect(within(card(sheet, 'hunger')).getByText('Tente oferecer uma mamada.')).toBeTruthy();
    expect(within(sheet).getByRole('radio', { name: 'Colo' })).toBeTruthy();
  });
});

function startNightView() {
  window.localStorage.setItem(
    NIGHT_FEED_STATE_STORAGE_KEY,
    JSON.stringify({ override: { on: true, key: nightPeriodKey(new Date()) } }),
  );
}

function stubWakeLock() {
  const sentinel = { released: false, release: vi.fn(async () => undefined) };
  Object.defineProperty(navigator, 'wakeLock', {
    value: { request: vi.fn(async () => sentinel) },
    configurable: true,
  });
}

async function violations() {
  const result = await axe.run(document.body, {
    runOnly: ['wcag2a', 'wcag2aa'],
    rules: { 'color-contrast': { enabled: false } },
  });
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
}

describe('accessibility (axe)', () => {
  it.each(['light', 'dark', 'night'] as const)(
    'the sheet has no violations in the %s scheme',
    async (mode) => {
      if (mode === 'night') {
        startNightView();
        stubWakeLock();
      } else {
        window.localStorage.setItem(THEME_STORAGE_KEY, mode);
      }
      await seed();
      await putFussy(26 * 60, 26 * 60 - 20, { what_helped: 'feeding' });
      await putFussy(50 * 60, 50 * 60 - 20, { what_helped: 'holding' });
      await putFussy(74 * 60, 74 * 60 - 20, { what_helped: 'rocking' });
      renderNow();

      await openSheet();
      await screen.findAllByText(/^Helped \d of your last 3 times$/);
      expect(document.documentElement.hasAttribute(`data-${mode}`)).toBe(true);
      expect(await violations()).toEqual([]);
    },
    60_000,
  );
});
