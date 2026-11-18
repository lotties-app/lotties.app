import { useTranslation } from 'react-i18next';
import { Chip } from '@mui/material';
import type { PriorOrigin } from '../sync/contract';

const ORIGIN_COLOR: Record<PriorOrigin, 'default' | 'info' | 'success'> = {
  PublishedNorm: 'default',
  CommunityStatic: 'info',
  CommunityLive: 'success',
};

interface Props {
  origin: PriorOrigin | undefined;
}

/**
 * A small chip showing where a prediction's prior came from. Facts only, never advice.
 * Renders nothing when the origin is absent (older servers).
 */
export function OriginBadge({ origin }: Props) {
  const { t } = useTranslation();
  if (!origin) return null;
  const label =
    origin === 'PublishedNorm'
      ? t('predictionOrigin.publishedNorm')
      : origin === 'CommunityStatic'
        ? t('predictionOrigin.communityStatic')
        : t('predictionOrigin.communityLive');
  return (
    <Chip
      size="small"
      variant="outlined"
      color={ORIGIN_COLOR[origin]}
      label={label}
      aria-label={label}
    />
  );
}