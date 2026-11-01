import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Card, Stack, Typography } from '@mui/material';
import type { PredictionsDto } from '../../sync/contract';
import { formatTime } from '../../i18n/format';
import { CategoryIcon } from '../../ui/CategoryIcon';
import type { PatternSuggestion } from '../bellyPattern';
import { fussyDismissal } from '../dismissalStore';
import { fussySuggestion } from '../fussyPattern';
import type { NowScreenModel } from '../useNow';
import { PatternWhySheet } from './PatternWhySheet';

interface CardProps {
  suggestion: PatternSuggestion;
  onNotToday: () => void;
}

/**
 * "Fussiness often starts around 18:00. A calm routine may help." with Not today and Why?
 * (docs/design/11-patterns.md section 7). A soft note from the log: no action to run, no urgency,
 * no diagnosis.
 */
export function FussyPatternCard({ suggestion, onNotToday }: CardProps) {
  const { t } = useTranslation();
  const [whyOpen, setWhyOpen] = useState(false);
  return (
    <Card component="section" aria-label={t('now.fussyPattern.label')} sx={{ p: 2.5 }}>
      <Stack spacing={1.5}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
          <CategoryIcon name="mood-cry" category="care" size={20} />
          <Typography sx={{ flexGrow: 1, pt: 0.75 }}>
            {t('now.fussyPattern.text', { time: formatTime(suggestion.window.typical) })}
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
            {t('now.fussyPattern.notToday')}
          </Button>
        </Stack>
      </Stack>
      <PatternWhySheet
        section="fussyPattern"
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
}

/**
 * The fussy pattern card when the pattern's suggestion time is now and no fussy spell was logged
 * for it yet; "Not today" hides it for this window on this device (per baby, per account).
 */
export function FussyPatternSuggestion({ babyId, model, predictions }: SuggestionProps) {
  const [dismissed, setDismissed] = useState(() => fussyDismissal.read(babyId));
  const suggestion = fussySuggestion({
    predictions,
    events: model.events,
    types: model.types,
    now: model.now,
    dismissedDate: dismissed,
  });
  if (!suggestion) return null;
  const notToday = () => {
    fussyDismissal.write(babyId, suggestion.window.date);
    setDismissed(suggestion.window.date);
  };
  return <FussyPatternCard suggestion={suggestion} onNotToday={notToday} />;
}
