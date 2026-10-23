import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Link } from 'react-router-dom';
import { Box, Button, Stack, Typography } from '@mui/material';
import { parseDayValue } from '../../day/dayModel';
import type {
  Baby,
  BabyEvent,
  EventType,
  Formula,
  Medication,
  Note,
  Prescription,
} from '../../db/models';
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatUnit,
} from '../../i18n/format';
import { ColumnChart, type ColumnSeries } from '../../insights/charts/ColumnChart';
import { Legend } from '../../insights/charts/chartKit';
import { countAxis, HOUR_MS, hoursAxis } from '../../insights/chartGeometry';
import { GrowthChart } from '../../measurements/GrowthChart';
import { METRICS, metricLabel } from '../../measurements/measurementModel';
import { summaryText } from '../../medications/prescriptionForm';
import { NoteCard } from '../../notes/NoteCard';
import { Provenance } from '../../proposals/Provenance';
import type { MeasurementDto } from '../../sync/contract';
import { presentEvent } from '../../timeline/eventPresentation';
import { useEventTypeText } from '../../i18n/eventTypeText';
import { patientPath } from '../dashboardStorage';
import type {
  ClinicalSummary,
  DiaperSectionDto,
  FeedingSectionDto,
  SleepSectionDto,
  VaccinesSectionDto,
} from '../doctorApi';
import {
  Caption,
  NoData,
  Row,
  RowList,
  StatGrid,
  SummarySection,
  type SummaryStat,
} from './SummaryKit';

const NONE = '–';
const MINUTE_MS = 60_000;

const minutes = (value: number | null | undefined) =>
  value === null || value === undefined ? NONE : formatDuration(value * MINUTE_MS);
const decimal = (value: number | null | undefined) =>
  value === null || value === undefined ? NONE : formatNumber(value, { maximumFractionDigits: 1 });
const whole = (value: number) => formatNumber(value, { maximumFractionDigits: 0 });

/** A local `yyyy-mm-dd` as the local midnight that starts it (the charts' column dates). */
const dayStart = (date: string) => parseDayValue(date) ?? new Date(`${date}T00:00:00`);

/** A local `HH:mm` clock text in the user's locale (24-hour everywhere, like `formatTime`). */
function clockText(value: string | null): string {
  if (!value) return NONE;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return value;
  return `${match[1]}:${match[2]}`;
}

function hourTick(ms: number) {
  return formatDuration(Math.round(ms / HOUR_MS) * HOUR_MS);
}

/* ---------- Daily log ---------- */

export function SleepSection({ sleep, today }: { sleep: SleepSectionDto; today: string }) {
  const { t } = useTranslation();
  const hasData = sleep.days.some((day) => day.totalMinutes > 0);
  const series: ColumnSeries[] = [
    { key: 'night', label: t('doctorDashboard.summary.sleep.legendNight'), color: 'night' },
    { key: 'naps', label: t('doctorDashboard.summary.sleep.legendNaps'), color: 'nap' },
  ];
  const stats: SummaryStat[] = [
    {
      key: 'total',
      label: t('doctorDashboard.summary.sleep.total'),
      value: minutes(sleep.averageTotalMinutes),
      help: t('doctorDashboard.summary.sleep.totalHelp'),
    },
    {
      key: 'night',
      label: t('doctorDashboard.summary.sleep.night'),
      value: minutes(sleep.averageNightMinutes),
      help: t('doctorDashboard.summary.sleep.nightHelp'),
    },
    {
      key: 'naps',
      label: t('doctorDashboard.summary.sleep.naps'),
      value:
        sleep.napsPerDay === null
          ? NONE
          : t('doctorDashboard.summary.sleep.napsValue', {
              value: decimal(sleep.napsPerDay),
              time: minutes(sleep.averageNapMinutes),
            }),
      help: t('doctorDashboard.summary.sleep.napsHelp'),
    },
    {
      key: 'longest',
      label: t('doctorDashboard.summary.sleep.longest'),
      value:
        sleep.longestStretchMinutes === null
          ? NONE
          : sleep.longestStretchStartedAt
            ? t('doctorDashboard.summary.sleep.longestOn', {
                duration: minutes(sleep.longestStretchMinutes),
                date: formatDate(sleep.longestStretchStartedAt, 'dayMonth'),
              })
            : minutes(sleep.longestStretchMinutes),
      help: t('doctorDashboard.summary.sleep.longestHelp'),
    },
    {
      key: 'bedtime',
      label: t('doctorDashboard.summary.sleep.bedtime'),
      value: clockText(sleep.bedtimeMedian),
      help: t('doctorDashboard.summary.sleep.bedtimeHelp'),
    },
    {
      key: 'wake',
      label: t('doctorDashboard.summary.sleep.wake'),
      value: clockText(sleep.wakeMedian),
      help: t('doctorDashboard.summary.sleep.wakeHelp'),
    },
  ];
  return (
    <SummarySection
      id="sleep"
      title={t('doctorDashboard.summary.sleep.title')}
      icon="moon"
      category="sleep"
    >
      {!hasData ? (
        <NoData />
      ) : (
        <>
          <StatGrid stats={stats} />
          <Caption>
            {t('doctorDashboard.summary.averagesOver', { count: sleep.daysCounted })}
          </Caption>
          <Legend items={series} />
          <ColumnChart
            days={sleep.days.map((day) => ({
              key: day.date,
              start: dayStart(day.date),
              values: [day.nightMinutes * MINUTE_MS, day.napMinutes * MINUTE_MS],
            }))}
            series={series}
            axis={hoursAxis(Math.max(0, ...sleep.days.map((d) => d.totalMinutes * MINUTE_MS)))}
            formatTick={hourTick}
            formatValue={(ms) => formatDuration(ms)}
            label={t('doctorDashboard.summary.sleep.chart')}
            todayKey={today}
            reference={
              sleep.averageTotalMinutes === null ? null : sleep.averageTotalMinutes * MINUTE_MS
            }
          />
        </>
      )}
    </SummarySection>
  );
}

