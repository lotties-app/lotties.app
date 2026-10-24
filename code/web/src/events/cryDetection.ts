import type { BabyEvent } from '../db/models';
import { getOwn } from '../util/ownProperty';

/*
 * The cry monitor's marks on a fussy spell (docs/design/31-cry-detector-spike.md section 8, the hidden
 * booleans of the built-in `fussy` type, migration CryDetector): `auto_detected` (the monitor started
 * it) and `cry_confirmed` (the parent's answer: true = "Yes, crying", false = "Not crying", absent until
 * answered). Language-free and pure; payload members are read as own properties only.
 */

export const AUTO_DETECTED_KEY = 'auto_detected';
export const CRY_CONFIRMED_KEY = 'cry_confirmed';

/** Whether the cry monitor started this spell. */
export function isAutoDetected(event: Pick<BabyEvent, 'payload'>): boolean {
  return getOwn(event.payload, AUTO_DETECTED_KEY) === true;
}

/** The parent's answer: `true` crying, `false` not crying, `null` not answered (or not a boolean). */
export function cryAnswer(event: Pick<BabyEvent, 'payload'>): boolean | null {
  const value = getOwn(event.payload, CRY_CONFIRMED_KEY);
  return typeof value === 'boolean' ? value : null;
}

/**
 * Whether the spell counts as crying for patterns, outcome statistics and crying totals: every spell
 * except one a parent marked "Not crying" (that one stays as a record, but it was a false alarm).
 */
export function countsAsCrying(event: Pick<BabyEvent, 'payload'>): boolean {
  return cryAnswer(event) !== false;
}
