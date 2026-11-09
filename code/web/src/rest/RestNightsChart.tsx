import { useTranslation } from 'react-i18next';
import { Box, Typography, useTheme, type Theme } from '@mui/material';
import { formatDate, formatTime } from '../i18n/format';
import { DataTable } from '../insights/charts/chartKit';
import { chartColor, visuallyHidden } from '../insights/charts/chartStyle';
import { palette } from '../ui/form/styles';
import type { RestHistoryNight } from './restApi';
import { partText } from './restText';
import {
  hourAsDate,
  mutedReason,
  newestFirst,
  nightAxis,
  spanOnAxis,
  type NightAxis,
} from './restHistoryModel';

/*
 * Night by night (docs/design/41-caregiver-rest.md section 12): one row per night, newest first,
 * its parts as time ranges on one shared axis; the gaps are the person being up. One hue for rest
 * (the chart's night token, so light, dark and night schemes follow), lighter and dashed for a low
 * confidence part, the whole row faded for a night left out of the typical values, which also
 * says why in words. The same values are in a visually hidden table.
 */

const TRACK = 20;
const BAR = 12;
const MUTED_OPACITY = 0.4;
const LOW_FILL_OPACITY = 0.35;

const restColor = (theme: Theme) => chartColor(theme, 'night');

/** The low-confidence look: a dashed outline over a light fill (not colour alone). */
function LowMark({ sx }: { sx?: object }) {
  return (
    <Box
      sx={(theme) => ({
        position: 'relative',
        boxSizing: 'border-box',
        border: `1.5px dashed ${restColor(theme)}`,
        borderRadius: '3px',
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: 0,
          backgroundColor: restColor(theme),
          opacity: LOW_FILL_OPACITY,
        },
        ...sx,
      })}
    />
  );
}

