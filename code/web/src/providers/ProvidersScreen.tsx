import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Card, Stack, Typography } from '@mui/material';
import { canWrite } from '../baby/permissions';
import { useCareProviders } from '../db/hooks';
import type { Baby, CareProvider } from '../db/models';
import { CategoryIcon } from '../ui/CategoryIcon';
import { Icon } from '../ui/Icon';
import { optionBase, palette } from '../ui/form/styles';
import { ProviderDetailSheet } from './ProviderDetailSheet';
import { ProviderSearchField } from './ProviderSearchField';
import { ProviderSheet } from './ProviderSheet';
import { activeProviders, registrationLine, searchProviders } from './providerModel';
import { useSpecialtyLabel } from './useSpecialtyLabel';

type Sheet = { kind: 'detail'; id: string } | { kind: 'edit'; provider?: CareProvider } | null;

function ProviderRow({ provider, onOpen }: { provider: CareProvider; onOpen: () => void }) {
  const { t } = useTranslation();
  const { labelOf } = useSpecialtyLabel();
  const line = [labelOf(provider.specialty), provider.clinicName, registrationLine(provider)]
    .filter(Boolean)
    .join(' · ');
  return (
    <Box
      component="button"
      type="button"
      onClick={onOpen}
      sx={(theme) => ({
        ...optionBase(theme),
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        width: '100%',
        minHeight: 56,
        px: 1.75,
        py: 1,
        borderRadius: 2,
        textAlign: 'start',
        backgroundColor: palette(theme).surfaceRaised,
        color: palette(theme).text.primary,
      })}
    >
      <CategoryIcon name="stethoscope" category="health" size={20} />
      <Box component="span" sx={{ minWidth: 0, flexGrow: 1 }}>
        <Box component="span" sx={{ display: 'block', fontWeight: 500, overflowWrap: 'anywhere' }}>
          {provider.name}
        </Box>
        {line && (
          <Box
            component="span"
            sx={{
              display: 'block',
              fontSize: '0.875rem',
              color: 'text.secondary',
              overflowWrap: 'anywhere',
            }}
          >
            {line}
          </Box>
        )}
      </Box>
      {provider.favorite && (
        <Icon
          name="star-filled"
          size={20}
          label={t('providers.favoriteMark')}
          sx={{ color: 'primary.main' }}
        />
      )}
    </Box>
  );
}

/**
 * "Doctors and clinics" (docs/design/22-care-providers.md): the baby's directory of care providers
 * with search, favorites first, a detail sheet with the contact links, and add / edit for Owners and
 * Parents. Caregivers and Viewers read it. Works offline through the local store and the outbox.
 */
export function ProvidersScreen({ baby }: { baby: Baby }) {
  const { t } = useTranslation();
  const providers = useCareProviders(baby.id);
  const { labelOf } = useSpecialtyLabel();
  const writable = canWrite(baby);
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState<Sheet>(null);
  if (!providers) return null;

  const total = activeProviders(providers).length;
  const shown = searchProviders(providers, query, labelOf);
  const opened =
    sheet?.kind === 'detail' ? providers.find((p) => p.id === sheet.id && !p.deleted) : undefined;

  return (
    <Stack spacing={2}>
      {total === 0 ? (
        <Card variant="outlined" component="section" sx={{ p: 2.5 }}>
          <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
            <CategoryIcon name="stethoscope" category="health" size={32} />
            <Typography variant="h6" component="h2">
              {t('providers.empty.title')}
            </Typography>
            <Typography color="text.secondary">
              {writable ? t('providers.empty.body') : t('providers.empty.bodyReadOnly')}
            </Typography>
          </Stack>
        </Card>
      ) : (
        <>
          <ProviderSearchField value={query} onChange={setQuery} label={t('providers.search')} />
          {shown.length > 0 ? (
            <Box
              component="ul"
              aria-label={t('providers.list')}
              sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 1 }}
            >
              {shown.map((provider) => (
                <li key={provider.id}>
                  <ProviderRow
                    provider={provider}
                    onOpen={() => setSheet({ kind: 'detail', id: provider.id })}
                  />
                </li>
              ))}
            </Box>
          ) : (
            <Typography color="text.secondary" role="status">
              {t('providers.noMatch', { query: query.trim() })}
            </Typography>
          )}
        </>
      )}
      {writable ? (
        <Button
          variant={total === 0 ? 'contained' : 'outlined'}
          startIcon={<Icon name="add" />}
          onClick={() => setSheet({ kind: 'edit' })}
          sx={{ minHeight: 48, alignSelf: 'flex-start' }}
        >
          {t('providers.add')}
        </Button>
      ) : (
        total > 0 && <Typography color="text.secondary">{t('providers.viewOnly')}</Typography>
      )}
      {opened && (
        <ProviderDetailSheet
          provider={opened}
          writable={writable}
          onClose={() => setSheet(null)}
          onEdit={(provider) => setSheet({ kind: 'edit', provider })}
        />
      )}
      {sheet?.kind === 'edit' && (
        <ProviderSheet
          babyId={baby.id}
          {...(sheet.provider ? { provider: sheet.provider } : {})}
          onClose={() => setSheet(null)}
        />
      )}
    </Stack>
  );
}
