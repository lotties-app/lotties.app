import type { DayPart } from '../db/models';
import { formatList, formatTime } from '../i18n/format';
import { t } from '../i18n/i18n';
import { clockWithDay } from '../predictions/predictionModel';
import { DAY_PART_STARTS, dayPartEnd } from './dayParts';
import type { DayPartSlot } from './statusCalculator';

/*
 * The words for parts of the day: names ("Morning" / "Manhã"), phrases for the rule summary ("in
 * the morning" / "de manhã"), windows ("05:00-12:00") and the state of one part on the Meds tray
 * ("Given at 08:12", "Due until 05:00"). Pure over the calculator's output.
 */

/** A local `HH:mm` in the app language. */
export function clockText(time: string): string {
  const [h, m] = time.split(':').map(Number);
  return formatTime(new Date(2000, 0, 1, h, m));
}

/** "Morning" ("Manhã"). */
export function dayPartName(part: DayPart): string {
  return t(`medications.dayPart.name.${part}`);
}

/** "in the morning" ("de manhã"), for the rule summary. */
export function dayPartPhrase(part: DayPart): string {
  return t(`medications.dayPart.phrase.${part}`);
}

/** "this morning" / "tonight" ("nesta manhã"), for the second-dose question. */
export function thisDayPart(part: DayPart): string {
  return t(`medications.dayPart.this.${part}`);
}

/** "Morning 05:00–12:00": the part and its window in the app language. */
export function dayPartWithWindow(part: DayPart): string {
  return t('medications.dayPart.withWindow', {
    part: dayPartName(part),
    start: clockText(DAY_PART_STARTS[part]),
    end: clockText(dayPartEnd(part)),
  });
}

/** "Morning and Night". */
export function dayPartList(parts: readonly DayPart[]): string {
  return formatList(parts.map(dayPartName));
}

/** "Given at 08:12", "Due until 05:00", "From 22:00", "Not logged". */
export function slotStateText(slot: DayPartSlot, now: Date): string {
  switch (slot.state) {
    case 'given':
      return t('medications.parts.given', { time: formatTime(slot.givenAt ?? slot.start) });
    case 'due':
      return t('medications.parts.due', { time: clockWithDay(slot.end.toISOString(), now) });
    case 'upcoming':
      return t('medications.parts.upcoming', { time: clockWithDay(slot.start.toISOString(), now) });
    default:
      return t('medications.parts.missed');
  }
}
