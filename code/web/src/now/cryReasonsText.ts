import { formatDuration, formatTime } from '../i18n/format';
import { t } from '../i18n/i18n';
import type { CryCause, CryFact, CryLevel, RedFlagKey } from './cryReasons';
import { MINUTE_MS } from './eventFacts';

/*
 * Words of "Why is she crying?" (catalog `cryReasons`, docs/design/27-cry-reasons.md section 9).
 * Every sentence is built from one structured fact of the ranking with interpolation; nothing is
 * inferred here. Components calling these must also use `useTranslation()` (language changes).
 */

/** At most this many fact sentences under a cause (the most telling come first). */
const MAX_FACTS = 2;

export const causeName = (cause: CryCause) => t(`cryReasons.suggests.causes.${cause}`);

export const levelLabel = (level: CryLevel) => t(`cryReasons.suggests.levels.${level}`);

export const tryText = (cause: CryCause) => t(`cryReasons.suggests.try.${cause}`);

export const redFlagText = (flag: RedFlagKey) => t(`cryReasons.redFlags.${flag}`);

const duration = (minutes: number) => formatDuration(Math.max(0, minutes) * MINUTE_MS);

/** One sentence for one fact. */
export function factSentence(fact: CryFact): string {
  switch (fact.kind) {
    case 'sinceLastFeed':
      if (fact.smallerFeed) {
        return t('cryReasons.suggests.facts.sinceLastFeedSmaller', {
          since: duration(fact.minutes),
        });
      }
      return fact.usualGapMinutes === null
        ? t('cryReasons.suggests.facts.sinceLastFeed', { since: duration(fact.minutes) })
        : t('cryReasons.suggests.facts.sinceLastFeedUsual', {
            since: duration(fact.minutes),
            usual: duration(fact.usualGapMinutes),
          });
    case 'feedingNow':
      return t('cryReasons.suggests.facts.feedingNow', { since: duration(fact.minutes) });
    case 'awakeFor':
      return fact.windowMinutes === null
        ? t('cryReasons.suggests.facts.awakeFor', { since: duration(fact.minutes) })
        : t('cryReasons.suggests.facts.awakeForUsual', {
            since: duration(fact.minutes),
            usual: duration(fact.windowMinutes),
          });
    case 'nightTime':
      return t('cryReasons.suggests.facts.nightTime');
    case 'sinceLastDiaper':
      return fact.usualGapMinutes === null
        ? t('cryReasons.suggests.facts.sinceLastDiaper', { since: duration(fact.minutes) })
        : t('cryReasons.suggests.facts.sinceLastDiaperUsual', {
            since: duration(fact.minutes),
            usual: duration(fact.usualGapMinutes),
          });
    case 'dirtyDue':
      return fact.signal === 'afterFeed'
        ? t('cryReasons.suggests.facts.dirtyDueAfterFeed')
        : t('cryReasons.suggests.facts.dirtyDueGap', { time: formatTime(fact.expectedAt) });
    case 'recentFeedNoBurp':
      return t('cryReasons.suggests.facts.recentFeedNoBurp', {
        since: duration(fact.minutesSinceFeed),
      });
    case 'reliefAfterFeed':
      return t('cryReasons.suggests.facts.reliefAfterFeed', {
        since: duration(fact.minutesSinceFeed),
      });
    case 'bellyPattern':
      return t('cryReasons.suggests.facts.bellyPattern', { time: fact.typicalClock });
    case 'eveningFussy':
      return fact.typicalClock === null
        ? t('cryReasons.suggests.facts.eveningFussy')
        : t('cryReasons.suggests.facts.eveningFussyPattern', { time: fact.typicalClock });
    case 'noData':
      return fact.reason === 'asleep'
        ? t('cryReasons.suggests.facts.asleep')
        : t('cryReasons.suggests.facts.noLog');
  }
}

/** The sentences under a cause: one per fact, at most two. */
export function factSentences(facts: readonly CryFact[]): string[] {
  return facts.slice(0, MAX_FACTS).map(factSentence);
}
