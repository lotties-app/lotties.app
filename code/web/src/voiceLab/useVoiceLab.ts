import { useState } from 'react';
import type { SpeechEngineKind, SpeechErrorCode, SpeechPlatform } from '../platform/speechTypes';
import { currentUnitSystem } from '../units/state';
import type { SpeechLocale } from '../voice/numberWords';
import {
  addAttempt,
  countsAsAttempt,
  evaluate,
  recordKey,
  type Attempt,
  type PhraseRecord,
} from './labModel';
import { phrasesFor, type LabCondition, type LabPhrase } from './labPhrases';
import { useListen, type ListenOutcome } from './useListen';

/** Free tries shown at once (never exported, gone when the page closes). */
const FREE_TRIES_KEPT = 5;

export interface LabSettings {
  locale: SpeechLocale;
  engine: SpeechEngineKind;
  condition: LabCondition;
}

export type Speaking = 'phrase' | 'free' | null;

const runId = ({ engine, condition, locale }: LabSettings) => `${engine}|${condition}|${locale}`;

/** Engines whose audio may leave the phone: each needs its own confirmation once per visit. */
export const needsConfirmation = (engine: SpeechEngineKind) => engine !== 'on_device';

/**
 * The lab's state, in memory only: the chosen run, the attempts, where each run is, the free tries,
 * the last setup error. Speaking parses at once; the text is kept only inside the attempt shown.
 */
export function useVoiceLab(platform: SpeechPlatform) {
  const listener = useListen(platform);
  const [settings, setSettings] = useState<LabSettings>({
    locale: 'pt-BR',
    engine: 'on_device',
    condition: 'C1',
  });
  const [confirmed, setConfirmed] = useState<Partial<Record<SpeechEngineKind, boolean>>>({});
  const [records, setRecords] = useState<PhraseRecord[]>([]);
  const [positions, setPositions] = useState<Record<string, number>>({});
  const [freeTries, setFreeTries] = useState<Attempt[]>([]);
  const [speaking, setSpeaking] = useState<Speaking>(null);
  const [error, setError] = useState<SpeechErrorCode | null>(null);

  const phrases = phrasesFor(settings.locale, settings.condition);
  const position = Math.min(positions[runId(settings)] ?? 0, phrases.length);
  const phrase: LabPhrase | null = phrases[position] ?? null;
  const record = phrase ? records.find((r) => r.key === recordKey(settings, phrase.id)) : undefined;
  const ready = !needsConfirmation(settings.engine) || confirmed[settings.engine] === true;

  const change = (next: Partial<LabSettings>) => {
    setSettings((current) => ({ ...current, ...next }));
    setError(null);
  };

  const moveTo = (index: number) => {
    setPositions((all) => ({ ...all, [runId(settings)]: index }));
    setError(null);
  };

  async function hear(mode: 'phrase' | 'free'): Promise<ListenOutcome | null> {
    setSpeaking(mode);
    setError(null);
    try {
      return await listener.listen(settings.engine, settings.locale);
    } finally {
      setSpeaking(null);
    }
  }

  /** Parses and judges, adding the parser's own time to the latency. */
  function judged(
    target: Pick<LabPhrase, 'locale' | 'units'>,
    phraseToJudge: LabPhrase | null,
    heard: ListenOutcome,
  ) {
    const started = performance.now();
    const attempt = evaluate(target, phraseToJudge?.expected ?? null, heard, new Date());
    const parseMs = Math.round(performance.now() - started);
    return attempt.latencyMs === null
      ? attempt
      : { ...attempt, latencyMs: attempt.latencyMs + parseMs };
  }

  async function speakPhrase() {
    if (!phrase || !ready || speaking) return;
    const target = phrase;
    const run = settings;
    const heard = await hear('phrase');
    if (!heard) return;
    if (heard.error && !countsAsAttempt(heard.error)) {
      setError(heard.error);
      return;
    }
    const attempt = judged(target, target, heard);
    setRecords((all) => addAttempt(all, run, target, attempt));
  }

  async function speakFree() {
    if (!ready || speaking) return;
    const heard = await hear('free');
    if (!heard) return;
    if (heard.error && !countsAsAttempt(heard.error)) {
      setError(heard.error);
      return;
    }
    const attempt = judged({ locale: settings.locale, units: currentUnitSystem() }, null, heard);
    setFreeTries((all) => [attempt, ...all].slice(0, FREE_TRIES_KEPT));
  }

  return {
    settings,
    change,
    confirmed: confirmed[settings.engine] === true,
    confirm: (value: boolean) => setConfirmed((all) => ({ ...all, [settings.engine]: value })),
    ready,
    phrases,
    position,
    phrase,
    record,
    records,
    next: () => moveTo(position + 1),
    restart: () => moveTo(0),
    freeTries,
    speaking,
    listenState: listener.state,
    cancel: listener.cancel,
    error,
    speakPhrase,
    speakFree,
  };
}

export type VoiceLab = ReturnType<typeof useVoiceLab>;
