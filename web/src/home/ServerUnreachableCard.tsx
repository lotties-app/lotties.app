import { useTranslation } from 'react-i18next';
import { Button, Stack, Typography } from '@mui/material';
import { Icon } from '../ui/Icon';

interface Props {
  offline: boolean;
  onRetry: () => void;
}

/**
 * Home when the babies could not be loaded yet (API unreachable, 5xx, offline on a fresh device):
 * a calm retry card instead of "Create baby", which would invite duplicate babies.
 */
export function ServerUnreachableCard({ offline, onRetry }: Props) {
  const { t } = useTranslation();
  return (
    <Stack
      component="section"
      aria-labelledby="server-unreachable-title"
      spacing={2}
      sx={{ py: 4, maxWidth: 420, mx: 'auto', alignItems: 'center', textAlign: 'center' }}
    >
      <Icon name="cloud-off" size={40} sx={{ color: 'action.active' }} />
      <Typography id="server-unreachable-title" variant="h6" component="h2">
        {t('home.unreachable.title')}
      </Typography>
      <Typography color="text.secondary">
        {offline ? t('home.unreachable.offline') : t('home.unreachable.body')}
      </Typography>
      <Button variant="outlined" onClick={onRetry} sx={{ minHeight: 48 }}>
        {t('common.retry')}
      </Button>
    </Stack>
  );
}
