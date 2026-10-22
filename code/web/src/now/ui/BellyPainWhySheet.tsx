import { PatternWhySheet, type PatternWhySheetProps } from './PatternWhySheet';

/**
 * "Why?" of the belly pain suggestion: the usual window, the rule in plain words, the days and
 * times it comes from (newest first), and that it is a pattern from the log, not medical advice.
 */
export function BellyPainWhySheet(props: PatternWhySheetProps) {
  return <PatternWhySheet section="bellyPattern" {...props} />;
}
