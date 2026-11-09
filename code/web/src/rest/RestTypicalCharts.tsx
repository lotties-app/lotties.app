import { useTranslation } from 'react-i18next';
import { Box, Stack, Typography } from '@mui/material';
import { formatDuration, formatNumber, formatTime } from '../i18n/format';
import { DataTable } from '../insights/charts/chartKit';
import { chartColor, visuallyHidden } from '../insights/charts/chartStyle';
import { hoursAxis } from '../insights/chartGeometry';
import { palette } from '../ui/form/styles';
import type { RestGroup, RestHistory, RestHistoryHour } from './restApi';
import { hourAsDate } from './restHistoryModel';

/*
 * The two summaries of the history (docs/design/41-caregiver-rest.md section 12), each shown only
 * from the minimum number of counted nights; below it, the count and a plain sentence, no chart.
 * Typical rested time: a range bar from the 25th to the 75th percentile with a tick for the median,
 * on an axis from zero. A typical night: 24 hour cells, the share of counted nights estimated
 * asleep as the cell's opacity. No verdict, no target, no comparison; the values are in tables.
 */

const MINUTE_MS = 60_000;
const duration = (minutes: number) => formatDuration(minutes * MINUTE_MS);

type GroupKey = 'weekday' | 'weekend';
const GROUPS: readonly GroupKey[] = ['weekday', 'weekend'];

function GroupRow({
  name,
  group,
  minimum,
  axisMax,
}: {
  name: GroupKey;
  group: RestGroup;
  minimum: number;
  axisMax: number;
}) {
  const { t } = useTranslation();
  const minutes = group.countedNights >= minimum ? group.restedMinutes : null;
  const at = (value: number) => `${Math.min(100, ((value * MINUTE_MS) / axisMax) * 100)}%`;
  return (
    <Box data-testid={`rest-history-${name}`}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {t(`rest.history.typical.${name}`)}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('rest.history.typical.counted', { count: group.countedNights })}
        </Typography>
      </Stack>
      {minutes ? (
        <>
          <Typography variant="body2">
            {t('rest.history.typical.about', { duration: duration(minutes.median) })}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div">
            {t('rest.history.typical.range', {
              from: duration(minutes.p25),
              to: duration(minutes.p75),
            })}
          </Typography>
          <Box aria-hidden sx={{ position: 'relative', height: 20, mt: 0.5 }}>
            <Box
              sx={(theme) => ({
                position: 'absolute',
                left: 0,
                right: 0,
                top: 9,
                height: '2px',
                backgroundColor: palette(theme).hairline,
              })}
            />
            <Box
              sx={(theme) => ({
                position: 'absolute',
                top: 4,
                height: 12,
                left: at(minutes.p25),
                width: `calc(${at(minutes.p75)} - ${at(minutes.p25)})`,
                minWidth: 4,
                borderRadius: '4px',
                backgroundColor: chartColor(theme, 'night'),
                opacity: 0.45,
              })}
            />
            <Box
              sx={(theme) => ({
                position: 'absolute',
                top: 0,
                height: 20,
                width: 3,
                borderRadius: '2px',
                left: `calc(${at(minutes.median)} - 1.5px)`,
                backgroundColor: palette(theme).text.primary,
              })}
            />
          </Box>
        </>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {t('rest.history.typical.notEnough', { count: minimum })}
        </Typography>
      )}
    </Box>
  );
}

