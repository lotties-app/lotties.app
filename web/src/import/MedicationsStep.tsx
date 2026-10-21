import { useTranslation } from 'react-i18next';
import { Alert, Button, Divider, Stack, Typography } from '@mui/material';
import { useMedications } from '../db/hooks';
import type { Baby } from '../db/models';
import type { MedicationSuggestion } from '../sync/contract';
import { MappingRow, type CatalogOption } from './MappingRow';
import type { Choices, MappingChoice } from './importModel';
import { getOwn } from '../util/ownProperty';

interface Props {
  baby: Baby;
  suggestions: MedicationSuggestion[];
  choices: Choices;
  problems: Record<string, string>;
  unmapped: string[];
  canContinue: boolean;
  pending: boolean;
  onChange: (token: string, choice: MappingChoice) => void;
  onRecheck: () => void;
  onBack: () => void;
  onNext: () => void;
}

/** Existing catalog plus the suggestion targets (they may not be synced to Dexie yet). */
function catalogOptions(
  catalog: CatalogOption[],
  suggestions: MedicationSuggestion[],
): CatalogOption[] {
  const byId = new Map(catalog.map((m) => [m.id, m]));
  for (const s of suggestions) {
    if (s.medicationId && !byId.has(s.medicationId)) {
      byId.set(s.medicationId, { id: s.medicationId, name: s.medicationName });
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Step 3: decide what every medication name in the file becomes; nothing is mapped silently. */
export function MedicationsStep({
  baby,
  suggestions,
  choices,
  problems,
  unmapped,
  canContinue,
  pending,
  onChange,
  onRecheck,
  onBack,
  onNext,
}: Props) {
  const { t } = useTranslation();
  const catalog = catalogOptions(useMedications(baby.id) ?? [], suggestions);
  const hasProblems = Object.keys(problems).length > 0;

  return (
    <Stack spacing={2}>
      {suggestions.length === 0 ? (
        <Typography color="text.secondary">{t('import.medications.none')}</Typography>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary">
            {t('import.medications.intro')}
          </Typography>
          <Stack spacing={2} divider={<Divider flexItem />}>
            {suggestions.map((s) => (
              <MappingRow
                key={s.token}
                suggestion={s}
                choice={getOwn(choices, s.token) ?? { action: 'ignore' }}
                catalog={catalog}
                problem={getOwn(problems, s.token)}
                onChange={(choice) => onChange(s.token, choice)}
              />
            ))}
          </Stack>
          {unmapped.length > 0 ? (
            <Alert severity="warning">
              {t('import.medications.unmapped', {
                count: unmapped.length,
                names: unmapped.join(', '),
              })}
            </Alert>
          ) : (
            <Alert severity="success">{t('import.medications.covered')}</Alert>
          )}
          <Button
            variant="outlined"
            onClick={onRecheck}
            disabled={pending || hasProblems}
            sx={{ minHeight: 48, alignSelf: 'flex-start' }}
          >
            {t('import.medications.recheck')}
          </Button>
        </>
      )}
      <Stack direction="row" spacing={1}>
        <Button onClick={onBack} sx={{ minHeight: 48 }}>
          {t('common.back')}
        </Button>
        <Button variant="contained" onClick={onNext} disabled={!canContinue} sx={{ minHeight: 48 }}>
          {t('common.next')}
        </Button>
      </Stack>
    </Stack>
  );
}