export function FeedingSection({ feeding, today }: { feeding: FeedingSectionDto; today: string }) {
  const { t } = useTranslation();
  const hasData = feeding.days.some((day) => day.feeds > 0);
  const series: ColumnSeries[] = [
    { key: 'feeds', label: t('doctorDashboard.summary.feeding.chart'), color: 'feed' },
  ];
  const stats: SummaryStat[] = [
    {
      key: 'perDay',
      label: t('doctorDashboard.summary.feeding.perDay'),
      value: decimal(feeding.feedsPerDay),
      help: t('doctorDashboard.summary.feeding.perDayHelp'),
    },
    {
      key: 'interval',
      label: t('doctorDashboard.summary.feeding.interval'),
      value: minutes(feeding.averageIntervalMinutes),
      help: t('doctorDashboard.summary.feeding.intervalHelp'),
    },
    {
      key: 'ml',
      label: t('doctorDashboard.summary.feeding.ml'),
      value:
        feeding.bottleMlPerDay === null
          ? NONE
          : formatUnit(Math.round(feeding.bottleMlPerDay), 'milliliter'),
      help: t('doctorDashboard.summary.feeding.mlHelp'),
    },
  ];
  const methods: SummaryStat[] = [
    {
      key: 'breast',
      label: t('doctorDashboard.summary.feeding.breast'),
      value: whole(feeding.breastCount),
    },
    {
      key: 'bottle',
      label: t('doctorDashboard.summary.feeding.bottle'),
      value: whole(feeding.bottleCount),
    },
    {
      key: 'solid',
      label: t('doctorDashboard.summary.feeding.solid'),
      value: whole(feeding.solidCount),
    },
  ];
  return (
    <SummarySection
      id="feeding"
      title={t('doctorDashboard.summary.feeding.title')}
      icon="bottle"
      category="feeding"
    >
      {!hasData ? (
        <NoData />
      ) : (
        <>
          <StatGrid stats={stats} />
          <Typography variant="subtitle2" component="h3">
            {t('doctorDashboard.summary.feeding.methods')}
          </Typography>
          <StatGrid stats={methods} />
          <ColumnChart
            days={feeding.days.map((day) => ({
              key: day.date,
              start: dayStart(day.date),
              values: [day.feeds],
            }))}
            series={series}
            axis={countAxis(Math.max(0, ...feeding.days.map((d) => d.feeds)))}
            formatTick={whole}
            formatValue={whole}
            label={t('doctorDashboard.summary.feeding.chart')}
            todayKey={today}
            reference={feeding.feedsPerDay}
            height={160}
          />
          {feeding.formulas.length > 0 && (
            <>
              <Typography variant="subtitle2" component="h3">
                {t('doctorDashboard.summary.feeding.formulas')}
              </Typography>
              <RowList label={t('doctorDashboard.summary.feeding.formulas')}>
                {feeding.formulas.map((formula) => (
                  <Row
                    key={formula.formulaId ?? formula.name}
                    title={formula.name || t('doctorDashboard.summary.feeding.unnamedFormula')}
                    trailing={t('doctorDashboard.summary.feeding.formulaFeeds', {
                      count: formula.feeds,
                      amount: formatUnit(Math.round(formula.ml), 'milliliter'),
                    })}
                  />
                ))}
              </RowList>
            </>
          )}
        </>
      )}
    </SummarySection>
  );
}

