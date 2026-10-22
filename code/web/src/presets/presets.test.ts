import { describe, expect, it } from 'vitest';
import { BUILT_IN_PRESETS, DEFAULT_PINNED } from './catalogue';
import { clearAllPinned, clearPinned, loadPinned, storePinned } from './pinnedStorage';
import { presetIcon } from './presetIcons';
import { isTrackable, pinnedPresets, presetsForBaby } from './resolve';
import { formatPresetStatus, inferFellAsleepKind, presetStatus, runningSince } from './status';
import { BUILT_IN_TYPES, DIAPER_T, SLEEP, event, eventType, presetById } from './presetFixtures';
import { CATEGORY_NAMES } from '../theme/tokens';

describe('catalogue', () => {
  it('lists the seventeen built-in presets in Track sheet order', () => {
    expect(BUILT_IN_PRESETS.map((p) => p.id)).toEqual([
      'wake_up',
      'nap',
      'bedtime',
      'fell_asleep',
      'night_waking',
      'bottle',
      'nursing',
      'pumping',
      'diaper',
      'medication',
      'belly_pain',
      'nasal_suction',
      'belly_massage',
      'bath',
      'fussy',
      'tummy_time',
      'custom',
    ]);
  });

  it('maps to type keys, modes and payloads per DESIGN.md section 3', () => {
    const shape = (id: string) => {
      const p = BUILT_IN_PRESETS.find((x) => x.id === id)!;
      return [p.typeKey, p.mode, p.payloadDefaults];
    };
    expect(shape('wake_up')).toEqual(['sleep', 'instant', { kind: 'woke_up' }]);
    expect(shape('nap')).toEqual(['sleep', 'timer', { kind: 'nap' }]);
    expect(shape('bedtime')).toEqual(['sleep', 'instant', { kind: 'bed_time' }]);
    expect(shape('fell_asleep')).toEqual(['sleep', 'instant', { kind: 'fell_asleep' }]);
    expect(shape('night_waking')).toEqual(['sleep', 'timer', { kind: 'night_waking' }]);
    // A bottle is timed like nursing (how long the baby took); the stop asks for the amount.
    expect(shape('bottle')).toEqual(['feeding', 'timer', { method: 'bottle' }]);
    expect(shape('nursing')).toEqual(['feeding', 'timer', { method: 'breast' }]);
    expect(shape('pumping')).toEqual(['breast_pump', 'timer', {}]);
    expect(shape('diaper')).toEqual(['diaper', 'sheet', {}]);
    expect(shape('medication')).toEqual(['medication', 'sheet', {}]);
    expect(shape('belly_pain')).toEqual(['belly_pain', 'sheet', {}]);
    expect(shape('nasal_suction')).toEqual(['nasal_suction', 'sheet', {}]);
    expect(shape('belly_massage')).toEqual(['belly_massage', 'timer', {}]);
    expect(shape('bath')).toEqual(['bath', 'sheet', {}]);
    expect(shape('fussy')).toEqual(['fussy', 'timer', {}]);
    expect(shape('tummy_time')).toEqual(['tummy_time', 'timer', {}]);
    expect(shape('custom')).toEqual(['', 'link', {}]);
  });

  it('uses category tokens that exist in the theme and an icon for every preset', () => {
    for (const def of BUILT_IN_PRESETS) {
      expect(CATEGORY_NAMES).toContain(def.category);
      const preset = presetById(def.id === 'custom' ? 'custom' : def.id);
      expect(presetIcon(preset)).toBeTruthy();
    }
  });

  it('only defaults to pinned ids that exist', () => {
    const ids = BUILT_IN_PRESETS.map((p) => p.id);
    for (const id of DEFAULT_PINNED) expect(ids).toContain(id);
  });

  it('pins Wake-up, Bottle, Diaper and Nap by default, in that order', () => {
    expect(DEFAULT_PINNED).toEqual(['wake_up', 'bottle', 'diaper', 'nap']);
  });

  it('offers Nasal suction as an unpinned health sheet preset with the wind icon', () => {
    const preset = presetById('nasal_suction');
    expect(preset).toMatchObject({ category: 'health', typeId: 'type-nasal', builtIn: true });
    expect(presetIcon(preset)).toBe('wind');
    expect(DEFAULT_PINNED).not.toContain('nasal_suction');
    expect(
      pinnedPresets(presetsForBaby(BUILT_IN_TYPES), ['nasal_suction']).map((p) => p.id),
    ).toEqual(['nasal_suction', 'wake_up', 'bottle', 'diaper']);
  });

  it('offers Belly massage as an unpinned health timer preset with the massage icon', () => {
    const preset = presetById('belly_massage');
    expect(preset).toMatchObject({
      category: 'health',
      typeId: 'type-massage',
      builtIn: true,
      mode: 'timer',
    });
    expect(presetIcon(preset)).toBe('massage');
    expect(DEFAULT_PINNED).not.toContain('belly_massage');
    expect(
      pinnedPresets(presetsForBaby(BUILT_IN_TYPES), ['belly_massage']).map((p) => p.id),
    ).toEqual(['belly_massage', 'wake_up', 'bottle', 'diaper']);
    const withoutType = presetsForBaby(BUILT_IN_TYPES.filter((t) => t.key !== 'belly_massage'));
    expect(withoutType.map((p) => p.id)).not.toContain('belly_massage');
  });

  it('offers Fussy as an unpinned care timer preset with the crying-face icon', () => {
    const preset = presetById('fussy');
    expect(preset).toMatchObject({
      category: 'care',
      typeId: 'type-fussy',
      builtIn: true,
      mode: 'timer',
    });
    expect(presetIcon(preset)).toBe('mood-cry');
    expect(DEFAULT_PINNED).not.toContain('fussy');
    expect(pinnedPresets(presetsForBaby(BUILT_IN_TYPES), ['fussy']).map((p) => p.id)).toEqual([
      'fussy',
      'wake_up',
      'bottle',
      'diaper',
    ]);
    const withoutType = presetsForBaby(BUILT_IN_TYPES.filter((t) => t.key !== 'fussy'));
    expect(withoutType.map((p) => p.id)).not.toContain('fussy');
  });

  it('shows Belly massage as running while its timer runs', () => {
    const preset = presetById('belly_massage');
    const now = new Date(2026, 9, 21, 14, 0);
    const startedAt = new Date(2026, 9, 21, 13, 55).toISOString();
    const running = [event({ id: 'm1', typeId: 'type-massage', startedAt })];
    expect(presetStatus(preset, running, now)).toBe('running');
    expect(runningSince(preset, running)).toBe(startedAt);
  });
});

