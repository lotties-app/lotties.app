import { useTranslation } from 'react-i18next';
import { Typography } from '@mui/material';
import { Icon } from '../ui/Icon';

const KEYS = {
  timer: 'access.lockedTimer',
  entry: 'access.lockedEntry',
  control: 'access.controlOnly',
} as const;

/**
 * Why a control is turned off: someone else logged this entry and the user (a Caregiver) changes
 * only their own. `name` is who logged it (`''` while unknown). `kind` words it for a running
 * timer ("Started by"), any entry ("Added by"), or a running timer the user may stop and pause
 * but not otherwise change.
 */
export function LockedNote({
  name,
  kind = 'timer',
}: {
  name: string;
  kind?: 'timer' | 'entry' | 'control';
}) {
  const { t } = useTranslation();
  const who = name || t('access.someoneElse');
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      component="p"
      sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
    >
      <Icon name="info" size={16} />
      {t(KEYS[kind], { name: who })}
    </Typography>
  );
}