export function DiaperSection({ diapers, today }: { diapers: DiaperSectionDto; today: string }) {
  const { t } = useTranslation();
  const hasData = diapers.days.some((day) => day.total > 0);
  const series: ColumnSeries[] = [
    { key: 'total', label: t('doctorDashboard.summary.diapers.chart'), color: 'diaper' },
  ];
  const stats: SummaryStat[] = [
    {
      key: 'perDay',
      label: t('doctorDashboard.summary.diapers.perDay'),
      value: decimal(diapers.perDay),
      help: t('doctorDashboard.summary.diapers.perDayHelp'),
    },
    {
      key: 'wet',
      label: t('doctorDashboard.summary.diapers.wet'),
      value: decimal(diapers.wetPerDay),
    },
    {
      key: 'dirty',
      label: t('doctorDashboard.summary.diapers.dirty'),
      value: decimal(diapers.dirtyPerDay),
    },
  ];
  return (
    <SummarySection
      id="diapers"
      title={t('doctorDashboard.summary.diapers.title')}
      icon="diaper"
      category="diaper"
    >
      {!hasData ? (
        <NoData />
      ) : (
        <>
          <StatGrid stats={stats} />
          <ColumnChart
            days={diapers.days.map((day) => ({
              key: day.date,
              start: dayStart(day.date),
              values: [day.total],
            }))}
            series={series}
            axis={countAxis(Math.max(0, ...diapers.days.map((d) => d.total)))}
            formatTick={whole}
            formatValue={whole}
            label={t('doctorDashboard.summary.diapers.chart')}
            todayKey={today}
            reference={diapers.perDay}
            height={160}
            describe={(index) => {
              const day = diapers.days[index];
              return day
                ? t('doctorDashboard.summary.diapers.dayDetail', {
                    total: day.total,
                    wet: day.wet,
                    dirty: day.dirty,
                  })
                : '';
            }}
          />
        </>
      )}
    </SummarySection>
  );
}

export function SymptomsSection({
  items,
  types,
}: {
  items: readonly BabyEvent[];
  types: readonly EventType[] | undefined;
}) {
  const { t } = useTranslation();
  const names = useEventTypeText();
  return (
    <SummarySection
      id="symptoms"
      title={t('doctorDashboard.summary.symptoms.title')}
      icon="thermometer"
      category="health"
    >
      {items.length === 0 ? (
        <NoData />
      ) : (
        <>
          <Caption>{t('doctorDashboard.summary.symptoms.help')}</Caption>
          <RowList label={t('doctorDashboard.summary.symptoms.list')}>
            {items.map((event) => {
              const type = types?.find((candidate) => candidate.id === event.typeId);
              const view = presentEvent(event, type, [], names);
              const typeName = type ? names.typeName(type) : '';
              return (
                <Row
                  key={event.id}
                  title={view.title}
                  detail={[view.detail, typeName !== view.title ? typeName : '']
                    .filter(Boolean)
                    .join(' · ')}
                  trailing={formatDateTime(event.startedAt)}
                />
              );
            })}
          </RowList>
        </>
      )}
    </SummarySection>
  );
}

/* ---------- Medications, vaccines, growth, notes, formulas ---------- */

