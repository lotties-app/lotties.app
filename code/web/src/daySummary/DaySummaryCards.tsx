import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Card, Typography } from '@mui/material';
import type { EventType } from '../db/models';
import { eventTypeIconName } from '../events/iconRegistry';
import { formatDuration, formatNumber, formatTime } from '../i18n/format';
import { useEventTypeText } from '../i18n/eventTypeText';
import { shownMilk } from '../now/milkToday';
import type { CategoryName } from '../theme/tokens';
import { useUnits } from '../units/useUnits';
import { CategoryIcon } from '../ui/CategoryIcon';
import type { IconName } from '../ui/icons';
import type {
  CryingDay,
  DiaperDayCounts,
  FeedingDay,
  HealthDay,
  SleepDay,
  Usual,
} from './daySummaryModel';

/*
 * The cards of the Day summary: a thin view over `DaySummary`. Each card has the category stamp
 * and a serif title, a big serif number, a few plain lines and, when there are enough recorded
 * days, one "usual" line with the same baby's own average (no arrow, colour or judging word).
 */

const duration = (ms: number) => formatDuration(ms);
/** One decimal at most, as a number for the plural rules and `{{count, number}}`. */
const roundOne = (value: number) => Math.round(value * 10) / 10;

function DayCard({
  icon,
  category,
  title,
  headline,
  children,
  name,
}: {
  icon: IconName;
  category: CategoryName;
  title: string;
  headline?: string;
  children?: ReactNode;
  /** `data-day-card`, for tests and the showcase. */
  name: string;
}) {
  const titleId = useId();
  return (
    <Card
      component="section"
      aria-labelledby={titleId}
      data-day-card={name}
      sx={{ p: 2, display: 'grid', gap: 1, alignContent: 'start', minWidth: 0 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
        <CategoryIcon name={icon} category={category} size={16} />
        <Typography id={titleId} variant="h6" component="h3" sx={{ minWidth: 0 }}>
          {title}
        </Typography>
      </Box>
      {headline && (
        <Typography
          variant="h4"
          component="p"
          sx={{
            m: 0,
            lineHeight: 1.15,
            fontWeight: 400,
            fontVariantNumeric: 'tabular-nums',
            overflowWrap: 'anywhere',
          }}
        >
          {headline}
        </Typography>
      )}
      {children}
    </Card>
  );
}

function Line({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <Typography
      variant="body2"
      color={muted ? 'text.secondary' : 'text.primary'}
      sx={{ overflowWrap: 'anywhere' }}
    >
      {children}
    </Typography>
  );
}

/** "Usual by this time: 9h 40m (average of 5 days)" (today) or "Usual per day: ..." (a past day). */
function UsualLine({
  usual,
  isToday,
  value,
}: {
  usual: Usual | null;
  isToday: boolean;
  value: (mean: number) => string;
}) {
  const { t } = useTranslation();
  if (!usual) return null;
  const options = { value: value(usual.value), count: usual.days };
  return (
    <Typography variant="caption" color="text.secondary" component="p" data-usual>
      {isToday ? t('daySummary.usualByNow', options) : t('daySummary.usualPerDay', options)}
    </Typography>
  );
}

export function SleepDayCard({ sleep, isToday }: { sleep: SleepDay; isToday: boolean }) {
  const { t } = useTranslation();
  const parts: string[] = [];
  if (sleep.nightMs !== null)
    parts.push(t('daySummary.sleep.night', { duration: duration(sleep.nightMs) }));
  if (sleep.naps.count > 0) {
    parts.push(
      t('daySummary.sleep.naps', { count: sleep.naps.count, duration: duration(sleep.naps.ms) }),
    );
  }
  const breakdown =
    parts.length === 2 ? t('daySummary.parts', { first: parts[0], second: parts[1] }) : parts[0];
  return (
    <DayCard
      name="sleep"
      icon="moon"
      category="sleep"
      title={t('daySummary.sleep.title')}
      headline={duration(sleep.totalMs)}
    >
      {breakdown && <Line>{breakdown}</Line>}
      {sleep.naps.longestMs !== null && (
        <Line muted>
          {t('daySummary.sleep.longestNap', { duration: duration(sleep.naps.longestMs) })}
        </Line>
      )}
      {sleep.current && (
        <Line>
          {sleep.current.state === 'asleep'
            ? t('daySummary.sleep.asleepFor', { duration: duration(sleep.current.ms) })
            : t('daySummary.sleep.awakeFor', { duration: duration(sleep.current.ms) })}
        </Line>
      )}
      <UsualLine usual={sleep.usual} isToday={isToday} value={duration} />
    </DayCard>
  );
}

export function FeedingDayCard({ feeding, isToday }: { feeding: FeedingDay; isToday: boolean }) {
  const { t } = useTranslation();
  const units = useUnits();
  const shown = feeding.milk ? shownMilk(feeding.milk, units.system) : null;
  const feeds = t('daySummary.feeding.feeds', { count: feeding.feeds });
  const prepared = shown
    ? t('daySummary.feeding.prepared', { volume: units.formatVolume(shown.preparedMl) })
    : null;
  const notDrunk =
    shown && shown.notDrunkMl > 0
      ? t('daySummary.feeding.notDrunk', { volume: units.formatVolume(shown.notDrunkMl) })
      : null;
  const breast = feeding.breast;
  return (
    <DayCard
      name="feeding"
      icon="bottle"
      category="feeding"
      title={t('daySummary.feeding.title')}
      headline={
        shown ? t('daySummary.feeding.drunk', { volume: units.formatVolume(shown.drunkMl) }) : feeds
      }
    >
      {prepared && (
        <Line muted>
          {notDrunk ? t('daySummary.parts', { first: prepared, second: notDrunk }) : prepared}
        </Line>
      )}
      {shown && <Line>{feeds}</Line>}
      {breast && (
        <Line>
          {breast.hasSides
            ? t('daySummary.feeding.breastSides', {
                duration: duration(breast.totalMs),
                left: duration(breast.leftMs),
                right: duration(breast.rightMs),
              })
            : t('daySummary.feeding.breast', { duration: duration(breast.totalMs) })}
        </Line>
      )}
      {feeding.lastFeedAt && (
        <Line muted>
          {t('daySummary.feeding.lastFeed', { time: formatTime(feeding.lastFeedAt) })}
        </Line>
      )}
      <UsualLine
        usual={feeding.usual}
        isToday={isToday}
        value={(mean) =>
          feeding.usualMetric === 'ml'
            ? units.formatVolume(Math.round(mean))
            : t('daySummary.feeding.feeds', { count: roundOne(mean) })
        }
      />
    </DayCard>
  );
}

export function DiaperDayCard({
  diapers,
  isToday,
}: {
  diapers: DiaperDayCounts;
  isToday: boolean;
}) {
  const { t } = useTranslation();
  return (
    <DayCard
      name="diapers"
      icon="diaper"
      category="diaper"
      title={t('daySummary.diapers.title')}
      headline={t('daySummary.diapers.count', { count: diapers.total })}
    >
      {diapers.hasContent && (
        <Line>{t('daySummary.diapers.split', { wet: diapers.wet, dirty: diapers.dirty })}</Line>
      )}
      {diapers.mixed > 0 && <Line muted>{t('insights.diapers.mixedNote')}</Line>}
      <UsualLine
        usual={diapers.usual}
        isToday={isToday}
        value={(mean) => t('daySummary.diapers.count', { count: roundOne(mean) })}
      />
    </DayCard>
  );
}

export function CryingDayCard({ crying, isToday }: { crying: CryingDay; isToday: boolean }) {
  const { t } = useTranslation();
  return (
    <DayCard
      name="crying"
      icon={eventTypeIconName('sentiment_very_dissatisfied')}
      category="care"
      title={t('daySummary.crying.title')}
      headline={t('daySummary.crying.spells', { count: crying.spells })}
    >
      {crying.totalMs !== null && (
        <Line>{t('daySummary.crying.total', { duration: duration(crying.totalMs) })}</Line>
      )}
      <UsualLine
        usual={crying.usual}
        isToday={isToday}
        value={(mean) => t('daySummary.crying.spells', { count: roundOne(mean) })}
      />
    </DayCard>
  );
}

export function HealthDayCard({
  health,
  types,
}: {
  health: HealthDay;
  types: readonly EventType[];
}) {
  const { t } = useTranslation();
  const units = useUnits();
  const text = useEventTypeText();
  const typeById = new Map(types.map((type) => [type.id, type]));
  return (
    <DayCard name="health" icon="heart" category="health" title={t('daySummary.health.title')}>
      <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 0.5 }}>
        {health.temperature && (
          <li>
            <Line>
              {t('daySummary.health.temperature', {
                value: units.formatTemperature(health.temperature.valueC),
                time: formatTime(health.temperature.at),
              })}
            </Line>
          </li>
        )}
        {health.medicationDoses > 0 && (
          <li>
            <Line>{t('daySummary.health.doses', { count: health.medicationDoses })}</Line>
          </li>
        )}
        {health.others.map((kind) => {
          const type = typeById.get(kind.typeId);
          if (!type) return null;
          const name = text.typeName(type);
          return (
            <li key={kind.typeId}>
              <Line>
                {kind.durationMs !== null
                  ? t('daySummary.health.kindTimed', {
                      name,
                      number: formatNumber(kind.count),
                      duration: duration(kind.durationMs),
                    })
                  : t('daySummary.health.kind', { name, number: formatNumber(kind.count) })}
              </Line>
            </li>
          );
        })}
      </Box>
    </DayCard>
  );
}
