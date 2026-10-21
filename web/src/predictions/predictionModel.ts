import type { EventType } from '../db/models';
import { catalogText } from '../i18n/catalog';
import { eventTypeText } from '../i18n/eventTypeText';
import { formatDuration, formatTime } from '../i18n/format';
import { t } from '../i18n/i18n';
import type { BedTimeDto, PredictionDto } from '../sync/contract';
import { localDayKey } from '../timeline/timelineModel';

/** The baby's own type wins over a built-in template with the same key. */
export function typeForKey(types: EventType[], key: string, babyId: string): EventType | undefined {
  const matches = types.filter((type) => type.key === key);
  return matches.find((type) => type.babyId === babyId) ?? matches[0];
}

export function typeNameForKey(types: EventType[], key: string, babyId: string): string {
  const type = typeForKey(types, key, babyId);
  return type ? eventTypeText.typeName(type) : key.replace(/_/g, ' ');
}

function dayOffset(iso: string, now: Date): number {
  const [y, m, d] = localDayKey(iso).split('-').map(Number);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((new Date(y, m - 1, d).getTime() - today.getTime()) / 86_400_000);
}

/** `14:20`, or with a day hint when not today: `tomorrow 02:10`, `yesterday 23:50`. */
export function clockWithDay(iso: string, now: Date): string {
  const offset = dayOffset(iso, now);
  const time = formatTime(iso);
  if (offset === 0) return time;
  if (offset === 1) return t('predictions.tomorrow', { time });
  if (offset === -1) return t('predictions.yesterday', { time });
  return `${localDayKey(iso)} ${time}`;
}

/** `around 14:20, between 14:05 and 14:40` (local time). */
export function describeWindow(prediction: PredictionDto, now: Date): string {
  const { earliest, expected, latest } = prediction.nextStart;
  return t('predictions.window', {
    expected: clockWithDay(expected, now),
    earliest: clockWithDay(earliest, now),
    latest: clockWithDay(latest, now),
  });
}

/** The expected start has passed without a new event replacing the prediction. */
export function isOverdue(prediction: PredictionDto, now: Date): boolean {
  return Date.parse(prediction.nextStart.expected) < now.getTime();
}

export function describeDuration(prediction: PredictionDto): string | null {
  const duration = prediction.expectedDuration;
  return duration
    ? t('predictions.duration', { duration: formatDuration(duration.minutes * 60_000) })
    : null;
}

const MINUTE_MS = 60_000;

/** Structured parts of the server's `basis` (API `PredictionBasisResponse`), validated. */
interface Basis {
  kind: 'StartInterval' | 'AwakeWindow';
  medianGapMinutes: number;
  lookBackDays: number;
  ageBand: string | null;
  dayPhase: 'day' | 'night' | null;
  assumesEventInProgressEnds: boolean;
}

function readBasis(raw: Record<string, unknown> | undefined): Basis | null {
  if (!raw) return null;
  const { medianGapMinutes, lookBackDays } = raw;
  if (typeof medianGapMinutes !== 'number' || typeof lookBackDays !== 'number') return null;
  return {
    kind: raw.kind === 'AwakeWindow' ? 'AwakeWindow' : 'StartInterval',
    medianGapMinutes,
    lookBackDays,
    ageBand: typeof raw.ageBand === 'string' ? raw.ageBand : null,
    dayPhase: raw.dayPhase === 'day' || raw.dayPhase === 'night' ? raw.dayPhase : null,
    assumesEventInProgressEnds: raw.assumesEventInProgressEnds === true,
  };
}

/**
 * The "Why?" text, built from the structured `basis` and sample counts in the active language.
 * The server's English `reason` is only a fallback for responses without a usable basis.
 */
export function describeReason(prediction: PredictionDto): string {
  const basis = readBasis(prediction.basis);
  if (!basis) return prediction.reason;

  const gap = formatDuration(basis.medianGapMinutes * MINUTE_MS);
  const gapSentence =
    basis.kind === 'AwakeWindow'
      ? t('predictions.basis.awakeWindow', { gap, count: basis.lookBackDays })
      : t('predictions.basis.startInterval', { gap, count: basis.lookBackDays });
  const sentences = [
    gapSentence,
    t('predictions.basis.samples', { count: prediction.sampleCount }),
  ];
  if (basis.dayPhase) {
    sentences.push(
      basis.dayPhase === 'day'
        ? t('predictions.basis.phaseDay')
        : t('predictions.basis.phaseNight'),
    );
  }
  if (basis.ageBand) {
    const band = catalogText('predictions', 'basis', 'ageBands', basis.ageBand) ?? basis.ageBand;
    sentences.push(t('predictions.basis.ageBand', { band }));
  }
  if (prediction.expectedDuration) {
    sentences.push(
      t('predictions.basis.typicalDuration', {
        duration: formatDuration(prediction.expectedDuration.minutes * MINUTE_MS),
        count: prediction.expectedDuration.sampleCount,
      }),
    );
  }
  if (basis.assumesEventInProgressEnds) sentences.push(t('predictions.basis.inProgress'));
  return sentences.join(' ');
}

/** The bed time clock as the server's `basis` states it (`BedTimeClock`), validated. */
interface BedTimeBasis {
  medianClock: string;
  recentBedTimeCount: number;
  lookBackDays: number;
}

function readBedTimeBasis(raw: Record<string, unknown> | undefined): BedTimeBasis | null {
  if (!raw || raw.kind !== 'BedTimeClock') return null;
  const { medianClock, recentBedTimeCount, lookBackDays } = raw;
  if (typeof medianClock !== 'string' || !/^\d{2}:\d{2}$/.test(medianClock)) return null;
  return {
    medianClock,
    recentBedTimeCount: typeof recentBedTimeCount === 'number' ? recentBedTimeCount : 0,
    lookBackDays: typeof lookBackDays === 'number' ? lookBackDays : 0,
  };
}

/** `Bedtime around 19:50` (the expected start, local time). */
export function describeBedTime(bedTime: BedTimeDto, now: Date): string {
  return t('predictions.bedtime.line', { time: clockWithDay(bedTime.nextStart.expected, now) });
}

/** The "Why?" text of the bed time: the usual clock and how many recent nights it comes from. */
export function describeBedTimeReason(bedTime: BedTimeDto, now: Date): string {
  const basis = readBedTimeBasis(bedTime.basis);
  if (!basis) return bedTime.reason;
  const [h, m] = basis.medianClock.split(':').map(Number);
  const sentences = [
    t('predictions.bedtime.basis', {
      clock: formatTime(new Date(2000, 0, 1, h, m)),
      count: basis.recentBedTimeCount || bedTime.sampleCount,
    }),
    t('predictions.bedtime.window', {
      earliest: clockWithDay(bedTime.nextStart.earliest, now),
      latest: clockWithDay(bedTime.nextStart.latest, now),
    }),
  ];
  if (bedTime.expectedDuration) {
    sentences.push(
      t('predictions.basis.typicalDuration', {
        duration: formatDuration(bedTime.expectedDuration.minutes * MINUTE_MS),
        count: bedTime.expectedDuration.sampleCount,
      }),
    );
  }
  return sentences.join(' ');
}
