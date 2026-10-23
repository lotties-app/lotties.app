import type { Receipt } from './nowText';

/** The illustration key (see `illustrationFor`) that goes with a toast receipt. */
export function receiptArt(receipt: Receipt): string {
  switch (receipt.kind) {
    case 'sleep':
      switch (receipt.action) {
        case 'fell_asleep':
          return receipt.sleepKind === 'night' ? 'night' : 'nap';
        case 'bedtime':
          return 'bedtime';
        case 'woke_up':
        case 'up_for_the_day':
          return 'woke_up';
        case 'night_waking':
          return 'night_waking';
        case 'back_asleep':
          return 'night';
      }
      return 'nap';
    case 'tray':
      switch (receipt.choice.kind) {
        case 'bottle':
          return 'bottle';
        case 'breast':
          return 'nursing';
        default:
          return receipt.choice.kind;
      }
    case 'cry_spell':
      return 'fussy';
    default:
      return 'nursing';
  }
}
