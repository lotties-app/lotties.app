import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ThumbDown, ThumbUp } from '@mui/icons-material';
import { CircularProgress, IconButton, Stack, Tooltip } from '@mui/material';
import { useApiClient } from '../api/ApiClientContext';
import { apiPaths } from '../sync/contract';

interface Props {
  /** `predictionFeedbackId` of the prediction (type key and expected start as an ISO 8601 UTC instant). */
  predictionId: string;
  babyId: string;
  onFeedbackSubmitted?: () => void;
}

export function PredictionFeedbackButton({ predictionId, babyId, onFeedbackSubmitted }: Props) {
  const { t } = useTranslation();
  const api = useApiClient();
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (accurate: boolean) => {
    if (submitted || submitting) return;
    setSubmitting(true);
    try {
      await api.request(apiPaths.predictionFeedback(babyId), {
        method: 'POST',
        body: { predictionId, accurate },
      });
      setSubmitted(true);
      onFeedbackSubmitted?.();
    } catch {
      // Feedback is best-effort; the button stays enabled so the user can retry.
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <Tooltip title={t('predictionFeedback.submitted')}>
        <Check fontSize="small" color="success" aria-label={t('predictionFeedback.submitted')} />
      </Tooltip>
    );
  }

  return (
    <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center' }}>
      {submitting ? (
        <CircularProgress size={16} aria-label={t('predictionFeedback.accurate')} />
      ) : (
        <>
          <Tooltip title={t('predictionFeedback.accurate')}>
            <IconButton
              size="small"
              onClick={() => handleSubmit(true)}
              aria-label={t('predictionFeedback.accurate')}
              sx={{ p: 0.5 }}
            >
              <ThumbUp fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('predictionFeedback.inaccurate')}>
            <IconButton
              size="small"
              onClick={() => handleSubmit(false)}
              aria-label={t('predictionFeedback.inaccurate')}
              sx={{ p: 0.5 }}
            >
              <ThumbDown fontSize="small" />
            </IconButton>
          </Tooltip>
        </>
      )}
    </Stack>
  );
}