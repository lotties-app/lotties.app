import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { Box, ButtonBase, Card, Typography } from '@mui/material';
import { dayKeyOf } from '../appointments/calendarModel';
import type { Baby } from '../db/models';
import { currentLocale } from '../i18n/i18n';
import { CategoryIcon } from '../ui/CategoryIcon';
import { Icon } from '../ui/Icon';
import { useVaccinations } from './useVaccinations';
import { useVaccineSchedule } from './useVaccineSchedule';
import { dueNow, overviewOf } from './vaccineModel';
import { doseTitle } from './vaccineText';

/**
 * "Vaccines due" on Now: how many vaccines may be due according to the schedule and the one that has
 * been waiting the longest; tapping it opens the vaccines page.
 */
export function VaccinesDueCard({ count, first }: { count: number; first: string }) {
  const { t } = useTranslation();
  return (
    <Card component="section" aria-label={t('vaccines.due.label')} sx={{ p: 0 }}>
      <ButtonBase
        component={RouterLink}
        to="/vaccines"
        sx={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          p: 2.5,
          textAlign: 'start',
        }}
      >
        <CategoryIcon name="vaccine" category="health" size={20} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" component="p">
            {t('vaccines.due.label')}
          </Typography>
          <Typography sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>
            {t('vaccines.due.count', { count })}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            {first}
          </Typography>
        </Box>
        <Icon name="chevron-right" size={20} />
      </ButtonBase>
    </Card>
  );
}

/**
 * The card when at least one dose of the baby's schedule is due or overdue today; nothing otherwise
 * (and nothing before the schedule is on the device or without a birth date).
 */
export function VaccinesDue({ baby, now }: { baby: Baby; now: number }) {
  useTranslation();
  const { schedule } = useVaccineSchedule();
  const records = useVaccinations(baby.id);
  const today = dayKeyOf(now);
  const due = useMemo(() => {
    if (!schedule || !records) return [];
    const overview = overviewOf({ schedule, baby, records, today });
    return overview ? dueNow(overview.views) : [];
  }, [schedule, records, baby, today]);
  const first = due[0];
  if (!schedule || !first) return null;
  return (
    <VaccinesDueCard count={due.length} first={doseTitle(schedule, first.dose, currentLocale())} />
  );
}
