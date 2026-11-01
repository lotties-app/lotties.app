import { describe, expect, it } from 'vitest';
import type { CryEngineErrorCode } from '../cry/errors';
import {
  failureOf,
  initialMonitorState,
  monitorReducer,
  type MonitorAction,
  type MonitorState,
} from './monitorState';

const T = 1_000;
const run = (actions: MonitorAction[], from: MonitorState = { phase: 'intro' }) =>
  actions.reduce(monitorReducer, from);

describe('the cry monitor page state machine', () => {
  it('starts on the intro, or on "not supported" without the browser features', () => {
    expect(initialMonitorState(true)).toEqual({ phase: 'intro' });
    expect(initialMonitorState(false)).toEqual({
      phase: 'failure',
      failure: 'unsupported',
      at: null,
    });
  });

  it('goes intro -> consent -> intro -> loading -> listening -> intro on stop', () => {
    const consent = run([{ type: 'consentNeeded' }]);
    expect(consent).toEqual({ phase: 'consent' });
    const agreed = monitorReducer(consent, { type: 'consentGiven' });
    expect(agreed).toEqual({ phase: 'intro' });
    const loading = monitorReducer(agreed, { type: 'start' });
    expect(loading).toEqual({ phase: 'loading' });
    const listening = monitorReducer(loading, { type: 'listening', at: T });
    expect(listening).toEqual({ phase: 'listening', since: T });
    expect(monitorReducer(listening, { type: 'stop' })).toEqual({ phase: 'intro' });
  });

  it('cancels the consent and the loading back to the intro', () => {
    expect(run([{ type: 'consentNeeded' }, { type: 'consentCancelled' }])).toEqual({
      phase: 'intro',
    });
    expect(run([{ type: 'start' }, { type: 'stop' }])).toEqual({ phase: 'intro' });
  });

  it('turns engine errors into failures with the time, while loading or listening', () => {
    expect(run([{ type: 'start' }, { type: 'error', code: 'denied', at: T }])).toEqual({
      phase: 'failure',
      failure: 'denied',
      at: T,
    });
    expect(
      run([
        { type: 'start' },
        { type: 'listening', at: T },
        { type: 'error', code: 'lost', at: T + 5 },
      ]),
    ).toEqual({ phase: 'failure', failure: 'lost', at: T + 5 });
    // An error that arrives after a stop changes nothing.
    expect(run([{ type: 'error', code: 'lost', at: T }])).toEqual({ phase: 'intro' });
  });

  it('stops on a stall and never claims to listen again by itself', () => {
    const stalled = run([
      { type: 'start' },
      { type: 'listening', at: T },
      { type: 'stalled', at: T + 9 },
    ]);
    expect(stalled).toEqual({ phase: 'failure', failure: 'stalled', at: T + 9 });
    expect(monitorReducer(stalled, { type: 'listening', at: T + 10 })).toBe(stalled);
    // Restart goes through loading again.
    expect(monitorReducer(stalled, { type: 'start' })).toEqual({ phase: 'loading' });
    // A stall while loading is not a thing: only listening stalls.
    expect(run([{ type: 'start' }, { type: 'stalled', at: T }])).toEqual({ phase: 'loading' });
  });

  it('keeps "not supported" whatever happens', () => {
    const unsupported = initialMonitorState(false);
    for (const action of [
      { type: 'start' },
      { type: 'consentNeeded' },
      { type: 'stop' },
      { type: 'listening', at: T },
    ] as MonitorAction[]) {
      expect(monitorReducer(unsupported, action)).toBe(unsupported);
    }
  });

  it('ignores a start or a listening that does not fit the phase', () => {
    expect(run([{ type: 'listening', at: T }])).toEqual({ phase: 'intro' });
    const loading = run([{ type: 'start' }]);
    expect(monitorReducer(loading, { type: 'start' })).toBe(loading);
    expect(monitorReducer({ phase: 'consent' }, { type: 'start' })).toEqual({ phase: 'consent' });
  });

  it('maps every engine error code to one failure', () => {
    const cases: [CryEngineErrorCode, string][] = [
      ['denied', 'denied'],
      ['unavailable', 'unavailable'],
      ['lost', 'lost'],
      ['insecure_context', 'unsupported'],
      ['unsupported', 'unsupported'],
      ['model_missing', 'model'],
      ['model_invalid', 'model'],
      ['class_missing', 'model'],
      ['classifier_failed', 'model'],
    ];
    for (const [code, failure] of cases) expect(failureOf(code), code).toBe(failure);
  });
});
