import { useTranslation } from 'react-i18next';
import { Stack, Typography } from '@mui/material';
import { ProviderGuide } from './ProviderGuide';
import { PROVIDERS } from './providers';

/**
 * `/help/own-database`: the provider guides of the setup wizard on one page (static text, works
 * offline). A fuller user guide is a later change.
 */
export function OwnDatabaseGuide() {
  const { t } = useTranslation();
  return (
    <Stack spacing={3}>
      <Typography variant="body1">{t('byoDatabase.help.intro')}</Typography>
      <Typography variant="body2" color="text.secondary">
        {t('byoDatabase.provider.prices')}
      </Typography>
      {PROVIDERS.map((provider) => (
        <ProviderGuide key={provider} provider={provider} headingLevel="h2" />
      ))}
    </Stack>
  );
}