describe('presetsForBaby', () => {
  it('resolves built-ins against the baby types by key and ends with the Custom tile', () => {
    const presets = presetsForBaby(BUILT_IN_TYPES);
    expect(presets.map((p) => p.id)).toEqual(BUILT_IN_PRESETS.map((p) => p.id));
    expect(presets.find((p) => p.id === 'nap')).toMatchObject({ typeId: SLEEP, builtIn: true });
    expect(presets.find((p) => p.id === 'diaper')?.typeId).toBe(DIAPER_T);
    expect(presets.at(-1)).toMatchObject({ id: 'custom', typeId: null, mode: 'link' });
    expect(presets.filter(isTrackable)).toHaveLength(presets.length - 1);
  });

  it('omits presets whose built-in type is missing', () => {
    const presets = presetsForBaby(BUILT_IN_TYPES.filter((t) => t.key !== 'sleep'));
    const ids = presets.map((p) => p.id);
    expect(ids).not.toContain('nap');
    expect(ids).not.toContain('wake_up');
    expect(ids).toContain('diaper');
  });

  it('turns custom types into presets by name: timer if it has a duration, else sheet', () => {
    const types = [
      ...BUILT_IN_TYPES,
      eventType({
        id: 'c2',
        key: 'walk',
        name: 'Walk',
        babyId: 'b',
        hasDuration: true,
        icon: 'directions_walk',
        color: '#112233',
      }),
      eventType({ id: 'c1', key: 'vitamin', name: 'Vitamin D', babyId: 'b', color: 'url(x)' }),
    ];
    const presets = presetsForBaby(types);
    const customs = presets.filter((p) => !p.builtIn);
    expect(customs.map((p) => p.label)).toEqual(['Vitamin D', 'Walk']);
    expect(customs[0]).toMatchObject({
      id: 'type:c1',
      mode: 'sheet',
      category: 'custom',
      typeId: 'c1',
      customColor: undefined,
      payloadDefaults: {},
    });
    expect(customs[1]).toMatchObject({ mode: 'timer', customColor: '#112233' });
    expect(presets.at(-1)?.id).toBe('custom');
  });

  it('does not let a custom type replace a built-in one with the same key', () => {
    const types = [
      ...BUILT_IN_TYPES,
      eventType({ id: 'fake', key: 'diaper', name: 'My diaper', babyId: 'b' }),
    ];
    const presets = presetsForBaby(types);
    expect(presets.find((p) => p.id === 'diaper')?.typeId).toBe(DIAPER_T);
    expect(presets.find((p) => p.id === 'type:fake')).toBeTruthy();
  });

  it('falls back to a generic icon for unknown icon names (including inherited ones)', () => {
    const types = [
      ...BUILT_IN_TYPES,
      eventType({ id: 'x', key: 'x', name: 'X', babyId: 'b', icon: 'constructor' }),
    ];
    const custom = presetsForBaby(types).find((p) => p.id === 'type:x')!;
    expect(typeof presetIcon(custom)).not.toBe('undefined');
    expect(presetIcon(custom)).toBe(presetIcon({ icon: 'nope', builtIn: false }));
  });
});

