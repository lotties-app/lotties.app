import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, ButtonBase, Chip, IconButton, Typography } from '@mui/material';
import { currentLocale } from '../i18n/i18n';
import { RADIUS } from '../theme/tokens';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/icons';
import {
  describeStatus,
  needsConfirmation,
  type DoseView,
  type StatusDescriptor,
  type VaccineFilter,
} from './vaccineModel';
import { localized, type VaccineSchedule } from './vaccineSchedule';
import { visuallyHidden } from './visuallyHidden';
import {
  doseLabelOf,
  protectsLine,
  secondaryLine,
  sourceBadge,
  statusLine,
  vaccineName,
  vaccineOf,
} from './vaccineText';

type ChipColor = 'success' | 'primary' | 'warning' | 'default';

/** The tone and icon of each status: a word always comes with them, colour never carries it alone. */
const STATUS_LOOK: Record<StatusDescriptor['kind'], { color: ChipColor; icon: IconName }> = {
  given: { color: 'success', icon: 'success' },
  due: { color: 'primary', icon: 'bell' },
  overdue: { color: 'warning', icon: 'clock' },
  dueIn: { color: 'default', icon: 'calendar' },
  dueOn: { color: 'default', icon: 'calendar' },
  waiting: { color: 'default', icon: 'clock' },
  notInPublic: { color: 'default', icon: 'lock' },
  expired: { color: 'default', icon: 'info' },
};

/** Chips whose text is a sentence: it wraps instead of being cut off. */
const wrappingChip = {
  height: 'auto',
  maxWidth: '100%',
  '& .MuiChip-label': { whiteSpace: 'normal', py: 0.5, overflowWrap: 'anywhere' },
} as const;

/** "Confirm this with your pediatrician": a note on a dose the data flags or the sources disagree on. */
function ConfirmMarker({ notes }: { notes: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const label = (
    <>
      <Icon name="info" size={16} />
      <span>{t('vaccines.dose.confirm')}</span>
    </>
  );
  return (
    <Box>
      {notes ? (
        <ButtonBase
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.75,
            minHeight: 40,
            py: 0.5,
            borderRadius: 1,
            fontSize: '0.8125rem',
            color: 'text.secondary',
            textAlign: 'start',
          }}
        >
          {label}
          <Icon name={open ? 'collapse' : 'expand'} size={16} />
        </ButtonBase>
      ) : (
        <Box
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.75,
            py: 0.5,
            fontSize: '0.8125rem',
            color: 'text.secondary',
          }}
        >
          {label}
        </Box>
      )}
      {open && notes && (
        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
          {notes}
        </Typography>
      )}
    </Box>
  );
}

interface Props {
  view: DoseView;
  views: readonly DoseView[];
  schedule: VaccineSchedule;
  filter: VaccineFilter;
  today: string;
  writable: boolean;
  onRecord: (view: DoseView) => void;
  onSchedule: (view: DoseView) => void;
  onEdit: (recordId: string) => void;
  onDelete: (recordId: string) => void;
}

/**
 * One dose of the schedule: the vaccine and dose, what it protects against, its status (a chip with
 * an icon and words), where it is recommended from and, for Owners and Parents, Record and Schedule
 * it (or Edit and Delete once recorded).
 */
export function DoseCard({
  view,
  views,
  schedule,
  filter,
  today,
  writable,
  onRecord,
  onSchedule,
  onEdit,
  onDelete,
}: Props) {
  const { t } = useTranslation();
  const language = currentLocale();
  const { dose, status } = view;
  const name = vaccineName(schedule, dose.vaccineKey, language);
  const doseLabel = doseLabelOf(dose, language);
  const descriptor = describeStatus(view, today);
  const look = STATUS_LOOK[descriptor.kind];
  const product =
    descriptor.kind === 'given' && descriptor.coveredBy !== null
      ? schedule.doses.find((candidate) => candidate.doseId === descriptor.coveredBy)
      : undefined;
  const productName = product ? vaccineName(schedule, product.vaccineKey, language) : undefined;
  const protects = protectsLine(t, vaccineOf(schedule, dose.vaccineKey), language);
  const second = secondaryLine(t, view, descriptor);
  const given = descriptor.kind === 'given';
  const named = { name, dose: doseLabel };

  return (
    <Box
      component="li"
      sx={{
        listStyle: 'none',
        display: 'grid',
        gap: 1,
        p: 1.5,
        borderRadius: `${RADIUS.tile}px`,
        backgroundColor: 'background.paper',
        minWidth: 0,
      }}
    >
      <Box>
        <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{name}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
          {doseLabel}
        </Typography>
        {protects && (
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            {protects}
          </Typography>
        )}
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75 }}>
        <Chip
          size="small"
          variant="outlined"
          color={look.color}
          icon={<Icon name={look.icon} size={16} />}
          label={statusLine(t, descriptor, productName ? { product: productName } : {})}
          sx={wrappingChip}
        />
        {dose.recurrence !== null && (
          <Chip
            size="small"
            variant="outlined"
            icon={<Icon name="exchange" size={16} />}
            label={t('vaccines.dose.yearly')}
          />
        )}
        {dose.network === 'private' && status.state !== 'notApplicable' && (
          <Chip
            size="small"
            variant="outlined"
            icon={<Icon name="medical-cross" size={16} />}
            label={t('vaccines.dose.privateClinic')}
          />
        )}
      </Box>
      {second && (
        <Typography variant="body2" color="text.secondary">
          {second}
        </Typography>
      )}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75 }}>
        <Box component="span" sx={visuallyHidden}>
          {t('vaccines.dose.recommendedBy')}
        </Box>
        {dose.sources.map((source) => (
          <Chip
            key={source}
            size="small"
            variant="outlined"
            label={sourceBadge(t, source)}
            sx={{ color: 'text.secondary' }}
          />
        ))}
      </Box>
      {needsConfirmation(view, views, filter) && (
        <ConfirmMarker notes={localized(dose.notes, language)} />
      )}
      {writable && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {given && status.recordId !== null ? (
            <>
              <IconButton
                aria-label={t('vaccines.dose.editNamed', named)}
                onClick={() => onEdit(status.recordId ?? '')}
                sx={{ width: 44, height: 44 }}
              >
                <Icon name="edit" size={20} />
              </IconButton>
              <IconButton
                aria-label={t('vaccines.dose.deleteNamed', named)}
                onClick={() => onDelete(status.recordId ?? '')}
                sx={{ width: 44, height: 44 }}
              >
                <Icon name="delete" size={20} />
              </IconButton>
            </>
          ) : (
            <>
              <Button
                variant="outlined"
                aria-label={t('vaccines.dose.recordNamed', named)}
                startIcon={<Icon name="add" size={20} />}
                onClick={() => onRecord(view)}
                sx={{ minHeight: 44, borderRadius: '999px' }}
              >
                {t('vaccines.dose.record')}
              </Button>
              {status.state !== 'expired' && (
                <Button
                  variant="text"
                  aria-label={t('vaccines.dose.scheduleNamed', named)}
                  startIcon={<Icon name="calendar-plus" size={20} />}
                  onClick={() => onSchedule(view)}
                  sx={{ minHeight: 44, borderRadius: '999px' }}
                >
                  {t('vaccines.dose.scheduleIt')}
                </Button>
              )}
            </>
          )}
        </Box>
      )}
    </Box>
  );
}
