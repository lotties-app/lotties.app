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
  /** Always the on-device engine (server and Web recognition were left out on purpose). */
  engine: SpeechEngineKind;
  condition: LabCondition;
}

export type Speaking = 'phrase' | 'free' | null;

/** A free try on screen; the id only keeps the list stable while it scrolls (never exported). */
export interface FreeTryEntry {
  id: number;
  attempt: Attempt;
}

const runId = ({ engine, condition, locale }: LabSettings) => `${engine}|${condition}|${locale}`;

/**
 * The lab's state, in memory only: the chosen run, the attempts, where each run is, the free tries,
 * the last setup error. Speaking parses at once; the text is kept only inside the attempt shown.
 */
export function useVoiceLab(platform: SpeechPlatform, initialLocale: SpeechLocale = 'pt-BR') {
  const listener = useListen(platform);
  const [settings, setSettings] = useState<LabSettings>({
    locale: initialLocale,
    engine: 'on_device',
    condition: 'C1',
  });
  const [records, setRecords] = useState<PhraseRecord[]>([]);
  const [positions, setPositions] = useState<Record<string, number>>({});
  const [freeTries, setFreeTries] = useState<FreeTryEntry[]>([]);
  const [freeTryCount, setFreeTryCount] = useState(0);
  const [speaking, setSpeaking] = useState<Speaking>(null);
  const [error, setError] = useState<{ code: SpeechErrorCode; mode: 'phrase' | 'free' } | null>(
    null,
  );

  const phrases = phrasesFor(settings.locale, settings.condition);
  const position = Math.min(positions[runId(settings)] ?? 0, phrases.length);
  const phrase: LabPhrase | null = phrases[position] ?? null;
  const record = phrase ? records.find((r) => r.key === recordKey(settings, phrase.id)) : undefined;
  const change = (next: Partial<Pick<LabSettings, 'locale' | 'condition'>>) => {
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
      return await listener.listen(settings.locale);
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
    if (!phrase || speaking) return;
    const target = phrase;
    const run = settings;
    const heard = await hear('phrase');
    if (!heard) return;
    if (heard.error && !countsAsAttempt(heard.error)) {
      setError({ code: heard.error, mode: 'phrase' });
      return;
    }
    const attempt = judged(target, target, heard);
    setRecords((all) => addAttempt(all, run, target, attempt));
  }

  async function speakFree() {
    if (speaking) return;
    const heard = await hear('free');
    if (!heard) return;
    if (heard.error && !countsAsAttempt(heard.error)) {
      setError({ code: heard.error, mode: 'free' });
      return;
    }
    const attempt = judged({ locale: settings.locale, units: currentUnitSystem() }, null, heard);
    const id = freeTryCount + 1;
    setFreeTryCount(id);
    setFreeTries((all) => [{ id, attempt }, ...all].slice(0, FREE_TRIES_KEPT));
  }

  return {
    settings,
    change,
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
    /** The last setup problem (refused, no on-device recognition...) of a guided run or a free try. */
    errorFor: (mode: 'phrase' | 'free') => (error?.mode === mode ? error.code : null),
    speakPhrase,
    speakFree,
  };
}

export type VoiceLab = ReturnType<typeof useVoiceLab>;
