import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Card, Stack, Typography } from '@mui/material';
import type { PredictionsDto } from '../../sync/contract';
import { formatDuration } from '../../i18n/format';
import { presetsForBaby } from '../../presets/resolve';
import type { PresetActions } from '../../presets/usePresetActions';
import { CategoryIcon } from '../../ui/CategoryIcon';
import { overtiredDismissal } from '../dismissalStore';
import { MINUTE_MS } from '../eventFacts';
import { overtiredSuggestion, type OvertiredSuggestion } from '../overtired';
import type { NowScreenModel } from '../useNow';
import { OvertiredWhySheet } from './OvertiredWhySheet';

/** The nap timer preset the card starts. */
const NAP_PRESET = 'nap';

interface CardProps {
  suggestion: OvertiredSuggestion;
  /** Starts the nap timer; absent when the baby has no sleep type. */
  onStartNap?: () => void;
  disabled: boolean;
  onNotNow: () => void;
}

/**
 * "Witching hour soon: awake for 2h 10m, usually fussy after about 2h 30m. A nap soon may help."
 * with Start nap, Not now and Why? (docs/design/11-patterns.md section 6). A soft note from the
 * log: no alarm, no diagnosis.
 */
export function OvertiredCard({ suggestion, onStartNap, disabled, onNotNow }: CardProps) {
  const { t } = useTranslation();
  const [whyOpen, setWhyOpen] = useState(false);
  return (
    <Card component="section" aria-label={t('now.overtired.label')} sx={{ p: 2.5 }}>
      <Stack spacing={1.5}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
          <CategoryIcon name="zzz" category="sleep" size={20} />
          <Typography sx={{ flexGrow: 1, pt: 0.75 }}>
            {t('now.overtired.text', {
              awake: formatDuration(suggestion.awakeMinutes * MINUTE_MS),
              limit: formatDuration(suggestion.limitMinutes * MINUTE_MS),
            })}
          </Typography>
          <Button
            size="small"
            onClick={() => setWhyOpen(true)}
            sx={{ minHeight: 44, minWidth: 44, flex: 'none' }}
          >
            {t('predictions.why')}
          </Button>
        </Box>
        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
          <Button onClick={onNotNow} sx={{ minHeight: 48 }}>
            {t('now.overtired.notNow')}
          </Button>
          {onStartNap && (
            <Button
              variant="contained"
              onClick={onStartNap}
              disabled={disabled}
              sx={{ minHeight: 48 }}
            >
              {t('now.overtired.start')}
            </Button>
          )}
        </Stack>
      </Stack>
      <OvertiredWhySheet open={whyOpen} onClose={() => setWhyOpen(false)} suggestion={suggestion} />
    </Card>
  );
}

interface SuggestionProps {
  babyId: string;
  model: NowScreenModel;
  predictions: PredictionsDto | undefined;
  actions: PresetActions;
}

/**
 * The overtired card while the baby has been awake from 15 minutes before her usual longest
 * comfortable stretch until 30 minutes after it; hidden while a sleep runs. "Not now" hides it
 * for this awake stretch on this device (per baby, per account).
 */
export function OvertiredSuggestionCard({ babyId, model, predictions, actions }: SuggestionProps) {
  const [dismissed, setDismissed] = useState(() => overtiredDismissal.read(babyId));
  const suggestion = overtiredSuggestion({
    predictions,
    state: model.state,
    events: model.events,
    types: model.types,
    now: model.now,
    dismissedSince: dismissed,
  });
  if (!suggestion) return null;
  const nap = presetsForBaby(model.types).find((preset) => preset.id === NAP_PRESET);
  const notNow = () => {
    overtiredDismissal.write(babyId, suggestion.since);
    setDismissed(suggestion.since);
  };
  return (
    <OvertiredCard
      suggestion={suggestion}
      disabled={model.readOnly}
      onNotNow={notNow}
      {...(nap ? { onStartNap: () => void actions.run(nap) } : {})}
    />
  );
}