function RestedTime({ history }: { history: RestHistory }) {
  const { t } = useTranslation();
  const minimum = history.constants.minimumNights;
  const shown = GROUPS.map((name) => history.weekdayWeekend[name]).filter(
    (g) => g.countedNights >= minimum && g.restedMinutes,
  );
  const axis = hoursAxis(
    Math.max(0, ...shown.map((g) => (g.restedMinutes?.p75 ?? 0) * MINUTE_MS)),
    3,
  );
  return (
    <Box component="section" aria-labelledby="rest-history-typical">
      <Typography
        id="rest-history-typical"
        variant="subtitle1"
        component="h3"
        sx={{ fontWeight: 600 }}
      >
        {t('rest.history.typical.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t('rest.history.typical.hint')}
      </Typography>
      <Stack spacing={2}>
        {GROUPS.map((name) => (
          <GroupRow
            key={name}
            name={name}
            group={history.weekdayWeekend[name]}
            minimum={minimum}
            axisMax={axis.max}
          />
        ))}
      </Stack>
      {shown.length > 0 && (
        <Box aria-hidden sx={{ position: 'relative', height: 18, mt: 0.5 }}>
          {axis.ticks.map((tick, index) => (
            <Typography
              key={tick}
              variant="caption"
              color="text.secondary"
              sx={{
                position: 'absolute',
                left: `${(tick / axis.max) * 100}%`,
                transform:
                  index === 0
                    ? 'none'
                    : index === axis.ticks.length - 1
                      ? 'translateX(-100%)'
                      : 'translateX(-50%)',
                whiteSpace: 'nowrap',
              }}
            >
              {formatDuration(tick)}
            </Typography>
          ))}
        </Box>
      )}
      {shown.length > 0 && (
        <Box sx={visuallyHidden}>
          <DataTable
            caption={t('rest.history.typical.caption')}
            head={t('rest.history.typical.colGroup')}
            columns={[
              { key: 'typical', label: t('rest.history.typical.colTypical') },
              { key: 'range', label: t('rest.history.typical.colRange') },
              { key: 'count', label: t('rest.history.typical.colCount') },
            ]}
            rows={GROUPS.map((name) => {
              const group = history.weekdayWeekend[name];
              const minutes = group.countedNights >= minimum ? group.restedMinutes : null;
              return {
                key: name,
                cells: [
                  t(`rest.history.typical.${name}`),
                  minutes
                    ? t('rest.history.typical.about', { duration: duration(minutes.median) })
                    : t('rest.history.typical.notEnough', { count: minimum }),
                  minutes
                    ? t('rest.history.typical.range', {
                        from: duration(minutes.p25),
                        to: duration(minutes.p75),
                      })
                    : '',
                  t('rest.history.typical.counted', { count: group.countedNights }),
                ],
              };
            })}
          />
        </Box>
      )}
    </Box>
  );
}

/** The share as the fill's opacity; every cell keeps its outline, so an hour at 0 still shows. */
const cellOpacity = (share: number) => Math.max(0, Math.min(1, share));
const LABEL_EVERY = 6;

function TypicalNight({ history }: { history: RestHistory }) {
  const { t } = useTranslation();
  const minimum = history.constants.minimumNights;
  const { countedNights, hours } = history.typicalNight;
  const enough = countedNights >= minimum && hours.length === 24;
  const percent = (hour: RestHistoryHour) => formatNumber(hour.share, { style: 'percent' });
  return (
    <Box component="section" aria-labelledby="rest-history-typical-night">
      <Typography
        id="rest-history-typical-night"
        variant="subtitle1"
        component="h3"
        sx={{ fontWeight: 600 }}
      >
        {t('rest.history.typicalNight.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t('rest.history.typicalNight.label')}
      </Typography>
      {enough ? (
        <>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
            {t('rest.history.typical.counted', { count: countedNights })}
          </Typography>
          <Box
            aria-hidden
            data-testid="rest-history-typical-night"
            sx={{ display: 'grid', gridTemplateColumns: 'repeat(24, minmax(0, 1fr))', gap: '2px' }}
          >
            {hours.map((hour) => (
              <Box
                key={hour.hour}
                title={`${formatTime(hourAsDate(hour.hour))}: ${percent(hour)}`}
                sx={(theme) => ({
                  position: 'relative',
                  height: 28,
                  borderRadius: '3px',
                  boxShadow: `inset 0 0 0 1px ${palette(theme).hairline}`,
                  '&::before': {
                    content: '""',
                    position: 'absolute',
                    inset: 0,
                    borderRadius: '3px',
                    backgroundColor: chartColor(theme, 'night'),
                    opacity: cellOpacity(hour.share),
                  },
                })}
              />
            ))}
            {hours.map((hour, index) => (
              <Typography
                key={`label-${hour.hour}`}
                variant="caption"
                color="text.secondary"
                sx={{
                  gridColumn: `${index + 1} / span ${LABEL_EVERY}`,
                  display: index % LABEL_EVERY === 0 ? 'block' : 'none',
                  whiteSpace: 'nowrap',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {formatTime(hourAsDate(hour.hour))}
              </Typography>
            ))}
          </Box>
          <Stack aria-hidden direction="row" sx={{ alignItems: 'center', gap: 0.75, mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {t('rest.history.typicalNight.fewer')}
            </Typography>
            <Box
              sx={(theme) => ({
                width: 64,
                height: 10,
                borderRadius: '3px',
                boxShadow: `inset 0 0 0 1px ${palette(theme).hairline}`,
                backgroundImage: `linear-gradient(to right, transparent, ${chartColor(theme, 'night')})`,
              })}
            />
            <Typography variant="caption" color="text.secondary">
              {t('rest.history.typicalNight.more')}
            </Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
            {t('rest.history.typicalNight.hint')}
          </Typography>
          <Box sx={visuallyHidden}>
            <DataTable
              caption={t('rest.history.typicalNight.caption')}
              head={t('rest.history.typicalNight.colHour')}
              columns={[{ key: 'share', label: t('rest.history.typicalNight.colShare') }]}
              rows={hours.map((hour) => ({
                key: String(hour.hour),
                cells: [formatTime(hourAsDate(hour.hour)), percent(hour)],
              }))}
            />
          </Box>
        </>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t('rest.history.typical.counted', { count: countedNights })}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('rest.history.typical.notEnough', { count: minimum })}
          </Typography>
        </>
      )}
    </Box>
  );
}

export function RestTypicalCharts({ history }: { history: RestHistory }) {
  return (
    <Stack spacing={3}>
      <RestedTime history={history} />
      <TypicalNight history={history} />
    </Stack>
  );
}
