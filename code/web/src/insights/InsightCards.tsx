import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Typography } from '@mui/material';
import type { AgeNormSet } from '../ageNorms/ageNorms';
import type { BabyEvent, EventType } from '../db/models';
import { formatDate, formatDuration, formatList, formatNumber, formatUnit } from '../i18n/format';
import { countAxis, hoursAxis } from './chartGeometry';
import { insightById } from './catalogue';
import { ColumnChart, type ColumnSeries } from './charts/ColumnChart';
import { DataTable, Legend } from './charts/chartKit';
import { RhythmChart } from './charts/RhythmChart';
import type { LocalDay } from './days';
import { diapersByDay, diaperSummary } from './diaperModel';
import { feedingSummary, feedsByDay } from './feedingModel';
import { InsightCard, type Stat } from './InsightCard';
import { clockText, insightName, shortDay } from './insightText';
import { clockMinutes, rhythmRows, sleepAverages, sleepByDay, usualTimes } from './sleepModel';

/*
 * The four unlocked-insight cards. Each one is a thin view over the pure models: it computes its
 * numbers for the chosen range and hands the card the range averages as headline numbers, a
 * summary sentence, a chart (with the average as a reference line) and the same numbers as a table.
 * Averages are taken over the finished days with data in the range (today only when it is the only
 * one), so a day nobody logged does not pull them down.
 */

export interface CardProps {
  events: readonly BabyEvent[];
  types: readonly EventType[];
  /** The chosen range, oldest first, ending today. */
  days: readonly LocalDay[];
  now: Date;
  todayKey: string;
  /** The baby's birth date and the published age norms: the feeding gap cut-off follows age. */
  birthDate?: string | null;
  ageNorms?: AgeNormSet | null;
}

const NONE = '–';
const duration = (ms: number) => formatDuration(ms);
const count = (value: number) => formatNumber(value);
/** Hour ticks: a plain 0 at the baseline. */
const hourTick = (ms: number) => (ms === 0 ? count(0) : duration(ms));
const ml = (value: number) => formatUnit(Math.round(value), 'milliliter');
/** One decimal at most, as a number for the plural rules and `{{count, number}}`. */
const roundOne = (value: number) => Math.round(value * 10) / 10;
const tableDay = (date: Date) => formatDate(date, 'weekdayDayMonth');
/** Newest first, like the Day screen. */
const newestFirst = <T,>(items: readonly T[]) => [...items].reverse();

function useCardText(days: readonly LocalDay[]) {
  const { t } = useTranslation();
  const first = days[0];
  const last = days[days.length - 1];
  return {
    chartLabel: (title: string, summary: string) =>
      t('insights.chartLabel', {
        title,
        from: first ? shortDay(first.start) : '',
        to: last ? shortDay(last.start) : '',
        summary,
      }),
    averageCaption: t('insights.averageCaption', { count: days.length }),
  };
}

/** A small caption over one of several charts in a card. */
function ChartBlock({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <Box sx={{ display: 'grid', gap: 0.75 }}>
      {title && (
        <Typography variant="caption" color="text.secondary" component="p">
          {title}
        </Typography>
      )}
      {children}
    </Box>
  );
}

export function SleepCard({ events, types, days, now, todayKey }: CardProps) {
  const { t } = useTranslation();
  const text = useCardText(days);
  const insight = insightById('sleep');
  const data = sleepByDay(events, types, days, now);
  const averages = sleepAverages(data, todayKey);
  const summary = averages
    ? t('insights.sleep.summary', {
        total: duration(averages.totalMs),
        night: duration(averages.nightMs),
        naps: duration(averages.napMs),
      })
    : t('insights.noData');
  const series: ColumnSeries[] = [
    { key: 'night', label: t('insights.sleep.night'), color: 'night' },
    { key: 'naps', label: t('insights.sleep.naps'), color: 'nap' },
  ];
  const axis = hoursAxis(Math.max(0, ...data.map((d) => d.nightMs + d.napMs)));
  return (
    <InsightCard
      insight={insight}
      headline={
        averages
          ? {
              values: [t('insights.perDay', { value: duration(averages.totalMs) })],
              caption: text.averageCaption,
            }
          : null
      }
      summary={summary}
      legend={
        <Legend
          items={[...series, ...(averages ? [{ key: 'avg', label: t('insights.average') }] : [])]}
        />
      }
      chart={
        <ColumnChart
          days={data.map((d) => ({ key: d.key, start: d.start, values: [d.nightMs, d.napMs] }))}
          series={series}
          axis={axis}
          formatTick={hourTick}
          formatValue={duration}
          label={text.chartLabel(insightName(t, 'sleep'), summary)}
          todayKey={todayKey}
          reference={averages?.totalMs ?? null}
        />
      }
      table={
        <DataTable
          caption={insightName(t, 'sleep')}
          head={t('insights.tableDay')}
          columns={series}
          rows={newestFirst(data).map((d) => ({
            key: d.key,
            cells: [tableDay(d.start), duration(d.nightMs), duration(d.napMs)],
          }))}
        />
      }
    />
  );
}

