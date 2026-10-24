import type {
  CaptureInfo,
  CryEngineEventMap,
  CryEngineEventType,
  CryEngineStartOptions,
  CryEngineState,
} from '../cry';
import type { CryEngineErrorCode } from '../cry/errors';
import type { CrySensitivity } from '../cry/sensitivity';
import type { CryEngineLike } from './useCryMonitor';

/*
 * A scripted cry engine for tests and the developer preview (`/dev/cry-monitor`): no microphone, no
 * model, no worker. `start` ends in `listening` or in the error the scenario asks for; the test drives
 * cries, scores and stalls with `emit`. Never used by the app itself.
 */

type Listener<K extends CryEngineEventType> = (payload: CryEngineEventMap[K]) => void;

export interface FakeCryEngineOptions {
  /** How `start` ends (default: listening). `pending` never settles (the loading screen). */
  outcome?: 'listening' | 'pending' | CryEngineErrorCode;
  /** Processing the browser left on (the page warns). */
  processingOn?: CaptureInfo['processingOn'];
}

export class FakeCryEngine implements CryEngineLike {
  private readonly listeners = new Map<CryEngineEventType, Set<Listener<CryEngineEventType>>>();
  private readonly options: FakeCryEngineOptions;
  capture: CaptureInfo | null = null;
  state: CryEngineState = 'idle';
  starts: CryEngineStartOptions[] = [];
  stops = 0;
  sensitivityChanges: CrySensitivity[] = [];
  /** The running cry's start and the last frame time, to end it on stop like the real engine. */
  private cryAt: number | null = null;
  lastFrameAt: number | null = null;

  constructor(options: FakeCryEngineOptions = {}) {
    this.options = options;
  }

  on<K extends CryEngineEventType>(type: K, listener: Listener<K>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener as Listener<CryEngineEventType>);
    return () => set.delete(listener as Listener<CryEngineEventType>);
  }

  emit<K extends CryEngineEventType>(type: K, payload: CryEngineEventMap[K]): void {
    if (type === 'cry_started') this.cryAt = (payload as CryEngineEventMap['cry_started']).at;
    if (type === 'cry_ended') this.cryAt = null;
    if (type === 'score') this.lastFrameAt = (payload as CryEngineEventMap['score']).t + 975;
    for (const listener of this.listeners.get(type) ?? []) (listener as Listener<K>)(payload);
  }

  private setState(state: CryEngineState, error: CryEngineErrorCode | null = null) {
    this.state = state;
    this.emit('state', { state, error });
  }

  async start(options: CryEngineStartOptions = {}): Promise<CryEngineState> {
    this.starts.push(options);
    this.setState('loading');
    const outcome = this.options.outcome ?? 'listening';
    if (outcome === 'pending') return new Promise<CryEngineState>(() => undefined);
    await Promise.resolve();
    if (this.state !== 'loading') return this.state;
    if (outcome === 'listening') {
      this.capture = {
        contextSampleRate: 48000,
        processingOn: this.options.processingOn ?? [],
        processingUnknown: [],
      };
      this.setState('listening');
    } else {
      this.setState('error', outcome);
    }
    return this.state;
  }

  stop(): void {
    this.stops++;
    if (this.state === 'idle') return;
    if (this.cryAt !== null) {
      const at = this.lastFrameAt ?? this.cryAt;
      this.emit('cry_ended', {
        type: 'cry_ended',
        at,
        startedAt: this.cryAt,
        closedAt: at,
        reason: 'stream_end',
      });
    }
    this.setState('idle');
  }

  setSensitivity(sensitivity: CrySensitivity): void {
    this.sensitivityChanges.push(sensitivity);
  }

  /** A capture loss while listening (a call, a revoked permission): the real engine fails with `lost`. */
  lose(): void {
    if (this.cryAt !== null) {
      const at = this.lastFrameAt ?? this.cryAt;
      this.emit('cry_ended', {
        type: 'cry_ended',
        at,
        startedAt: this.cryAt,
        closedAt: at,
        reason: 'stream_end',
      });
    }
    this.setState('error', 'lost');
  }
}
