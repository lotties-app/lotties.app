import type { EventType } from '../db/models';
import { eventTypeText } from '../i18n/eventTypeText';
import { formatDuration, formatList, formatNumber, formatTime } from '../i18n/format';
import { volumeNumberText, volumeText } from '../units/display';
import { t } from '../i18n/i18n';
import type { UndoToken } from '../presets/actions';
import { formatPresetStatus } from '../presets/status';
import { MINUTE_MS, typeForKey } from './eventFacts';
import type { CatchUpGroup } from './catchUp';
import type { WhatWorkedChip } from './crySpell';
import type { BreastSide } from './nursing';
import type { QuickTile, TileId, TrayChoice } from './quickLog';
import type { SleepActionKind } from './sleepToggle';
import type { SleepKind } from './nowState';

/*
 * Localized texts of the Now logic (catalog namespace `now`). The logic stays language-free; these
 * helpers turn its results into words. Components calling them must also use `useTranslation()`
 * so they re-render on a language change.
 */

export function tileLabel(id: TileId): string {
  switch (id) {
    case 'feed':
      return t('now.tiles.feed');
    case 'diaper':
      return t('now.tiles.diaper');
    case 'meds':
      return t('now.tiles.meds');
    case 'more':
      return t('now.tiles.more');
  }
}

/** "Running 0:42", "Last 2h ago", "Not tracked today"; empty for More. */
export function formatTileStatus(tile: QuickTile, now: Date): string {
  if (tile.status === null) return '';
  // The nursing session, else a running bottle (the newest feed, still open): never "Running 0:00".
  const open = tile.last?.endedAt === null ? tile.last.startedAt : undefined;
  return formatPresetStatus(tile.status, now, tile.running?.startedAt ?? open);
}

export function sleepActionLabel(kind: SleepActionKind): string {
  switch (kind) {
    case 'fell_asleep':
      return t('now.sleepActions.fellAsleep');
    case 'bedtime':
      return t('now.sleepActions.bedtime');
    case 'woke_up':
      return t('now.sleepActions.wokeUp');
    case 'night_waking':
      return t('now.sleepActions.nightWaking');
    case 'up_for_the_day':
      return t('now.sleepActions.upForTheDay');
    case 'back_asleep':
      return t('now.sleepActions.backAsleep');
  }
}

/** Toast time-shift chip: "Now", "−10 min". */
export function shiftChipLabel(minutes: number): string {
  return minutes === 0 ? t('now.shift.now') : t('now.shift.minutesAgo', { minutes });
}

export const sideLabel = (side: BreastSide) =>
  side === 'left' ? t('now.sides.left') : t('now.sides.right');

/** The person of a catch-up group: the member's display name, else "Someone". */
export function catchUpName(group: Pick<CatchUpGroup, 'name'>): string {
  return group.name ?? t('now.catchUp.someone');
}

/** What a toast describes; the message follows the token's time after a shift. */
export type Receipt =
  | { kind: 'sleep'; action: SleepActionKind; sleepKind?: SleepKind }
  | { kind: 'tray'; choice: TrayChoice }
  | { kind: 'nursing_started'; side: BreastSide }
  | { kind: 'nursing_switched'; side: BreastSide }
  | { kind: 'nursing_stopped'; leftSeconds: number; rightSeconds: number }
  /** A crying spell from "Why is she crying?" with what worked. */
  | { kind: 'cry_spell'; chip: WhatWorkedChip };

/** The moment the token's events now carry: `at` minus the shift. */
export function tokenTime(token: Pick<UndoToken, 'at' | 'shiftMinutes'>): string | undefined {
  if (!token.at) return undefined;
  return new Date(Date.parse(token.at) - (token.shiftMinutes ?? 0) * MINUTE_MS).toISOString();
}

function sleepMessage(receipt: Extract<Receipt, { kind: 'sleep' }>, time: string): string {
  switch (receipt.action) {
    case 'fell_asleep':
      return receipt.sleepKind === 'night'
        ? t('now.toast.fellAsleepNight', { time })
        : t('now.toast.fellAsleepNap', { time });
    case 'bedtime':
      return t('now.toast.bedtime', { time });
    case 'woke_up':
    case 'up_for_the_day':
      return t('now.toast.wokeUp', { time });
    case 'night_waking':
      return t('now.toast.nightWaking', { time });
    case 'back_asleep':
      return t('now.toast.backAsleep', { time });
  }
}

function trayMessage(choice: TrayChoice, types: readonly EventType[]): string {
  switch (choice.kind) {
    case 'bottle':
      return choice.drunkMl !== undefined && choice.drunkMl < choice.amountMl
        ? t('feedingAmounts.toastBottle', {
            drunk: volumeNumberText(choice.drunkMl),
            prepared: volumeText(choice.amountMl),
          })
        : t('now.toast.bottle', { amount: volumeText(choice.amountMl) });
    case 'diaper': {
      const type = typeForKey(types, 'diaper');
      const content = type
        ? eventTypeText.optionLabel(type, { key: 'content' }, choice.content)
        : choice.content;
      return t('now.toast.diaper', { content });
    }
    case 'medication':
      return t('now.toast.medication', {
        names: formatList(choice.medications.map((m) => m.name)),
      });
    case 'belly_pain':
      return t('now.toast.bellyPain', { intensity: formatNumber(choice.intensity) });
    case 'breast':
      return t('now.toast.nursingStarted', { side: sideLabel(choice.side ?? 'left') });
  }
}

/** The toast line for a receipt ("Nap from 14:12", "Bottle · 120 ml"). */
export function receiptMessage(
  receipt: Receipt,
  token: Pick<UndoToken, 'at' | 'shiftMinutes'>,
  types: readonly EventType[],
): string {
  const at = tokenTime(token);
  const time = at ? formatTime(at) : '';
  switch (receipt.kind) {
    case 'sleep':
      return sleepMessage(receipt, time);
    case 'tray':
      return trayMessage(receipt.choice, types);
    case 'nursing_started':
      return t('now.toast.nursingStarted', { side: sideLabel(receipt.side) });
    case 'nursing_switched':
      return t('now.toast.nursingSwitched', { side: sideLabel(receipt.side) });
    case 'nursing_stopped':
      return t('now.toast.nursingStopped', {
        left: formatDuration(receipt.leftSeconds * 1000),
        right: formatDuration(receipt.rightSeconds * 1000),
      });
    case 'cry_spell':
      return t('cryReasons.toast', { helped: whatWorkedLabel(receipt.chip) });
  }
}

/** The label of a "What worked?" chip ("Held", "Nothing yet"). */
export function whatWorkedLabel(chip: WhatWorkedChip): string {
  return t(`cryReasons.worked.options.${chip}`);
}
