import { useTranslation } from 'react-i18next';
import { Stack, TextField, Typography } from '@mui/material';
import type { MedicationSuggestion } from '../sync/contract';
import type { MappingChoice } from './importModel';

export interface CatalogOption {
  id: string;
  name: string;
}

interface Props {
  suggestion: MedicationSuggestion;
  choice: MappingChoice;
  catalog: CatalogOption[];
  problem?: string;
  onChange: (choice: MappingChoice) => void;
}

const SELECT = { select: { native: true } } as const;

/** One medication name found in the file and the decision for it. */
export function MappingRow({ suggestion, choice, catalog, problem, onChange }: Props) {
  const { t } = useTranslation();
  const { token } = suggestion;
  const changeAction = (action: string) => {
    if (action === 'ignore') return onChange({ action: 'ignore' });
    if (action === 'create') {
      return onChange({ action: 'create', name: suggestion.medicationName || token });
    }
    const fallback = suggestion.medicationId ?? catalog[0]?.id ?? '';
    onChange({ action: 'existing', medicationId: fallback });
  };
  const canUseExisting = catalog.length > 0;

  return (
    <Stack spacing={1.5} role="group" aria-label={t('import.medications.group', { token })}>
      <div>
        <Typography variant="subtitle2">{token}</Typography>
        <Typography variant="body2" color="text.secondary">
          {suggestion.similarTokens.length > 0
            ? t('import.medications.appearsWithSimilar', {
                appears: t('import.medications.appears', { count: suggestion.occurrences }),
                similar: t('import.medications.similar', {
                  names: suggestion.similarTokens.join(', '),
                }),
              })
            : t('import.medications.appears', { count: suggestion.occurrences })}
        </Typography>
      </div>
      <TextField
        select
        size="small"
        label={t('import.medications.actionFor', { token })}
        value={choice.action}
        onChange={(e) => changeAction(e.target.value)}
        slotProps={SELECT}
      >
        <option value="existing" disabled={!canUseExisting}>
          {t('import.medications.useExisting')}
        </option>
        <option value="create">{t('import.medications.createNew')}</option>
        <option value="ignore">{t('import.medications.ignore')}</option>
      </TextField>
      {choice.action === 'existing' && (
        <TextField
          select
          size="small"
          label={t('import.medications.medicationFor', { token })}
          value={choice.medicationId}
          onChange={(e) => onChange({ action: 'existing', medicationId: e.target.value })}
          error={!!problem}
          helperText={problem}
          slotProps={SELECT}
        >
          {catalog.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </TextField>
      )}
      {choice.action === 'create' && (
        <TextField
          size="small"
          label={t('import.medications.newNameFor', { token })}
          value={choice.name}
          onChange={(e) => onChange({ action: 'create', name: e.target.value })}
          error={!!problem}
          helperText={problem}
          autoComplete="off"
        />
      )}
    </Stack>
  );
}
