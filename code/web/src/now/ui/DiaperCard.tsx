import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Card, Stack, Typography } from '@mui/material';
import type { PredictionsDto } from '../../sync/contract';
import { formatTime } from '../../i18n/format';
import { CategoryIcon } from '../../ui/CategoryIcon';
import {
  dirtySuggestion,
  wetSuggestion,
  type DiaperKind,
  type DiaperSuggestion,
  type DiaperSuggestionInput,
} from '../diaperPredictions';
import { diaperDirtyDismissal, diaperWetDismissal, type DismissalStore } from '../dismissalStore';
import type { NowScreenModel } from '../useNow';
import { DiaperWhySheet } from './DiaperWhySheet';

interface CardProps {
  suggestion: DiaperSuggestion;
  now: Date;
  /** Opens the diaper tray; absent when the baby has no diaper type. */
  onLogDiaper?: () => void;
  disabled: boolean;
  onNotNow: () => void;
}

/** The card's sentence: the expected time, or the usual lag after feeds. */
function useSuggestionText(suggestion: DiaperSuggestion): string {
  const { t } = useTranslation();
  if (suggestion.kind === 'wet') {
    return t('now.diaper.wetText', { time: formatTime(suggestion.window.expected) });
  }
  if (suggestion.signal === 'afterFeed') {
    return t('now.diaper.afterFeedText', {
      count: suggestion.diaper.dirty?.afterFeed?.medianLagMinutes ?? 0,
    });
  }
  return t('now.diaper.dirtyText', { time: formatTime(suggestion.window.expected) });
}

/**
 * "Diaper check likely around 15:40." (wet) or "A dirty diaper often follows feeds after about
 * 30 minutes." with Log diaper, Not now and Why? (docs/design/11-patterns.md section 8). A soft
 * note from the log: no alarm, no urgency, never medical advice.
 */
export function DiaperCard({ suggestion, now, onLogDiaper, disabled, onNotNow }: CardProps) {
  const { t } = useTranslation();
  const [whyOpen, setWhyOpen] = useState(false);
  const text = useSuggestionText(suggestion);
  return (
    <Card
      component="section"
      aria-label={t(suggestion.kind === 'wet' ? 'now.diaper.wetLabel' : 'now.diaper.dirtyLabel')}
      sx={{ p: 2.5 }}
    >
      <Stack spacing={1.5}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
          <CategoryIcon name="diaper" category="diaper" size={20} />
          <Typography sx={{ flexGrow: 1, pt: 0.75 }}>{text}</Typography>
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
            {t('now.diaper.notNow')}
          </Button>
          {onLogDiaper && (
            <Button
              variant="contained"
              onClick={onLogDiaper}
              disabled={disabled}
              sx={{ minHeight: 48 }}
            >
              {t('now.diaper.log')}
            </Button>
          )}
        </Stack>
      </Stack>
      <DiaperWhySheet
        open={whyOpen}
        onClose={() => setWhyOpen(false)}
        suggestion={suggestion}
        now={now}
      />
    </Card>
  );
}

const SUGGEST: Record<DiaperKind, (input: DiaperSuggestionInput) => DiaperSuggestion | null> = {
  wet: wetSuggestion,
  dirty: dirtySuggestion,
};

const DISMISSAL: Record<DiaperKind, DismissalStore> = {
  wet: diaperWetDismissal,
  dirty: diaperDirtyDismissal,
};

interface SuggestionProps {
  kind: DiaperKind;
  babyId: string;
  model: NowScreenModel;
  predictions: PredictionsDto | undefined;
  onLogDiaper?: () => void;
}

/**
 * One diaper card (wet or dirty) from 20 minutes before the expected diaper until 40 minutes
 * after it; hidden without an estimate. "Not now" hides it for this anchor on this device (per
 * baby, per account); a diaper of the kind logged since moves the anchor, which hides it too.
 */
export function DiaperSuggestionCard({
  kind,
  babyId,
  model,
  predictions,
  onLogDiaper,
}: SuggestionProps) {
  const store = DISMISSAL[kind];
  const [dismissed, setDismissed] = useState(() => store.read(babyId));
  const suggestion = SUGGEST[kind]({
    predictions,
    events: model.events,
    types: model.types,
    now: model.now,
    dismissedAnchor: dismissed,
  });
  if (!suggestion) return null;
  const notNow = () => {
    store.write(babyId, suggestion.anchorAt);
    setDismissed(suggestion.anchorAt);
  };
  return (
    <DiaperCard
      suggestion={suggestion}
      now={model.now}
      disabled={model.readOnly}
      onNotNow={notNow}
      {...(onLogDiaper ? { onLogDiaper } : {})}
    />
  );
}

const KINDS: readonly DiaperKind[] = ['wet', 'dirty'];

/** The wet and the dirty diaper cards, each when it applies (both may show at once). */
export function DiaperSuggestions(props: Omit<SuggestionProps, 'kind'>) {
  return KINDS.map((kind) => <DiaperSuggestionCard key={kind} kind={kind} {...props} />);
}
