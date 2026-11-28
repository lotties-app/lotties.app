import { useCallback, useEffect, useState } from 'react';
import type { DownloadStatus, SpeechCapabilities, SpeechPlatform } from '../platform/speechTypes';
import type { SpeechLocale } from '../voice/numberWords';

export type CapabilitiesState =
  { status: 'loading' } | { status: 'failed' } | { status: 'ready'; value: SpeechCapabilities };

export interface Capabilities {
  state: CapabilitiesState;
  /** The last answer per language (the export carries them). */
  known: Partial<Record<SpeechLocale, SpeechCapabilities>>;
  refresh: () => void;
  download: () => Promise<DownloadStatus>;
}

/** What the phone reports for `locale`: asked on open, on a language change and on "Check again". */
export function useCapabilities(platform: SpeechPlatform, locale: SpeechLocale): Capabilities {
  const [answers, setAnswers] = useState<Partial<Record<SpeechLocale, CapabilitiesState>>>({});
  const [round, setRound] = useState(0);

  useEffect(() => {
    let current = true;
    platform.capabilities(locale).then(
      (value) => {
        if (current) setAnswers((all) => ({ ...all, [locale]: { status: 'ready', value } }));
      },
      () => {
        if (current) setAnswers((all) => ({ ...all, [locale]: { status: 'failed' } }));
      },
    );
    return () => {
      current = false;
    };
  }, [platform, locale, round]);

  const refresh = useCallback(() => {
    setAnswers((all) => ({ ...all, [locale]: { status: 'loading' } }));
    setRound((n) => n + 1);
  }, [locale]);

  const download = useCallback(
    () => platform.downloadModel(locale).catch((): DownloadStatus => 'error'),
    [platform, locale],
  );

  const known: Partial<Record<SpeechLocale, SpeechCapabilities>> = {};
  for (const [key, answer] of Object.entries(answers) as [SpeechLocale, CapabilitiesState][]) {
    if (answer.status === 'ready') known[key] = answer.value;
  }
  return { state: answers[locale] ?? { status: 'loading' }, known, refresh, download };
}