function Legend() {
  const { t } = useTranslation();
  const theme = useTheme();
  const swatch = { width: 14, height: 10, borderRadius: '3px', flex: 'none' } as const;
  const items = [
    {
      key: 'rest',
      label: t('rest.history.chart.legendRest'),
      mark: <Box sx={{ ...swatch, backgroundColor: restColor(theme) }} />,
    },
    { key: 'low', label: t('rest.history.chart.legendLow'), mark: <LowMark sx={swatch} /> },
    {
      key: 'muted',
      label: t('rest.history.chart.legendMuted'),
      mark: <Box sx={{ ...swatch, backgroundColor: restColor(theme), opacity: MUTED_OPACITY }} />,
    },
  ];
  return (
    <Box
      component="ul"
      sx={{
        m: 0,
        p: 0,
        listStyle: 'none',
        display: 'flex',
        flexWrap: 'wrap',
        columnGap: 2,
        rowGap: 0.5,
      }}
    >
      {items.map((item) => (
        <Box
          component="li"
          key={item.key}
          sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}
        >
          <Box aria-hidden sx={{ display: 'flex' }}>
            {item.mark}
          </Box>
          <Typography variant="caption" color="text.secondary">
            {item.label}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

const tickTranslate = (index: number, count: number) =>
  index === 0 ? 'none' : index === count - 1 ? 'translateX(-100%)' : 'translateX(-50%)';

function Gridlines({ axis }: { axis: NightAxis }) {
  const total = axis.end - axis.start;
  return axis.ticks.map((tick) => (
    <Box
      key={tick}
      sx={(theme) => ({
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: `${((tick - axis.start) / total) * 100}%`,
        width: '1px',
        backgroundColor: palette(theme).hairline,
      })}
    />
  ));
}

/** Where a part sits in its row's track. */
const partPlace = (span: { left: number; width: number }) =>
  ({
    position: 'absolute',
    top: (TRACK - BAR) / 2,
    height: BAR,
    left: `${span.left}%`,
    width: `${span.width}%`,
    minWidth: 2,
  }) as const;

function Row({ night, axis }: { night: RestHistoryNight; axis: NightAxis }) {
  const { t } = useTranslation();
  const reason = mutedReason(night);
  const date = formatDate(night.night, 'weekdayDayMonth');
  return (
    <>
      <Box sx={{ minWidth: 0, py: 0.5 }}>
        <Typography
          variant="caption"
          component="div"
          sx={{ whiteSpace: 'nowrap', lineHeight: 1.4 }}
        >
          {date}
        </Typography>
      </Box>
      <Box sx={{ minWidth: 0, py: 0.5 }}>
        <Box
          data-testid="rest-history-night"
          sx={{ position: 'relative', height: TRACK, opacity: reason ? MUTED_OPACITY : 1 }}
        >
          <Gridlines axis={axis} />
          {night.status === 'notEnoughLog' ? (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ position: 'absolute', left: 4, top: 0, lineHeight: `${TRACK}px` }}
            >
              {t('rest.history.chart.notEnoughLog')}
            </Typography>
          ) : (
            night.parts.map((part) => {
              if (!part.end) return null;
              const place = partPlace(spanOnAxis(axis, night.night, part.start, part.end));
              return part.confidence === 'low' ? (
                <Box key={part.start} title={partText(part, t)} sx={{ ...place }}>
                  <LowMark sx={{ width: '100%', height: '100%' }} />
                </Box>
              ) : (
                <Box
                  key={part.start}
                  title={partText(part, t)}
                  sx={(theme) => ({
                    ...place,
                    borderRadius: '3px',
                    backgroundColor: restColor(theme),
                  })}
                />
              );
            })
          )}
        </Box>
        {reason && (
          <Typography
            variant="caption"
            color="text.secondary"
            component="div"
            sx={{ lineHeight: 1.3 }}
          >
            {t(`rest.history.chart.${reason}`)}
          </Typography>
        )}
      </Box>
    </>
  );
}

function NightsTable({ nights }: { nights: readonly RestHistoryNight[] }) {
  const { t } = useTranslation();
  return (
    <Box sx={visuallyHidden}>
      <DataTable
        caption={t('rest.history.chart.caption')}
        head={t('rest.history.chart.colNight')}
        columns={[
          { key: 'rest', label: t('rest.history.chart.colRest') },
          { key: 'note', label: t('rest.history.chart.colNote') },
        ]}
        rows={nights.map((night) => {
          const reason = mutedReason(night);
          return {
            key: night.night,
            cells: [
              formatDate(night.night, 'weekdayDayMonth'),
              night.status === 'notEnoughLog' || night.parts.length === 0
                ? t('rest.history.chart.notEnoughLog')
                : night.parts.map((part) => partText(part, t)).join('; '),
              reason ? t(`rest.history.chart.${reason}`) : '',
            ],
          };
        })}
      />
    </Box>
  );
}

/** The nights chart, or a plain sentence when no night of the period has an estimate. */
export function RestNightsChart({ nights }: { nights: readonly RestHistoryNight[] }) {
  const { t } = useTranslation();
  const rows = newestFirst(nights);
  const axis = nightAxis(rows);
  return (
    <Box component="section" aria-labelledby="rest-history-nights">
      <Typography
        id="rest-history-nights"
        variant="subtitle1"
        component="h3"
        sx={{ fontWeight: 600 }}
      >
        {t('rest.history.chart.title')}
      </Typography>
      {axis ? (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t('rest.history.chart.gaps')}
          </Typography>
          <Legend />
          <Box
            aria-hidden
            data-testid="rest-history-nights-chart"
            sx={{
              mt: 1.5,
              display: 'grid',
              gridTemplateColumns: 'max-content minmax(0, 1fr)',
              columnGap: 1.5,
              alignItems: 'start',
            }}
          >
            <Box />
            <Box sx={{ position: 'relative', height: 18 }}>
              {axis.ticks.map((tick, index) => (
                <Typography
                  key={tick}
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    position: 'absolute',
                    top: 0,
                    left: `${((tick - axis.start) / (axis.end - axis.start)) * 100}%`,
                    transform: tickTranslate(index, axis.ticks.length),
                    whiteSpace: 'nowrap',
                    lineHeight: '18px',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {formatTime(hourAsDate(tick))}
                </Typography>
              ))}
            </Box>
            {rows.map((night) => (
              <Row key={night.night} night={night} axis={axis} />
            ))}
          </Box>
          <NightsTable nights={rows} />
        </>
      ) : (
        <Typography color="text.secondary">{t('rest.history.empty')}</Typography>
      )}
    </Box>
  );
}
