import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { Alert, Box, Button, Skeleton, Stack, Typography } from '@mui/material';
import { APPOINTMENT_LIMITS } from '../appointments/appointmentModel';
import { AppointmentSheet } from '../appointments/AppointmentSheet';
import { dayKeyOf } from '../appointments/calendarModel';
import { canWrite, isCaregiver, isOwner } from '../baby/permissions';
import type { Baby, Vaccination } from '../db/models';
import { useNow } from '../events/time';
import { currentLocale } from '../i18n/i18n';
import { useNotificationLink } from '../notifications/notificationLinkContext';
import { CategoryIcon } from '../ui/CategoryIcon';
import { SegmentedControl } from '../ui/form';
import { Icon } from '../ui/Icon';
import { announceUndo } from '../ui/undoNotice';
import { useVaccinationCommands, useVaccinations } from './useVaccinations';
import { useVaccineSchedule } from './useVaccineSchedule';
import { VaccinationSheet, type RecordPreset } from './VaccinationSheet';
import { VaccineHistory } from './VaccineHistory';
import { VACCINE_FILTERS, overviewOf, type DoseView, type VaccineFilter } from './vaccineModel';
import { VaccineProfileBlock } from './VaccineProfileBlock';
import { VaccineSourcesSheet } from './VaccineSourcesSheet';
import { VaccineTimeline } from './VaccineTimeline';
import { recordName, vaccineName } from './vaccineText';

type Open =
  | { kind: 'record'; preset?: RecordPreset }
  | { kind: 'edit'; id: string }
  | { kind: 'schedule'; title: string; day: string }
  | { kind: 'sources' }
  | null;

function EmptyState({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <Box sx={{ display: 'grid', justifyItems: 'center', gap: 1.5, py: 3, textAlign: 'center' }}>
      <CategoryIcon name="vaccine" category="health" size={32} />
      <Typography variant="h6" component="h2">
        {title}
      </Typography>
      <Typography color="text.secondary">{body}</Typography>
      {children}
    </Box>
  );
}

/** Opens nothing: a vaccine reminder lands on this page, so its link is done once the page shows. */
function useConsumeLink(babyId: string) {
  const links = useNotificationLink();
  const link = links?.link;
  useEffect(() => {
    if (link?.kind === 'vaccine' && link.babyId === babyId) links?.consume();
  }, [link, links, babyId]);
}

/**
 * The vaccines of one baby (docs/design/18-vaccines.md): what the baby's schedule says (grouped by
 * recommended age, filtered by network), what was recorded, and the answers the schedule depends on.
 * Owners and Parents record, edit, delete and schedule; everybody else reads. Offline first: the
 * schedule and the records come from the device.
 */
