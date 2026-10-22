import { useTranslation } from 'react-i18next';
import { Box, IconButton, Typography } from '@mui/material';
import type { Vaccination } from '../db/models';
import { formatDate } from '../i18n/format';
import { currentLocale } from '../i18n/i18n';
import { RADIUS } from '../theme/tokens';
import { Icon } from '../ui/Icon';
import type { VaccineSchedule } from './vaccineSchedule';
import { networkText, recordDoseLabel, recordName } from './vaccineText';

interface Props {
  records: readonly Vaccination[];
  schedule: VaccineSchedule | null | undefined;
  writable: boolean;
  onEdit: (record: Vaccination) => void;
  onDelete: (record: Vaccination) => void;
}

/**
 * Every vaccine recorded for the baby, newest first: the schedule's ones and the ones the family
 * typed in, including records of doses the schedule no longer lists (they keep the dose label saved
 * with them).
 */
export function VaccineHistory({ records, schedule, writable, onEdit, onDelete }: Props) {
  const { t } = useTranslation();
  const language = currentLocale();
  return (
    <Box
      component="section"
      aria-labelledby="vaccine-history-title"
      sx={{ display: 'grid', gap: 1.5 }}
    >
      <Typography id="vaccine-history-title" variant="h6" component="h2">
        {t('vaccines.history.title')}
      </Typography>
      {records.length === 0 ? (
        <Typography color="text.secondary">{t('vaccines.history.empty')}</Typography>
      ) : (
        <Box component="ul" sx={{ m: 0, p: 0, display: 'grid', gap: 1 }}>
          {records.map((record) => {
            const name = recordName(schedule, record, language);
            const dose = recordDoseLabel(schedule, record, language);
            const place = [
              record.clinic,
              record.lot ? t('vaccines.history.lot', { lot: record.lot }) : null,
              record.administeredBy
                ? t('vaccines.history.by', { name: record.administeredBy })
                : null,
            ].filter(Boolean);
            const named = { name, date: formatDate(record.givenOn) };
            return (
              <Box
                key={record.id}
                component="li"
                sx={{
                  listStyle: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  p: 1.5,
                  borderRadius: `${RADIUS.tile}px`,
                  backgroundColor: 'background.paper',
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{name}</Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ overflowWrap: 'anywhere' }}
                  >
                    {[dose, formatDate(record.givenOn), networkText(t, record)]
                      .filter(Boolean)
                      .join(' · ')}
                  </Typography>
                  {place.length > 0 && (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ overflowWrap: 'anywhere' }}
                    >
                      {place.join(' · ')}
                    </Typography>
                  )}
                </Box>
                {writable && (
                  <>
                    <IconButton
                      aria-label={t('vaccines.history.editNamed', named)}
                      onClick={() => onEdit(record)}
                      sx={{ width: 44, height: 44 }}
                    >
                      <Icon name="edit" size={20} />
                    </IconButton>
                    <IconButton
                      aria-label={t('vaccines.history.deleteNamed', named)}
                      onClick={() => onDelete(record)}
                      sx={{ width: 44, height: 44 }}
                    >
                      <Icon name="delete" size={20} />
                    </IconButton>
                  </>
                )}
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