describe('pinnedPresets', () => {
  const presets = presetsForBaby(BUILT_IN_TYPES);

  it('returns the defaults when nothing is pinned', () => {
    expect(pinnedPresets(presets, []).map((p) => p.id)).toEqual([
      'wake_up',
      'bottle',
      'diaper',
      'nap',
    ]);
  });

  it('keeps the chosen order, drops unknown ids and link tiles, tops up to four', () => {
    expect(pinnedPresets(presets, ['bath', 'gone', 'custom', 'nap']).map((p) => p.id)).toEqual([
      'bath',
      'nap',
      'wake_up',
      'bottle',
    ]);
  });

  it('never returns more than four', () => {
    expect(
      pinnedPresets(
        presets,
        presets.map((p) => p.id),
      ),
    ).toHaveLength(4);
  });
});

describe('pinned storage', () => {
  it('defaults, round-trips per baby and caps at four unique ids', () => {
    expect(loadPinned('b1')).toEqual([...DEFAULT_PINNED]);
    storePinned('b1', ['nap', 'nap', 'bath', 'diaper', 'bottle', 'wake_up']);
    expect(loadPinned('b1')).toEqual(['nap', 'bath', 'diaper', 'bottle']);
    expect(loadPinned('b2')).toEqual([...DEFAULT_PINNED]);
  });

  it('ignores corrupt values and survives unavailable storage', () => {
    window.localStorage.setItem('baby-routine.pinned-presets.b1', '{oops');
    expect(loadPinned('b1')).toEqual([...DEFAULT_PINNED]);
    window.localStorage.setItem('baby-routine.pinned-presets.b1', '{"a":1}');
    expect(loadPinned('b1')).toEqual([...DEFAULT_PINNED]);
    window.localStorage.setItem('baby-routine.pinned-presets.b1', '[1,"nap",""]');
    expect(loadPinned('b1')).toEqual(['nap']);
  });

  it('clears one baby or all', () => {
    storePinned('b1', ['nap']);
    storePinned('b2', ['bath']);
    clearPinned('b1');
    expect(loadPinned('b1')).toEqual([...DEFAULT_PINNED]);
    expect(loadPinned('b2')).toEqual(['bath']);
    clearAllPinned();
    expect(loadPinned('b2')).toEqual([...DEFAULT_PINNED]);
  });
});

