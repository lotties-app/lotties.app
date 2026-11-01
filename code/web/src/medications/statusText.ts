import { formatTime } from '../i18n/format';
import { t } from '../i18n/i18n';
import { clockWithDay } from '../predictions/predictionModel';
import { dayPartList, dayPartName, thisDayPart } from './dayPartText';
import { dayText } from './prescriptionForm';
import type { DayPartsStatus, MedicationStatus } from './statusCalculator';

/*
 * The words for a prescription's computed state ("Available at 18:00", "Due now", "2 of 3 doses
 * today", "Morning: due until 12:00 · 0 of 2 today", "Course ended") and for the early-dose
 * question. Pure over the calculator's output.
 */

export type StateTone = 'ok' | 'wait' | 'due' | 'ended';

export interface StateLine {
  text: string;
  tone: StateTone;
}

const futureAvailability = (status: MedicationStatus, now: Date) =>
  status.availableAt !== null && status.availableAt.getTime() > now.getTime();

function progressText(status: MedicationStatus): string | null {
  const p = status.prescription;
  const parts = status.dayParts;
  if (parts && parts.parts.length > 0) {
    return t('medications.state.partsToday', { done: parts.givenCount, total: parts.parts.length });
  }
  const slots = p.timesOfDay?.length ?? 0;
  if (slots > 1) {
    return t('medications.state.dosesToday', {
      done: Math.min(status.dosesToday, slots),
      total: slots,
    });
  }
  if (p.maxDosesPer24h !== null) {
    return t('medications.state.dosesIn24h', {
      done: status.dosesLast24h,
      total: p.maxDosesPer24h,
    });
  }
  return null;
}

function clock(date: Date, now: Date) {
  return clockWithDay(date.toISOString(), now);
}

/** A part-of-the-day prescription: the open part ("due until"), else the next one ("from"). */
function partsLine(parts: DayPartsStatus, progress: string | null, now: Date): StateLine {
  const join = (...items: (string | null)[]) => items.filter(Boolean).join(' · ');
  const current = parts.current;
  if (current?.state === 'due') {
    const text = t('medications.state.partDue', {
      part: dayPartName(current.part),
      time: clock(current.end, now),
    });
    return { text: join(text, progress), tone: 'due' };
  }
  const next = parts.next;
  const nextText = next
    ? t('medications.state.partNext', {
        part: dayPartName(next.part),
        time: clock(next.start, now),
      })
    : null;
  return { text: join(nextText, progress) || t('medications.state.courseEnded'), tone: 'wait' };
}

/** The state of a prescription in a few words, and how it should look (tone). */
export function stateLine(status: MedicationStatus, now: Date): StateLine {
  const p = status.prescription;
  if (status.courseEnded) return { text: t('medications.state.courseEnded'), tone: 'ended' };
  if (!status.courseStarted) {
    return { text: t('medications.state.startsOn', { date: dayText(p.startDate) }), tone: 'wait' };
  }
  const progress = progressText(status);
  const join = (...parts: (string | null)[]) => parts.filter(Boolean).join(' · ');
  if (futureAvailability(status, now)) {
    const label = status.limitReached
      ? t('medications.state.limitReached', { time: clock(status.availableAt!, now) })
      : t('medications.state.availableAt', { time: clock(status.availableAt!, now) });
    return { text: join(label, progress), tone: 'wait' };
  }
  if (status.dayParts) return partsLine(status.dayParts, progress, now);
  if (status.overdueByMinutes !== null) {
    return { text: join(t('medications.state.dueNow'), progress), tone: 'due' };
  }
  if (p.kind === 'scheduled' && status.nextScheduledAt) {
    return {
      text: join(
        t('medications.state.nextAt', { time: clock(status.nextScheduledAt, now) }),
        progress,
      ),
      tone: 'ok',
    };
  }
  return { text: join(t('medications.state.availableNow'), progress), tone: 'ok' };
}

/** A prescription with its medication's name, for the tile line. */
export interface NamedStatus {
  status: MedicationStatus;
  name: string;
}

/** A short line for the tile: the most urgent state among the active prescriptions. */
export function tileStateLine(items: readonly NamedStatus[], now: Date): StateLine | null {
  const lines = items.map((item) => ({ ...item, line: stateLine(item.status, now) }));
  const due = lines.find((l) => l.line.tone === 'due');
  if (due) return { text: t('medications.state.dueNowNamed', { name: due.name }), tone: 'due' };
  const ready = lines.filter((l) => l.line.tone === 'ok');
  if (ready.length > 0) {
    return { text: t('medications.state.readyCount', { count: ready.length }), tone: 'ok' };
  }
  const waiting = lines
    .filter((l) => l.line.tone === 'wait' && futureAvailability(l.status, now))
    .sort((a, b) => a.status.availableAt!.getTime() - b.status.availableAt!.getTime());
  if (waiting[0]) {
    return {
      text: t('medications.state.nextAllowed', {
        time: clock(waiting[0].status.availableAt!, now),
      }),
      tone: 'wait',
    };
  }
  return null;
}

export type EarlyKind = 'wait' | 'limit' | 'ended' | 'notStarted' | 'partGiven' | 'outsideParts';

export interface EarlyWarning {
  kind: EarlyKind;
  /** "Too early: next allowed at 18:00. Log anyway?" */
  text: string;
}

/**
 * Whether logging a dose now is outside what the prescription allows, and the question to ask
 * the parent. Never a block: "Log anyway" records `override: true`.
 */
export function earlyWarning(status: MedicationStatus, now: Date): EarlyWarning | null {
  if (status.courseEnded) {
    return {
      kind: 'ended',
      text: t('medications.early.ended', { date: dayText(status.prescription.endDate ?? '') }),
    };
  }
  if (!status.courseStarted) {
    return {
      kind: 'notStarted',
      text: t('medications.early.notStarted', { date: dayText(status.prescription.startDate) }),
    };
  }
  if (!futureAvailability(status, now)) return partWarning(status);
  const time = clock(status.availableAt!, now);
  return status.limitReached
    ? { kind: 'limit', text: t('medications.early.limit', { time }) }
    : { kind: 'wait', text: t('medications.early.wait', { time }) };
}

/**
 * A part-of-the-day prescription: "Already given this morning at 08:12. Log another dose anyway?"
 * or, outside every chosen part, "Not one of the prescribed parts of the day (Morning). Log
 * anyway?". Same pattern as an early dose: never a block, recorded as `override`.
 */
function partWarning(status: MedicationStatus): EarlyWarning | null {
  const parts = status.dayParts;
  if (!parts || parts.guard === 'none') return null;
  if (parts.guard === 'alreadyGiven' && parts.current) {
    return {
      kind: 'partGiven',
      text: t('medications.early.partGiven', {
        when: thisDayPart(parts.current.part),
        time: formatTime(parts.current.givenAt ?? parts.current.start),
      }),
    };
  }
  return {
    kind: 'outsideParts',
    text: t('medications.early.outsideParts', {
      parts: dayPartList(status.prescription.dayParts ?? []),
    }),
  };
}

/** `HH:mm` of a Date in the app language (re-exported for the tray's availability line). */
export const timeText = (date: Date) => formatTime(date);
