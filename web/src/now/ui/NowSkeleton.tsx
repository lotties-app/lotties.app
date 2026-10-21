import { useTranslation } from 'react-i18next';
import { Box, Skeleton, Stack } from '@mui/material';
import { RADIUS } from '../../theme/tokens';

/** Placeholder shapes of Now while the local data loads (no spinner, no layout jump). */
export function NowSkeleton() {
  const { t } = useTranslation();
  return (
    <Stack spacing={2} role="status" aria-busy="true" aria-label={t('common.loading')}>
      <Skeleton variant="rounded" height={248} sx={{ borderRadius: `${RADIUS.card}px` }} />
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.5 }}>
        {[0, 1, 2, 3].map((index) => (
          <Skeleton
            key={index}
            variant="rounded"
            height={96}
            sx={{ borderRadius: `${RADIUS.tile}px` }}
          />
        ))}
      </Box>
    </Stack>
  );
}
