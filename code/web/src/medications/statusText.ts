import { formatTime } from '../i18n/format';
import { t } from '../i18n/i18n';
import { clockWithDay } from '../predictions/predictionModel';
import { dayText } from './prescriptionForm';
import type { MedicationStatus } from './statusCalculator';

/*
 * The words for a prescription's computed state ("Available at 18:00", "Due now", "2 of 3 doses
 * today", "Course ended") and for the early-dose question. Pure over the calculator's output.
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

export type EarlyKind = 'wait' | 'limit' | 'ended' | 'notStarted';

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
  if (!futureAvailability(status, now)) return null;
  const time = clock(status.availableAt!, now);
  return status.limitReached
    ? { kind: 'limit', text: t('medications.early.limit', { time }) }
    : { kind: 'wait', text: t('medications.early.wait', { time }) };
}

/** `HH:mm` of a Date in the app language (re-exported for the tray's availability line). */
export const timeText = (date: Date) => formatTime(date);
