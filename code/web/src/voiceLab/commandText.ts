import { t } from '../i18n/i18n';
import type { Locale } from '../i18n/config';
import { formatNumber } from '../i18n/format';
import { formatVolume } from '../units/format';
import type { HandsFreeCommand, ParseResult } from '../voice/commandParser';
import type { LabExpectation } from './labPhrases';

/*
 * The voice lab's words for commands and parse results (catalog voiceLab.*). Amounts are shown in ml,
 * the value the measures compare (storage is metric).
 */

const amount = (ml: number, locale: Locale) => formatVolume(ml, 'metric', locale);

export function commandText(command: HandsFreeCommand, locale: Locale): string {
  switch (command.kind) {
    case 'bottle': {
      const values = { amount: amount(command.amountMl, locale), lng: locale };
      if (command.content === 'formula') return t('voiceLab.command.bottleFormula', values);
      if (command.content === 'breast_milk') return t('voiceLab.command.bottleBreastMilk', values);
      return t('voiceLab.command.bottle', values);
    }
    case 'nursing_start':
      if (command.side === 'left') return t('voiceLab.command.nursingLeft', { lng: locale });
      if (command.side === 'right') return t('voiceLab.command.nursingRight', { lng: locale });
      return t('voiceLab.command.nursingStart', { lng: locale });
    case 'nursing_stop':
      return t('voiceLab.command.nursingStop', { lng: locale });
    case 'sleep_start':
      return t('voiceLab.command.sleepStart', { lng: locale });
    case 'sleep_end':
      return t('voiceLab.command.sleepEnd', { lng: locale });
    case 'diaper':
      if (command.diaper === 'wet') return t('voiceLab.command.diaperWet', { lng: locale });
      if (command.diaper === 'dirty') return t('voiceLab.command.diaperDirty', { lng: locale });
      return t('voiceLab.command.diaperBoth', { lng: locale });
    case 'ask_milk_today':
      return t('voiceLab.command.askMilkToday', { lng: locale });
    case 'ask_last_feed':
      return t('voiceLab.command.askLastFeed', { lng: locale });
  }
}

export function expectationText(expected: LabExpectation, locale: Locale): string {
  if (expected.type === 'command') return commandText(expected.command, locale);
  return expected.outcome === 'needs_amount'
    ? t('voiceLab.outcome.needsAmount', { lng: locale })
    : t('voiceLab.outcome.nothing', { lng: locale });
}

export function resultText(result: ParseResult, locale: Locale): string {
  switch (result.outcome) {
    case 'command':
      return commandText(result.command, locale);
    case 'needs_amount':
      return t('voiceLab.outcome.needsAmount', { lng: locale });
    case 'out_of_range':
      return t('voiceLab.outcome.outOfRange', {
        amount: amount(result.amountMl, locale),
        lng: locale,
      });
    case 'ambiguous':
      return t('voiceLab.outcome.ambiguous', { lng: locale });
    case 'not_understood':
      return t('voiceLab.outcome.notUnderstood', {
        reason: t(`voiceLab.reason.${result.reason}`, { lng: locale }),
        lng: locale,
      });
  }
}

/**
 * What Lotties would do with what was heard, for the free try ("Try it"): always in the conditional,
 * because the voice test never logs anything.
 */
export function wouldDoText(result: ParseResult, locale: Locale): string {
  switch (result.outcome) {
    case 'command':
      if (result.command.kind === 'ask_milk_today' || result.command.kind === 'ask_last_feed') {
        return t(`voiceLab.tryIt.wouldAnswer.${result.command.kind}`, { lng: locale });
      }
      return t('voiceLab.tryIt.wouldLog', {
        command: commandText(result.command, locale),
        lng: locale,
      });
    case 'needs_amount':
      return t('voiceLab.tryIt.needsAmount', { lng: locale });
    case 'out_of_range':
      return t('voiceLab.tryIt.outOfRange', {
        amount: amount(result.amountMl, locale),
        lng: locale,
      });
    case 'ambiguous':
      return t('voiceLab.tryIt.ambiguous', { lng: locale });
    case 'not_understood':
      return t('voiceLab.tryIt.notUnderstood', {
        reason: t(`voiceLab.reason.${result.reason}`, { lng: locale }),
        lng: locale,
      });
  }
}

/** `1.24 s`. */
export const secondsText = (ms: number, locale: Locale) =>
  t('voiceLab.seconds', {
    value: formatNumber(ms / 1000, { maximumFractionDigits: 2 }, locale),
    lng: locale,
  });

/** `92 %`. */
export const percentText = (ratio: number, locale: Locale) =>
  formatNumber(ratio, { style: 'percent', maximumFractionDigits: 0 }, locale);
