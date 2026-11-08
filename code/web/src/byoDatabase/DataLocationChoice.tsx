import { useTranslation } from 'react-i18next';
import { Box, Chip, Paper, Stack, Typography } from '@mui/material';
import type { DataStoreKind } from './dataStoreApi';

const LIMITS = [
  'operator',
  'notE2ee',
  'pause',
  'backups',
  'responsibility',
  'ownerOnly',
  'leave',
] as const;

function Option({ kind, current }: { kind: DataStoreKind; current: boolean }) {
  const { t } = useTranslation();
  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, borderColor: current ? 'primary.main' : undefined, borderWidth: current ? 2 : 1 }}
    >
      <Stack spacing={1}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
          useFlexGap
        >
          <Typography variant="subtitle1" component="h3">
            {t(`byoDatabase.options.${kind}.title`)}
          </Typography>
          {current && (
            <Chip size="small" color="primary" label={t('byoDatabase.options.current')} />
          )}
        </Stack>
        <Typography variant="body2">{t(`byoDatabase.options.${kind}.body`)}</Typography>
      </Stack>
    </Paper>
  );
}

/**
 * The two places a baby's records can live, in plain words, with the honest limits of the second
 * (docs/design/47-bring-your-own-database.md sections 8.1, 10 and 13: Lotties still reads the data,
 * free plans may pause and keep no backups, Owner only for now).
 */
export function DataLocationChoice({ current }: { current: DataStoreKind }) {
  const { t } = useTranslation();
  return (
    <Stack spacing={2}>
      <Option kind="hosted" current={current === 'hosted'} />
      <Option kind="own" current={current === 'own'} />
      <Stack spacing={0.5}>
        <Typography variant="subtitle1" component="h3">
          {t('byoDatabase.limits.title')}
        </Typography>
        <Box component="ul" sx={{ m: 0, pl: 3, display: 'grid', gap: 0.75 }}>
          {LIMITS.map((limit) => (
            <Typography key={limit} component="li" variant="body2">
              {t(`byoDatabase.limits.${limit}`)}
            </Typography>
          ))}
        </Box>
      </Stack>
    </Stack>
  );
}
