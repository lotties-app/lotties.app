import { useTranslation } from 'react-i18next';
import { Box, Chip, Link, Stack, Typography } from '@mui/material';
import { formatDate } from '../i18n/format';
import { SheetFrame } from '../now/ui/SheetFrame';
import { RADIUS } from '../theme/tokens';
import { Icon } from '../ui/Icon';
import type { VaccineSchedule } from './vaccineSchedule';
import { sourceBadge } from './vaccineText';

/** Links from the data are shown only when they are web addresses. */
function isWebAddress(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * Where the schedule comes from: the public calendar (PNI) and the two pediatric societies (SBP,
 * SBIm), each with its edition, the day it was read and a link, and the reminder that the schedule
 * is informational.
 */
export function VaccineSourcesSheet({
  schedule,
  onClose,
}: {
  schedule: VaccineSchedule | null | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <SheetFrame open onClose={onClose} title={t('vaccines.sources.title')}>
      <Stack spacing={2}>
        <Typography>{t('vaccines.sources.informational')}</Typography>
        {schedule && (
          <Box component="ul" sx={{ m: 0, p: 0, display: 'grid', gap: 1.5 }}>
            {schedule.sources.map((source) => (
              <Box
                key={source.id}
                component="li"
                sx={{
                  listStyle: 'none',
                  display: 'grid',
                  gap: 0.75,
                  p: 1.5,
                  borderRadius: `${RADIUS.tile}px`,
                  backgroundColor: 'background.default',
                }}
              >
                <Box>
                  <Chip size="small" variant="outlined" label={sourceBadge(t, source.id)} />
                </Box>
                <Typography sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>
                  {source.name}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('vaccines.sources.edition', { edition: source.edition })}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('vaccines.sources.retrieved', { date: formatDate(source.retrievedOn) })}
                </Typography>
                {isWebAddress(source.url) && (
                  <Link
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t('vaccines.sources.openNamed', {
                      name: sourceBadge(t, source.id),
                    })}
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 0.5,
                      minHeight: 44,
                      width: 'fit-content',
                    }}
                  >
                    {t('vaccines.sources.open')}
                    <Icon name="arrow-right" size={16} />
                  </Link>
                )}
              </Box>
            ))}
          </Box>
        )}
      </Stack>
    </SheetFrame>
  );
}
