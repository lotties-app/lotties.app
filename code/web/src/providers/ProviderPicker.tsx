import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Stack, Typography } from '@mui/material';
import { useCareProviders } from '../db/hooks';
import type { CareProvider } from '../db/models';
import { Icon } from '../ui/Icon';
import { Field } from '../ui/form';
import { optionBase, palette } from '../ui/form/styles';
import { ProviderSearchField } from './ProviderSearchField';
import { ProviderSheet } from './ProviderSheet';
import { providerOf, searchProviders } from './providerModel';
import { useSpecialtyLabel } from './useSpecialtyLabel';

/** The saved doctors offered at once (the search narrows the rest). */
const SHOWN = 5;

interface Props {
  babyId: string;
  /** The linked provider's id, if any. */
  providerId: string | null;
  /** A provider was picked (or, with `null`, the link was removed). */
  onPick: (provider: CareProvider | null) => void;
}

/**
 * The appointment form's care provider field (docs/design/22-care-providers.md): search the baby's
 * saved doctors (favorites first) and tap one to fill in the doctor and the place, or "Add new
 * provider" to create one inline and select it. Once picked, the provider shows as a card with
 * "Remove": that only drops the link, the copied text stays. Hidden text edits afterwards never
 * change the provider.
 */
export function ProviderPicker({ babyId, providerId, onPick }: Props) {
  const { t } = useTranslation();
  const providers = useCareProviders(babyId);
  const { labelOf } = useSpecialtyLabel();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  if (!providers) return null;

  const linked = providerOf({ providerId }, providers);
  const matches = searchProviders(providers, query, labelOf);
  const shown = matches.slice(0, SHOWN);

  const pick = (provider: CareProvider) => {
    setQuery('');
    onPick(provider);
  };

  return (
    <>
      <Field
        label={t('providers.picker.label')}
        optional
        icon="stethoscope"
        group
        help={t('providers.picker.help')}
      >
        {providerId ? (
          <Box
            sx={(theme) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              p: 1.5,
              borderRadius: 2,
              border: `1px solid ${palette(theme).divider}`,
            })}
          >
            <Box sx={{ minWidth: 0, flexGrow: 1 }}>
              <Typography sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>
                {linked ? linked.name : t('providers.picker.removed')}
              </Typography>
              {linked && labelOf(linked.specialty) && (
                <Typography variant="body2" color="text.secondary">
                  {labelOf(linked.specialty)}
                </Typography>
              )}
            </Box>
            <Button
              onClick={() => onPick(null)}
              aria-label={t('providers.picker.removeNamed', { name: linked?.name ?? '' })}
              sx={{ minHeight: 44, flex: 'none' }}
            >
              {t('providers.picker.remove')}
            </Button>
          </Box>
        ) : (
          <Stack spacing={1.25}>
            {providers.some((p) => !p.deleted) && (
              <>
                <ProviderSearchField
                  value={query}
                  onChange={setQuery}
                  label={t('providers.picker.search')}
                />
                {shown.length > 0 ? (
                  <Box
                    component="ul"
                    aria-label={t('providers.picker.results')}
                    sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 0.75 }}
                  >
                    {shown.map((provider) => (
                      <li key={provider.id}>
                        <Box
                          component="button"
                          type="button"
                          onClick={() => pick(provider)}
                          sx={(theme) => ({
                            ...optionBase(theme),
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                            width: '100%',
                            minHeight: 48,
                            px: 1.75,
                            py: 0.75,
                            borderRadius: 2,
                            textAlign: 'start',
                            backgroundColor: palette(theme).surfaceRaised,
                            color: palette(theme).text.primary,
                          })}
                        >
                          {provider.favorite && <Icon name="star-filled" size={16} />}
                          <Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                            {provider.name}
                            {labelOf(provider.specialty) && (
                              <Box component="span" sx={{ color: 'text.secondary' }}>
                                {' · '}
                                {labelOf(provider.specialty)}
                              </Box>
                            )}
                          </Box>
                        </Box>
                      </li>
                    ))}
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary" role="status">
                    {t('providers.picker.noMatch')}
                  </Typography>
                )}
                {matches.length > SHOWN && (
                  <Typography variant="caption" color="text.secondary">
                    {t('providers.picker.more', { count: matches.length - SHOWN })}
                  </Typography>
                )}
              </>
            )}
            <Button
              variant="outlined"
              startIcon={<Icon name="add" size={20} />}
              onClick={() => setCreating(true)}
              sx={{ minHeight: 48, alignSelf: 'flex-start' }}
            >
              {t('providers.picker.addNew')}
            </Button>
          </Stack>
        )}
      </Field>
      {/* Outside the field: the sheet has fields of its own. */}
      {creating && (
        <ProviderSheet
          babyId={babyId}
          initialName={query.trim()}
          onClose={() => setCreating(false)}
          onSaved={pick}
        />
      )}
    </>
  );
}