describe('presetStatus and its text', () => {
  const NOW = new Date(2026, 9, 21, 14, 0, 0);
  const at = (h: number, m = 0, day = 21) => new Date(2026, 9, day, h, m).toISOString();
  const nap = presetById('nap');
  const diaper = presetById('diaper');

  it('is running while a matching timer runs, and says how long', () => {
    const events = [event({ id: 'e1', startedAt: at(13, 18), payload: { kind: 'nap' } })];
    expect(presetStatus(nap, events, NOW)).toBe('running');
    expect(runningSince(nap, events)).toBe(at(13, 18));
    expect(formatPresetStatus('running', NOW, at(13, 18))).toBe('Running 0:42');
    expect(formatPresetStatus('running', NOW, at(11, 55))).toBe('Running 2:05');
  });

  it('does not treat another kind or a deleted timer as the preset running', () => {
    const events = [
      event({ id: 'e1', startedAt: at(13), payload: { kind: 'night_waking' } }),
      event({ id: 'e2', startedAt: at(13), payload: { kind: 'nap' }, deletedAt: at(13, 30) }),
    ];
    expect(presetStatus(nap, events, NOW)).toBe('untracked-today');
  });

  it('reports the latest matching event of today with relative text', () => {
    const events = [
      event({ id: 'a', typeId: DIAPER_T, startedAt: at(9) }),
      event({ id: 'b', typeId: DIAPER_T, startedAt: at(12, 0) }),
      event({ id: 'c', typeId: SLEEP, startedAt: at(13, 50) }),
    ];
    const status = presetStatus(diaper, events, NOW);
    expect(status).toEqual({ lastAt: at(12) });
    expect(formatPresetStatus(status, NOW)).toBe('Last 2h ago');
  });

  it.each([
    [at(13, 59, 21), 'Last 1 min ago'],
    [new Date(2026, 9, 21, 13, 59, 40).toISOString(), 'Last just now'],
    [at(13, 15), 'Last 45 min ago'],
  ])('formats %s as %s', (lastAt, text) => {
    expect(formatPresetStatus({ lastAt }, NOW)).toBe(text);
  });

  it('shows the clock time from 12 hours on', () => {
    const evening = new Date(2026, 9, 21, 19, 30);
    expect(formatPresetStatus({ lastAt: at(7, 5) }, evening)).toBe('Last 07:05');
    expect(formatPresetStatus({ lastAt: at(2, 0) }, NOW)).toBe('Last 02:00');
    expect(formatPresetStatus({ lastAt: at(2, 1) }, NOW)).toBe('Last 11h ago');
  });

  it('is "Not tracked today" without events, with an older day, or with only future events', () => {
    expect(presetStatus(diaper, [], NOW)).toBe('untracked-today');
    expect(formatPresetStatus('untracked-today', NOW)).toBe('Not tracked today');
    const yesterday = event({ id: 'y', typeId: DIAPER_T, startedAt: at(15, 0, 20) });
    expect(presetStatus(diaper, [yesterday], NOW)).toBe('untracked-today');
    const future = event({ id: 'f', typeId: DIAPER_T, startedAt: at(15, 0, 21) });
    expect(presetStatus(diaper, [future], NOW)).toBe('untracked-today');
  });

  it('still reports last night as recent when it was less than 12 hours ago', () => {
    const early = new Date(2026, 9, 21, 3, 0);
    const lastNight = event({ id: 'n', typeId: DIAPER_T, startedAt: at(23, 0, 20) });
    expect(presetStatus(diaper, [lastNight], early)).toEqual({ lastAt: lastNight.startedAt });
    expect(formatPresetStatus({ lastAt: lastNight.startedAt }, early)).toBe('Last 4h ago');
  });

  it('treats link presets as untracked and never reads inherited payload keys', () => {
    expect(presetStatus(presetById('custom'), [], NOW)).toBe('untracked-today');
    const odd = event({ id: 'o', payload: JSON.parse('{"__proto__": {"kind": "nap"}}') });
    expect(presetStatus(nap, [odd], NOW)).toBe('untracked-today');
  });
});

describe('inferFellAsleepKind', () => {
  const bedtime = (iso: string) =>
    event({ id: iso, startedAt: iso, endedAt: iso, payload: { kind: 'bed_time' } });

  it('is night within three hours of a bedtime marker, even at midday', () => {
    const now = new Date(2026, 9, 21, 13, 0);
    expect(inferFellAsleepKind([bedtime(new Date(2026, 9, 21, 10, 30).toISOString())], now)).toBe(
      'night',
    );
  });

  it('ignores older, future or deleted bedtime markers', () => {
    const now = new Date(2026, 9, 21, 13, 0);
    expect(inferFellAsleepKind([bedtime(new Date(2026, 9, 21, 9, 59).toISOString())], now)).toBe(
      'nap',
    );
    expect(inferFellAsleepKind([bedtime(new Date(2026, 9, 21, 13, 1).toISOString())], now)).toBe(
      'nap',
    );
    const deleted = { ...bedtime(new Date(2026, 9, 21, 12, 0).toISOString()), deletedAt: 'x' };
    expect(inferFellAsleepKind([deleted], now)).toBe('nap');
  });

  it.each([
    [19, 0, 'night'],
    [23, 59, 'night'],
    [0, 0, 'night'],
    [4, 59, 'night'],
    [5, 0, 'nap'],
    [12, 0, 'nap'],
    [18, 59, 'nap'],
  ])('at %i:%i with no marker is %s', (h, m, kind) => {
    expect(inferFellAsleepKind([], new Date(2026, 9, 21, h, m))).toBe(kind);
  });
});
