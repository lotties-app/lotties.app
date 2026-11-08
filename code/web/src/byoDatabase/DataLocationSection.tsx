import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { Link, Stack, Typography } from '@mui/material';
import type { Baby } from '../db/models';
import { SettingsSection } from '../settings/SettingsSection';
import { useDataStore } from './useDataStore';

/**
 * Settings > Where your data lives: a short summary and the way to the screen. Shown only to the
 * baby's Owner and only when the server offers the feature to her (a 404, an error or offline:
 * nothing at all, no entry and no hint).
 */
export function DataLocationSection({ baby, expanded }: { baby: Baby; expanded: boolean }) {
  const { t } = useTranslation();
  const { data } = useDataStore(baby);
  if (!data) return null;
  const own = data.kind === 'own';
  return (
    <SettingsSection id="data-location" title={t('byoDatabase.title')} defaultExpanded={expanded}>
      <Stack spacing={0.5}>
        <Typography variant="body2">
          {own
            ? t('byoDatabase.section.own', { provider: data.store?.providerLabel ?? '' })
            : t('byoDatabase.section.hosted')}
        </Typography>
        <Link
          component={RouterLink}
          to="/settings/data-location"
          sx={{
            alignSelf: 'flex-start',
            minHeight: 44,
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          {t('byoDatabase.section.open')}
        </Link>
      </Stack>
    </SettingsSection>
  );
}
