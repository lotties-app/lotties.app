import { useTranslation } from 'react-i18next';
import { Typography } from '@mui/material';
import type { BottleSuggestions } from './bottleSuggestions';

/** The caption text of a suggestion set; `null` for the neutral set (nothing said about age). */
function useBottleSuggestionCaption(suggestions: BottleSuggestions | undefined) {
  const { t } = useTranslation();
  if (!suggestions) return null;
  if (suggestions.source === 'history') return t('events.bottleSuggestions.history');
  if (suggestions.source !== 'age' || suggestions.ageMonths === null) return null;
  return suggestions.ageMonths === 0
    ? t('events.bottleSuggestions.newborn')
    : t('events.bottleSuggestions.age', { count: suggestions.ageMonths });
}

/**
 * A quiet line under the amount chips saying where they come from: the age table (cold start,
 * "not advice") or the baby's own recent feeds. Nothing for the neutral set.
 */
export function BottleSuggestionCaption({
  suggestions,
}: {
  suggestions: BottleSuggestions | undefined;
}) {
  const text = useBottleSuggestionCaption(suggestions);
  if (!text) return null;
  return (
    <Typography
      variant="caption"
      component="p"
      color="text.secondary"
      data-testid="bottle-suggestion-caption"
      sx={{ mt: 0.75 }}
    >
      {text}
    </Typography>
  );
}