export function VaccinesScreen({
  baby,
  initialNow,
  initialFilter = 'all',
}: {
  baby: Baby;
  /** A fixed clock (tests and previews). */
  initialNow?: number;
  initialFilter?: VaccineFilter;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const language = currentLocale();
  const clock = useNow(60_000);
  const now = initialNow ?? clock;
  const today = dayKeyOf(now);
  const writable = canWrite(baby);
  const { schedule } = useVaccineSchedule();
  const records = useVaccinations(baby.id);
  const commands = useVaccinationCommands();
  const [filter, setFilter] = useState<VaccineFilter>(initialFilter);
  const [open, setOpen] = useState<Open>(null);
  useConsumeLink(baby.id);

  const overview = useMemo(
    () => (schedule && records ? overviewOf({ schedule, baby, records, today }) : null),
    [schedule, records, baby, today],
  );

  if (schedule === undefined || records === undefined) {
    return (
      <Stack spacing={2} role="status" aria-busy="true" aria-label={t('common.loading')}>
        <Skeleton variant="rounded" height={44} />
        <Skeleton variant="rounded" height={160} />
        <Skeleton variant="rounded" height={240} />
      </Stack>
    );
  }

  const editing =
    open?.kind === 'edit' ? records.find((record) => record.id === open.id) : undefined;
  const close = () => setOpen(null);

  const remove = async (record: Vaccination) => {
    const name = recordName(schedule, record, language);
    const terms = await commands.remove(record.id);
    if (terms) {
      announceUndo(t('vaccines.deleted', { name }), async () => {
        await commands.create(baby.id, terms);
      });
    }
  };
  const recordById = (id: string) => records.find((record) => record.id === id);

  const scheduleIt = ({ dose, status }: DoseView) => {
    const name = vaccineName(schedule, dose.vaccineKey, language);
    const dueOn = status.dueOn;
    setOpen({
      kind: 'schedule',
      title: t('vaccines.scheduleTitle', { name }).slice(0, APPOINTMENT_LIMITS.title),
      day: dueOn !== null && dueOn > today ? dueOn : today,
    });
  };

  return (
    <Stack spacing={2.5}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="h4" component="h1" sx={{ flex: 1 }}>
          {t('vaccines.title')}
        </Typography>
        {writable && (
          <Button
            variant="contained"
            startIcon={<Icon name="add" size={20} />}
            onClick={() => setOpen({ kind: 'record' })}
            sx={{ minHeight: 48, borderRadius: '999px' }}
          >
            {t('vaccines.record')}
          </Button>
        )}
      </Box>
      {!writable && (
        <Alert severity="info">
          {t(isCaregiver(baby) ? 'vaccines.caregiverNotice' : 'vaccines.viewerNotice')}
        </Alert>
      )}
      <Box>
        <Button
          component={RouterLink}
          to="/vaccines/card"
          variant="text"
          startIcon={<Icon name="note" size={20} />}
          sx={{ minHeight: 44, borderRadius: '999px' }}
        >
          {t('vaccines.cardLink')}
        </Button>
      </Box>
      <VaccineProfileBlock baby={baby} writable={writable} now={new Date(now)} />
      {overview?.prematureNotice && <Alert severity="info">{t('vaccines.premature')}</Alert>}

      {schedule === null ? (
        <EmptyState title={t('vaccines.noSchedule.title')} body={t('vaccines.noSchedule.body')} />
      ) : overview === null ? (
        <EmptyState title={t('vaccines.noBirthDate.title')} body={t('vaccines.noBirthDate.body')}>
          {isOwner(baby) ? (
            <Button
              variant="contained"
              onClick={() => void navigate('/settings#baby')}
              sx={{ minHeight: 48, borderRadius: '999px', px: 3 }}
            >
              {t('vaccines.noBirthDate.action')}
            </Button>
          ) : (
            <Typography color="text.secondary">{t('vaccines.noBirthDate.ownerOnly')}</Typography>
          )}
        </EmptyState>
      ) : (
        <Stack spacing={1.5}>
          <SegmentedControl<VaccineFilter>
            aria-label={t('vaccines.filters.label')}
            value={filter}
            onChange={(next) => next && setFilter(next)}
            options={VACCINE_FILTERS.map((value) => ({
              value,
              label: t(`vaccines.filters.${value}`),
            }))}
          />
          {filter === 'private' && baby.vaccineProfile !== 'public+private' && (
            <Typography variant="body2" color="text.secondary">
              {t('vaccines.privateHint')}
            </Typography>
          )}
          <VaccineTimeline
            views={overview.views}
            schedule={schedule}
            filter={filter}
            today={today}
            writable={writable}
            onRecord={({ dose }) =>
              setOpen({
                kind: 'record',
                preset: { vaccineKey: dose.vaccineKey, doseId: dose.doseId },
              })
            }
            onSchedule={scheduleIt}
            onEdit={(id) => setOpen({ kind: 'edit', id })}
            onDelete={(id) => {
              const record = recordById(id);
              if (record) void remove(record);
            }}
          />
        </Stack>
      )}

      <VaccineHistory
        records={records}
        schedule={schedule}
        writable={writable}
        onEdit={(record) => setOpen({ kind: 'edit', id: record.id })}
        onDelete={(record) => void remove(record)}
      />

      <Box>
        <Button
          variant="text"
          onClick={() => setOpen({ kind: 'sources' })}
          startIcon={<Icon name="info" size={20} />}
          sx={{ minHeight: 44, borderRadius: '999px' }}
        >
          {t('vaccines.sources.button')}
        </Button>
      </Box>

      {writable && open?.kind === 'record' && (
        <VaccinationSheet
          babyId={baby.id}
          schedule={schedule}
          statuses={overview?.views.map((view) => view.status) ?? []}
          today={today}
          {...(open.preset ? { preset: open.preset } : {})}
          onClose={close}
        />
      )}
      {writable && editing && (
        <VaccinationSheet
          babyId={baby.id}
          schedule={schedule}
          statuses={overview?.views.map((view) => view.status) ?? []}
          today={today}
          record={editing}
          onClose={close}
        />
      )}
      {writable && open?.kind === 'schedule' && (
        <AppointmentSheet
          babyId={baby.id}
          initialDay={open.day}
          prefill={{ title: open.title, type: 'vaccine' }}
          now={now}
          onClose={close}
        />
      )}
      {open?.kind === 'sources' && <VaccineSourcesSheet schedule={schedule} onClose={close} />}
    </Stack>
  );
}