export function MedicationsSection({
  medications,
  catalog,
}: {
  medications: NonNullable<ClinicalSummary['medications']>;
  catalog: readonly Medication[] | undefined;
}) {
  const { t } = useTranslation();
  const nameOf = (prescription: Prescription) =>
    catalog?.find((medication) => medication.id === prescription.medicationId)?.name ??
    t('doctorDashboard.summary.medications.unknownMedication');
  return (
    <SummarySection
      id="medications"
      title={t('doctorDashboard.summary.medications.title')}
      icon="pill"
      category="health"
    >
      <Typography variant="subtitle2" component="h3">
        {t('doctorDashboard.summary.medications.doses')}
      </Typography>
      <Caption>{t('doctorDashboard.summary.medications.dosesHelp')}</Caption>
      {medications.doses.length === 0 ? (
        <Typography color="text.secondary">
          {t('doctorDashboard.summary.medications.noDoses')}
        </Typography>
      ) : (
        <RowList label={t('doctorDashboard.summary.medications.doses')}>
          {medications.doses.map((dose) => (
            <Row
              key={dose.medicationId ?? dose.name}
              title={dose.name}
              detail={t('doctorDashboard.summary.medications.lastGiven', {
                date: formatDateTime(dose.lastGivenAt),
              })}
              trailing={t('doctorDashboard.summary.medications.doseCount', { count: dose.count })}
            />
          ))}
        </RowList>
      )}
      <Typography variant="subtitle2" component="h3">
        {t('doctorDashboard.summary.medications.active')}
      </Typography>
      {medications.activePrescriptions.length === 0 ? (
        <Typography color="text.secondary">
          {t('doctorDashboard.summary.medications.noActive')}
        </Typography>
      ) : (
        <Stack spacing={1.25} component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
          {medications.activePrescriptions.map((prescription) => (
            <Box component="li" key={prescription.id} sx={{ display: 'grid', gap: 0.5 }}>
              <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                {nameOf(prescription)}
              </Typography>
              {summaryText(prescription) && (
                <Typography variant="body2" color="text.secondary">
                  {summaryText(prescription)}
                </Typography>
              )}
              <Provenance prescription={prescription} />
            </Box>
          ))}
        </Stack>
      )}
    </SummarySection>
  );
}

function localized(values: Record<string, string>, language: string): string {
  return values[language] ?? values.en ?? Object.values(values)[0] ?? '';
}

export function VaccinesSection({ vaccines }: { vaccines: VaccinesSectionDto }) {
  const { t, i18n } = useTranslation();
  const total = vaccines.given + vaccines.due + vaccines.overdue + vaccines.upcoming;
  const stats: SummaryStat[] = [
    {
      key: 'given',
      label: t('doctorDashboard.summary.vaccines.given'),
      value: whole(vaccines.given),
    },
    { key: 'due', label: t('doctorDashboard.summary.vaccines.due'), value: whole(vaccines.due) },
    {
      key: 'overdue',
      label: t('doctorDashboard.summary.vaccines.overdue'),
      value: whole(vaccines.overdue),
    },
    {
      key: 'upcoming',
      label: t('doctorDashboard.summary.vaccines.upcoming'),
      value: whole(vaccines.upcoming),
    },
  ];
  return (
    <SummarySection
      id="vaccines"
      title={t('doctorDashboard.summary.vaccines.title')}
      icon="vaccine"
      category="health"
    >
      {total === 0 ? (
        <NoData />
      ) : (
        <>
          <StatGrid stats={stats} />
          <Caption>{t('doctorDashboard.summary.vaccines.help')}</Caption>
          <Typography variant="subtitle2" component="h3">
            {t('doctorDashboard.summary.vaccines.dueList')}
          </Typography>
          {vaccines.dueDoses.length === 0 ? (
            <Typography color="text.secondary">
              {t('doctorDashboard.summary.vaccines.noneDue')}
            </Typography>
          ) : (
            <RowList label={t('doctorDashboard.summary.vaccines.dueList')}>
              {vaccines.dueDoses.map((dose) => (
                <Row
                  key={dose.doseId}
                  title={localized(dose.vaccineNames, i18n.language)}
                  detail={localized(dose.doseLabel, i18n.language)}
                  trailing={t('doctorDashboard.summary.vaccines.dueSince', {
                    state: t(`doctorDashboard.summary.vaccines.${dose.state}`),
                    date: formatDate(dose.dueOn, 'dayMonthYear'),
                  })}
                />
              ))}
            </RowList>
          )}
        </>
      )}
    </SummarySection>
  );
}

function latestOf(measurements: readonly MeasurementDto[], key: (typeof METRICS)[number]['key']) {
  return [...measurements]
    .filter((m) => m[key] !== null && m[key] !== undefined)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))[0];
}