export function RhythmCard({ events, types, days, now, todayKey }: CardProps) {
  const { t } = useTranslation();
  const text = useCardText(days);
  const insight = insightById('sleepRhythm');
  const rows = rhythmRows(events, types, days, now);
  const usual = usualTimes(rows);
  const bedtime = usual.bedtime === null ? null : clockText(usual.bedtime);
  const wake = usual.wake === null ? null : clockText(usual.wake);
  const caption = t('insights.rhythm.caption');
  let summary = caption;
  if (bedtime && wake) summary = t('insights.rhythm.summary', { bedtime, wake });
  else if (bedtime) summary = t('insights.rhythm.summaryBedtime', { bedtime });
  else if (wake) summary = t('insights.rhythm.summaryWake', { wake });
  const stats: Stat[] = [
    ...(bedtime ? [{ key: 'bedtime', label: t('insights.rhythm.bedtime'), value: bedtime }] : []),
    ...(wake ? [{ key: 'wake', label: t('insights.rhythm.wake'), value: wake }] : []),
  ];
  const legend = [
    { key: 'night', label: t('insights.sleep.night'), color: 'night' as const },
    { key: 'naps', label: t('insights.sleep.naps'), color: 'nap' as const },
  ];
  return (
    <InsightCard
      insight={insight}
      summary={summary}
      stats={stats}
      legend={<Legend items={legend} />}
      chart={
        <RhythmChart
          rows={rows}
          label={text.chartLabel(
            insightName(t, 'sleepRhythm'),
            summary === caption ? caption : `${summary} ${caption}`,
          )}
          todayKey={todayKey}
        />
      }
      note={summary === caption ? undefined : caption}
      table={
        <DataTable
          caption={insightName(t, 'sleepRhythm')}
          head={t('insights.tableDay')}
          columns={[
            { key: 'bedtime', label: t('insights.rhythm.tableBedtime') },
            { key: 'wake', label: t('insights.rhythm.tableWake') },
          ]}
          rows={rows.map((row) => ({
            key: row.key,
            cells: [
              tableDay(row.start),
              row.bedtime ? clockText(clockMinutes(row.bedtime)) : NONE,
              row.wake ? clockText(clockMinutes(row.wake)) : NONE,
            ],
          }))}
        />
      }
    />
  );
}

export function FeedingCard({
  events,
  types,
  days,
  now,
  todayKey,
  birthDate,
  ageNorms,
}: CardProps) {
  const { t } = useTranslation();
  const text = useCardText(days);
  const insight = insightById('feeding');
  const data = feedsByDay(events, types, days, now);
  const facts = feedingSummary(events, types, days, now, todayKey, { birthDate, ageNorms });
  const hasBottleMl = data.some((d) => d.bottleMl > 0);
  const sentences: string[] = [];
  if (facts.perDay !== null) {
    sentences.push(t('insights.feeding.summary', { count: Math.round(facts.perDay) }));
  }
  if (facts.avgGapMs !== null) {
    sentences.push(t('insights.feeding.gapSummary', { gap: duration(facts.avgGapMs) }));
  }
  if (facts.mlPerDay !== null) {
    sentences.push(t('insights.feeding.mlSummary', { ml: ml(facts.mlPerDay) }));
  }
  const summary = sentences.length > 0 ? sentences.join(' ') : t('insights.noData');
  const headlines: string[] = [];
  if (facts.perDay !== null) {
    headlines.push(t('insights.feeding.headline', { count: roundOne(facts.perDay) }));
  }
  if (facts.mlPerDay !== null) {
    headlines.push(t('insights.perDay', { value: ml(facts.mlPerDay) }));
  }
  const stats: Stat[] = [];
  if (facts.avgGapMs !== null) {
    stats.push({ key: 'gap', label: t('insights.feeding.gap'), value: duration(facts.avgGapMs) });
  }
  if (facts.avgBottleMl !== null) {
    stats.push({
      key: 'bottle',
      label: t('insights.feeding.bottle'),
      value: ml(facts.avgBottleMl),
    });
  }
  if (facts.avgBottleMs !== null) {
    stats.push({
      key: 'bottleTime',
      label: t('insights.feeding.bottleTime'),
      value: duration(facts.avgBottleMs),
    });
  }
  const feedSeries: ColumnSeries[] = [
    { key: 'feeds', label: t('insights.feeding.feeds'), color: 'feed' },
  ];
  const mlSeries: ColumnSeries[] = [
    { key: 'ml', label: t('insights.feeding.tableMl'), color: 'feed' },
  ];
  const average = { key: 'avg', label: t('insights.average') };
  return (
    <InsightCard
      insight={insight}
      headline={{ values: headlines, caption: text.averageCaption }}
      summary={summary}
      stats={stats}
      legend={<Legend items={[...feedSeries, ...(facts.perDay !== null ? [average] : [])]} />}
      chart={
        <Box sx={{ display: 'grid', gap: 2.5 }}>
          <ChartBlock title={hasBottleMl ? t('insights.feeding.feedsChart') : undefined}>
            <ColumnChart
              days={data.map((d) => ({ key: d.key, start: d.start, values: [d.feeds] }))}
              series={feedSeries}
              axis={countAxis(Math.max(0, ...data.map((d) => d.feeds)))}
              formatTick={count}
              formatValue={count}
              label={text.chartLabel(t('insights.feeding.feedsChart'), summary)}
              todayKey={todayKey}
              reference={facts.perDay}
              height={hasBottleMl ? 160 : 188}
            />
          </ChartBlock>
          {hasBottleMl && (
            <ChartBlock title={t('insights.feeding.mlChart')}>
              <ColumnChart
                days={data.map((d) => ({ key: d.key, start: d.start, values: [d.bottleMl] }))}
                series={mlSeries}
                axis={countAxis(Math.max(0, ...data.map((d) => d.bottleMl)))}
                formatTick={count}
                formatValue={ml}
                label={text.chartLabel(t('insights.feeding.mlChart'), summary)}
                todayKey={todayKey}
                reference={facts.mlPerDay}
                height={160}
              />
            </ChartBlock>
          )}
        </Box>
      }
      table={
        <DataTable
          caption={insightName(t, 'feeding')}
          head={t('insights.tableDay')}
          columns={[...feedSeries, ...(hasBottleMl ? mlSeries : [])]}
          rows={newestFirst(data).map((d) => ({
            key: d.key,
            cells: [
              tableDay(d.start),
              count(d.feeds),
              ...(hasBottleMl ? [d.bottleMl > 0 ? ml(d.bottleMl) : NONE] : []),
            ],
          }))}
        />
      }
    />
  );
}

