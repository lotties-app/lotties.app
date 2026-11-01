/*
 * The activities a widget button can log besides feed, diaper and sleep (docs/design/37-widgets-siri.md section 10).
 * Each entry is the key of a built-in event type; the widget sends the key in the outbox and the snapshot reports the
 * last time of each one.
 */
export const WIDGET_ACTIVITY_KEYS: readonly string[] = [
  'bath',
  'belly_massage',
  'tummy_time',
  'nasal_suction',
  'nail_trim',
  'skin_care',
  'outdoor',
  'fussy',
];