export function GrowthSection({
  baby,
  measurements,
}: {
  baby: Baby;
  measurements: MeasurementDto[];
}) {
  const { t } = useTranslation();
  const latest: SummaryStat[] = METRICS.flatMap((metric) => {
    const found = latestOf(measurements, metric.key);
    const value = found?.[metric.key];
    if (!found || value === null || value === undefined) return [];
    return [
      {
        key: metric.key,
        label: metricLabel(metric),
        value: `${formatUnit(value, metric.key === 'weightKg' ? 'kilogram' : 'centimeter')} · ${formatDate(found.date, 'dayMonth')}`,
      },
    ];
  });
  return (
    <SummarySection
      id="growth"
      title={t('doctorDashboard.summary.growth.title')}
      icon="ruler"
      category="activity"
    >
      {measurements.length === 0 ? (
        <NoData />
      ) : (
        <>
          <Typography variant="subtitle2" component="h3">
            {t('doctorDashboard.summary.growth.latest')}
          </Typography>
          <StatGrid stats={latest} />
          {METRICS.map((metric) => (
            <GrowthChart key={metric.key} metric={metric} measurements={measurements} />
          ))}
          <Caption>{t('doctorDashboard.summary.growth.noPercentiles')}</Caption>
        </>
      )}
      <Button
        component={Link}
        to={patientPath(baby.id, 'growth')}
        sx={{ minHeight: 44, justifySelf: 'start' }}
      >
        {t('doctorDashboard.summary.growth.open')}
      </Button>
    </SummarySection>
  );
}

export function NotesSection({ baby, notes }: { baby: Baby; notes: readonly Note[] }) {
  const { t } = useTranslation();
  return (
    <SummarySection
      id="notes"
      title={t('doctorDashboard.summary.notes.title')}
      icon="note"
      category="health"
    >
      <Typography variant="subtitle2" component="h3">
        {t('doctorDashboard.summary.notes.recent')}
      </Typography>
      {notes.length === 0 ? (
        <Typography color="text.secondary">{t('doctorDashboard.summary.notes.none')}</Typography>
      ) : (
        <Stack spacing={1}>
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              own={false}
              authorHasAccess
              onEdit={() => {}}
              onDelete={() => {}}
            />
          ))}
        </Stack>
      )}
      <Button
        component={Link}
        to={patientPath(baby.id, 'notes')}
        sx={{ minHeight: 44, justifySelf: 'start' }}
      >
        {t('doctorDashboard.summary.notes.open')}
      </Button>
    </SummarySection>
  );
}

function formulaSpan(formula: Formula, t: TFunction): string {
  if (!formula.startedOn) return '';
  return t('doctorDashboard.summary.formulas.since', {
    date: formatDate(formula.startedOn, 'dayMonthYear'),
  });
}

export function FormulasSection({
  formulas,
}: {
  formulas: NonNullable<ClinicalSummary['formulas']>;
}) {
  const { t } = useTranslation();
  const label = (formula: Formula) =>
    [formula.name, formula.brand, formula.stage].filter(Boolean).join(' · ');
  const past = formulas.history.filter((formula) => formula.id !== formulas.current?.id);
  return (
    <SummarySection
      id="formulas"
      title={t('doctorDashboard.summary.formulas.title')}
      icon="flask"
      category="feeding"
    >
      {!formulas.current && formulas.history.length === 0 ? (
        <NoData />
      ) : (
        <>
          <Typography variant="subtitle2" component="h3">
            {t('doctorDashboard.summary.formulas.current')}
          </Typography>
          {formulas.current ? (
            <RowList label={t('doctorDashboard.summary.formulas.current')}>
              <Row title={label(formulas.current)} detail={formulaSpan(formulas.current, t)} />
            </RowList>
          ) : (
            <Typography color="text.secondary">
              {t('doctorDashboard.summary.formulas.none')}
            </Typography>
          )}
          {past.length > 0 && (
            <>
              <Typography variant="subtitle2" component="h3">
                {t('doctorDashboard.summary.formulas.history')}
              </Typography>
              <RowList label={t('doctorDashboard.summary.formulas.history')}>
                {past.map((formula) => (
                  <Row key={formula.id} title={label(formula)} detail={formulaSpan(formula, t)} />
                ))}
              </RowList>
            </>
          )}
        </>
      )}
    </SummarySection>
  );
}