export function DiaperCard({ events, types, days, now, todayKey }: CardProps) {
  const { t } = useTranslation();
  const text = useCardText(days);
  const insight = insightById('diapers');
  const data = diapersByDay(events, types, days, now);
  const facts = diaperSummary(data, todayKey);
  const sentences: string[] = [];
  if (facts.perDay !== null) {
    sentences.push(t('insights.diapers.summary', { count: Math.round(facts.perDay) }));
  }
  if (facts.hasContent && facts.wetPerDay !== null && facts.dirtyPerDay !== null) {
    sentences.push(
      t('insights.diapers.wetDirty', {
        wet: count(Math.round(facts.wetPerDay)),
        dirty: count(Math.round(facts.dirtyPerDay)),
      }),
    );
  }
  const summary = sentences.length > 0 ? sentences.join(' ') : t('insights.noData');
  const series: ColumnSeries[] = [
    { key: 'total', label: t('insights.diapers.total'), color: 'diaper' },
  ];
  const wet = t('insights.diapers.wet');
  const dirty = t('insights.diapers.dirty');
  const columns = facts.hasContent
    ? [{ key: 'wet', label: wet }, { key: 'dirty', label: dirty }, ...series]
    : series;
  return (
    <InsightCard
      insight={insight}
      headline={
        facts.perDay !== null
          ? {
              values: [t('insights.diapers.headline', { count: roundOne(facts.perDay) })],
              caption: text.averageCaption,
            }
          : null
      }
      summary={summary}
      legend={
        <Legend
          items={[
            ...series,
            ...(facts.perDay !== null ? [{ key: 'avg', label: t('insights.average') }] : []),
          ]}
        />
      }
      chart={
        <ColumnChart
          days={data.map((d) => ({ key: d.key, start: d.start, values: [d.total] }))}
          series={series}
          axis={countAxis(Math.max(0, ...data.map((d) => d.total)))}
          formatTick={count}
          formatValue={count}
          label={text.chartLabel(t('insights.diapers.chart'), summary)}
          todayKey={todayKey}
          reference={facts.perDay}
          {...(facts.hasContent
            ? {
                describe: (index: number) =>
                  formatList([
                    t('insights.seriesValue', { label: wet, value: count(data[index].wet) }),
                    t('insights.seriesValue', { label: dirty, value: count(data[index].dirty) }),
                    t('insights.seriesValue', {
                      label: series[0].label,
                      value: count(data[index].total),
                    }),
                  ]),
              }
            : {})}
        />
      }
      note={facts.hasContent ? t('insights.diapers.mixedNote') : undefined}
      table={
        <DataTable
          caption={insightName(t, 'diapers')}
          head={t('insights.tableDay')}
          columns={columns}
          rows={newestFirst(data).map((d) => ({
            key: d.key,
            cells: [
              tableDay(d.start),
              ...(facts.hasContent ? [count(d.wet), count(d.dirty)] : []),
              count(d.total),
            ],
          }))}
        />
      }
    />
  );
}
