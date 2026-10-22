import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Card, Stack, Typography } from '@mui/material';
import type { PredictionsDto } from '../../sync/contract';
import { formatTime } from '../../i18n/format';
import { presetsForBaby } from '../../presets/resolve';
import type { PresetActions } from '../../presets/usePresetActions';
import { CategoryIcon } from '../../ui/CategoryIcon';
import { BELLY_MASSAGE_KEY, bellySuggestion, type BellySuggestion } from '../bellyPattern';
import { readBellyDismissal, writeBellyDismissal } from '../bellyPatternDismissal';
import type { NowScreenModel } from '../useNow';
import { BellyPainWhySheet } from './BellyPainWhySheet';

interface CardProps {
  suggestion: BellySuggestion;
  /** Starts the belly massage timer; absent when the baby has no massage type. */
  onStartMassage?: () => void;
  disabled: boolean;
  onNotToday: () => void;
}

/**
 * "Belly pain often shows up around 18:00. A belly massage may help." with Start massage, Not today
 * and Why? (docs/design/11-patterns.md). A soft suggestion from the log: no urgency, no diagnosis.
 */
export function BellyPainCard({ suggestion, onStartMassage, disabled, onNotToday }: CardProps) {
  const { t } = useTranslation();
  const [whyOpen, setWhyOpen] = useState(false);
  return (
    <Card component="section" aria-label={t('now.bellyPattern.label')} sx={{ p: 2.5 }}>
      <Stack spacing={1.5}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
          <CategoryIcon name="massage" category="health" size={20} />
          <Typography sx={{ flexGrow: 1, pt: 0.75 }}>
            {t('now.bellyPattern.text', { time: formatTime(suggestion.window.typical) })}
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
          <Button onClick={onNotToday} sx={{ minHeight: 48 }}>
            {t('now.bellyPattern.notToday')}
          </Button>
          {onStartMassage && (
            <Button
              variant="contained"
              onClick={onStartMassage}
              disabled={disabled}
              sx={{ minHeight: 48 }}
            >
              {t('now.bellyPattern.start')}
            </Button>
          )}
        </Stack>
      </Stack>
      <BellyPainWhySheet
        open={whyOpen}
        onClose={() => setWhyOpen(false)}
        pattern={suggestion.pattern}
        window={suggestion.window}
      />
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
 * The belly pain card when the pattern's suggestion time is now and nothing was logged for it
 * yet; "Not today" hides it for this window on this device (per baby, per account).
 */
export function BellyPainSuggestion({ babyId, model, predictions, actions }: SuggestionProps) {
  const [dismissed, setDismissed] = useState(() => readBellyDismissal(babyId));
  const suggestion = bellySuggestion({
    predictions,
    events: model.events,
    types: model.types,
    now: model.now,
    dismissedDate: dismissed,
  });
  if (!suggestion) return null;
  const massage = presetsForBaby(model.types).find((preset) => preset.id === BELLY_MASSAGE_KEY);
  const notToday = () => {
    writeBellyDismissal(babyId, suggestion.window.date);
    setDismissed(suggestion.window.date);
  };
  return (
    <BellyPainCard
      suggestion={suggestion}
      disabled={model.readOnly}
      onNotToday={notToday}
      {...(massage ? { onStartMassage: () => void actions.run(massage) } : {})}
    />
  );
}
