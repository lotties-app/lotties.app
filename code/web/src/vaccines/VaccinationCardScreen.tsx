import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, GlobalStyles, Skeleton, Stack, Typography } from '@mui/material';
import type { Baby } from '../db/models';
import { formatDate } from '../i18n/format';
import { currentLocale } from '../i18n/i18n';
import { Icon } from '../ui/Icon';
import { CARD_COLUMNS, CARD_COLUMN_WIDTH, PRINT_STYLES, cardRows } from './vaccinationCard';
import { useVaccinations } from './useVaccinations';
import { useVaccineSchedule } from './useVaccineSchedule';
import { hasBirthDate } from './vaccineModel';
import { visuallyHidden } from './visuallyHidden';
import { networkText, recordDoseLabel, recordName } from './vaccineText';

const cellSx = {
  textAlign: 'start',
  verticalAlign: 'top',
  px: 0.5,
  py: 0.75,
  borderBottom: '1px solid',
  borderColor: 'divider',
  overflowWrap: 'break-word',
  fontSize: '0.75rem',
} as const;

/**
 * `/vaccines/card`: a printable vaccination card of the baby (name, birth date and every recorded
 * vaccine with its date, dose, lot and clinic). "Print / Save as PDF" opens the browser's print
 * dialog; nothing is sent anywhere, so the child's data stays on the device.
 */
export function VaccinationCardScreen({ baby, now }: { baby: Baby; now?: Date }) {
  const { t } = useTranslation();
  const language = currentLocale();
  const { schedule } = useVaccineSchedule();
  const records = useVaccinations(baby.id);

  if (records === undefined || schedule === undefined) {
    return (
      <Stack spacing={2} role="status" aria-busy="true" aria-label={t('common.loading')}>
        <Skeleton variant="rounded" height={44} />
        <Skeleton variant="rounded" height={240} />
      </Stack>
    );
  }

  const rows = cardRows(records);
  return (
    <Stack spacing={2.5}>
      <GlobalStyles styles={PRINT_STYLES} />
      <Box
        data-print-hide
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          flexWrap: 'wrap',
        }}
      >
        <Button
          component={RouterLink}
          to="/vaccines"
          variant="text"
          startIcon={<Icon name="arrow-left" size={20} />}
          sx={{ minHeight: 44, borderRadius: '999px' }}
        >
          {t('vaccines.card.back')}
        </Button>
        <Button
          variant="contained"
          startIcon={<Icon name="share" size={20} />}
          onClick={() => window.print()}
          sx={{ minHeight: 48, borderRadius: '999px' }}
        >
          {t('vaccines.card.print')}
        </Button>
      </Box>
      <Box component="article" className="vaccination-card" sx={{ display: 'grid', gap: 1.5 }}>
        <Typography variant="h4" component="h1">
          {t('vaccines.card.title')}
        </Typography>
        <Box>
          <Typography variant="h6" component="p" sx={{ overflowWrap: 'anywhere' }}>
            {baby.name}
          </Typography>
          {hasBirthDate(baby) && (
            <Typography color="text.secondary">
              {t('vaccines.card.born', { date: formatDate(baby.birthDate) })}
            </Typography>
          )}
        </Box>
        {rows.length === 0 ? (
          <Typography color="text.secondary">{t('vaccines.card.empty')}</Typography>
        ) : (
          <Box
            component="table"
            sx={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}
          >
            <Box component="caption" sx={visuallyHidden}>
              {t('vaccines.card.table', { name: baby.name })}
            </Box>
            <thead>
              <tr>
                {CARD_COLUMNS.map((column) => (
                  <Box
                    key={column}
                    component="th"
                    scope="col"
                    sx={{ ...cellSx, fontWeight: 600, width: CARD_COLUMN_WIDTH[column] }}
                  >
                    {t(`vaccines.card.columns.${column}`)}
                  </Box>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((record) => (
                <tr key={record.id}>
                  <Box component="td" sx={cellSx}>
                    {formatDate(record.givenOn)}
                  </Box>
                  <Box component="td" sx={cellSx}>
                    {recordName(schedule, record, language)}
                  </Box>
                  <Box component="td" sx={cellSx}>
                    {recordDoseLabel(schedule, record, language) ?? ''}
                  </Box>
                  <Box component="td" sx={cellSx}>
                    {record.lot ?? ''}
                  </Box>
                  <Box component="td" sx={cellSx}>
                    {[record.clinic, networkText(t, record)].filter(Boolean).join(' · ')}
                  </Box>
                </tr>
              ))}
            </tbody>
          </Box>
        )}
        <Typography variant="body2" color="text.secondary">
          {t('vaccines.card.note')}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {t('vaccines.card.printedOn', { date: formatDate(now ?? new Date()) })}
        </Typography>
      </Box>
    </Stack>
  );
}
