import { useTranslation } from 'react-i18next';
import { Button, Card, Stack, Typography } from '@mui/material';
import { CategoryIcon } from '../ui/CategoryIcon';

interface Props {
  offline: boolean;
  onRetry: () => void;
}

/**
 * Now when the babies could not be loaded yet (API unreachable, 5xx, offline on a fresh device):
 * a calm retry card instead of "Create baby", which would invite duplicate babies.
 */
export function ServerUnreachableCard({ offline, onRetry }: Props) {
  const { t } = useTranslation();
  return (
    <Card
      component="section"
      aria-labelledby="server-unreachable-title"
      sx={{ p: 3, my: 2, maxWidth: 420, mx: 'auto' }}
    >
      <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center' }}>
        <CategoryIcon name="cloud-off" category="custom" size={32} />
        <Typography id="server-unreachable-title" variant="h4" component="h2">
          {t('home.unreachable.title')}
        </Typography>
        <Typography color="text.secondary">
          {offline ? t('home.unreachable.offline') : t('home.unreachable.body')}
        </Typography>
        <Button variant="outlined" onClick={onRetry} sx={{ minHeight: 48 }}>
          {t('common.retry')}
        </Button>
      </Stack>
    </Card>
  );
}
