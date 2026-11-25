import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Dialog, DialogContent, DialogTitle, Typography } from '@mui/material';
import type { UseQueryResult } from '@tanstack/react-query';
import type { PredictionsDto } from '../../sync/contract';

interface PredictionDebugProps {
  predictions: PredictionsDto | undefined;
  /** Pass the full query result so we can display error/loading/fetchStatus for diagnostics. */
  query?: UseQueryResult<PredictionsDto>;
}

const PRE_STYLE = { fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all' } as const;

/**
 * Debug-only button that opens a full-screen dialog showing the raw predictions JSON response
 * plus React Query metadata (error, fetchStatus, isFetching). Intended for diagnosing why
 * predictions show "Aprendendo o ritmo" or "undefined" — tap to open, screenshot each section,
 * and share with the team for analysis.
 */
export function PredictionDebugButton({ predictions, query }: PredictionDebugProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const notAvailable = t('predictionDebug.notAvailable');
  const json = (value: unknown) =>
    value ? JSON.stringify(value, null, 2) : t('predictionDebug.none');

  return (
    <>
      <Box sx={{ mt: 1, mb: 1 }}>
        <Button
          size="small"
          variant="outlined"
          onClick={() => setOpen(true)}
          sx={{
            textTransform: 'none',
            fontSize: 12,
            opacity: 0.6,
            borderColor: 'rgba(255,255,255,0.2)',
            color: 'rgba(255,255,255,0.5)',
          }}
        >
          {t('predictionDebug.open')}
        </Button>
      </Box>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('predictionDebug.title')}</DialogTitle>
        <DialogContent>
          {/* Query metadata: shows why predictions may be undefined or stale */}
          <Box sx={{ mb: 2, p: 1.5, borderRadius: 1, bgcolor: 'rgba(255,255,255,0.05)' }}>
            <Typography variant="subtitle2" gutterBottom>
              {t('predictionDebug.queryStatus')}
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 11 }}>
              {t('predictionDebug.queryLine', {
                status: query?.status ?? notAvailable,
                fetchStatus: query?.fetchStatus ?? notAvailable,
                isFetching: String(query?.isFetching ?? notAvailable),
                isError: String(query?.isError ?? notAvailable),
                isEnabled: String(query?.isEnabled ?? notAvailable),
                dataUpdatedAt: query?.dataUpdatedAt
                  ? new Date(query.dataUpdatedAt).toISOString()
                  : notAvailable,
              })}
            </Typography>
            {query?.error && (
              <Typography
                variant="body2"
                color="error"
                sx={{ mt: 1, fontFamily: 'monospace', fontSize: 11 }}
              >
                {t('predictionDebug.error', {
                  message:
                    query.error instanceof Error
                      ? query.error.message
                      : JSON.stringify(query.error),
                })}
              </Typography>
            )}
          </Box>

          {!predictions ? (
            <Typography color="error">{t('predictionDebug.notLoaded')}</Typography>
          ) : (
            <Box sx={{ maxHeight: '70vh', overflow: 'auto' }}>
              <Typography variant="subtitle2" gutterBottom>
                {t('predictionDebug.babyId', { value: predictions.babyId })}
              </Typography>
              <Typography variant="subtitle2" gutterBottom>
                {t('predictionDebug.generatedAt', { value: predictions.generatedAt })}
              </Typography>
              <Typography variant="subtitle2" gutterBottom>
                {t('predictionDebug.engineVersion', {
                  value: predictions.engineVersion ?? notAvailable,
                })}
              </Typography>

              <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
                {t('predictionDebug.predictions', { n: predictions.predictions.length })}
              </Typography>
              {predictions.predictions.length === 0 ? (
                <Typography color="warning.main">{t('predictionDebug.noPredictions')}</Typography>
              ) : (
                <pre style={PRE_STYLE}>{JSON.stringify(predictions.predictions, null, 2)}</pre>
              )}

              <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
                {t('predictionDebug.insufficientData', { n: predictions.insufficientData.length })}
              </Typography>
              {predictions.insufficientData.length === 0 ? (
                <Typography color="success.main">
                  {t('predictionDebug.noInsufficientData')}
                </Typography>
              ) : (
                <pre style={PRE_STYLE}>{JSON.stringify(predictions.insufficientData, null, 2)}</pre>
              )}

              <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
                {t('predictionDebug.bedTime')}
              </Typography>
              <pre style={PRE_STYLE}>{json(predictions.bedTime)}</pre>

              <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
                {t('predictionDebug.diaper')}
              </Typography>
              <pre style={PRE_STYLE}>{json(predictions.diaper)}</pre>

              <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
                {t('predictionDebug.feedingVolumes')}
              </Typography>
              <pre style={PRE_STYLE}>{json(predictions.feedingVolumes)}</pre>

              <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
                {t('predictionDebug.feedingDuration')}
              </Typography>
              <pre style={PRE_STYLE}>{json(predictions.feedingDuration)}</pre>

              <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
                {t('predictionDebug.cryCause')}
              </Typography>
              <pre style={PRE_STYLE}>{json(predictions.cryCause)}</pre>

              <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
                {t('predictionDebug.wakeWindow')}
              </Typography>
              <pre style={PRE_STYLE}>{json(predictions.wakeWindow)}</pre>

              <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
                {t('predictionDebug.patterns')}
              </Typography>
              <pre style={PRE_STYLE}>
                {predictions.patterns && predictions.patterns.length > 0
                  ? JSON.stringify(predictions.patterns, null, 2)
                  : t('predictionDebug.empty')}
              </pre>
            </Box>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
