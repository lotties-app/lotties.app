import { useState } from 'react';
import { Box, Button, Dialog, DialogContent, DialogTitle, Typography } from '@mui/material';
import type { UseQueryResult } from '@tanstack/react-query';
import type { PredictionsDto } from '../../sync/contract';

interface PredictionDebugProps {
  predictions: PredictionsDto | undefined;
  /** Pass the full query result so we can display error/loading/fetchStatus for diagnostics. */
  query?: UseQueryResult<PredictionsDto>;
}

/**
 * Debug-only button that opens a full-screen dialog showing the raw predictions JSON response
 * plus React Query metadata (error, fetchStatus, isFetching). Intended for diagnosing why
 * predictions show "Aprendendo o ritmo" or "undefined" — tap to open, screenshot each section,
 * and share with the team for analysis.
 */
export function PredictionDebugButton({ predictions, query }: PredictionDebugProps) {
  const [open, setOpen] = useState(false);

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
          🔍 Diagnóstico de Previsões
        </Button>
      </Box>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Diagnóstico de Previsões</DialogTitle>
        <DialogContent>
          {/* Query metadata: shows why predictions may be undefined or stale */}
          <Box sx={{ mb: 2, p: 1.5, borderRadius: 1, bgcolor: 'rgba(255,255,255,0.05)' }}>
            <Typography variant="subtitle2" gutterBottom>
              React Query Status
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 11 }}>
              status: {query?.status ?? 'N/A'} | fetchStatus: {query?.fetchStatus ?? 'N/A'} | isFetching:{' '}
              {String(query?.isFetching ?? 'N/A')} | isError: {String(query?.isError ?? 'N/A')} |
              isEnabled: {String(query?.isEnabled ?? 'N/A')} | dataUpdatedAt:{' '}
              {query?.dataUpdatedAt ? new Date(query.dataUpdatedAt).toISOString() : 'N/A'}
            </Typography>
            {query?.error && (
              <Typography variant="body2" color="error" sx={{ mt: 1, fontFamily: 'monospace', fontSize: 11 }}>
                error: {query.error instanceof Error ? query.error.message : JSON.stringify(query.error)}
              </Typography>
            )}
          </Box>

          {!predictions ? (
            <Typography color="error">Nenhuma previsão carregada (undefined)</Typography>
          ) : (
            <Box sx={{ maxHeight: '70vh', overflow: 'auto' }}>
              <Typography variant="subtitle2" gutterBottom>
                babyId: {predictions.babyId}
              </Typography>
              <Typography variant="subtitle2" gutterBottom>
                generatedAt: {predictions.generatedAt}
              </Typography>
              <Typography variant="subtitle2" gutterBottom>
                engineVersion: {predictions.engineVersion}
              </Typography>

              <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
                Previsões ({predictions.predictions.length})
              </Typography>
              {predictions.predictions.length === 0 ? (
                <Typography color="warning.main">Nenhuma previsão retornada</Typography>
              ) : (
                <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {JSON.stringify(predictions.predictions, null, 2)}
                </pre>
              )}

              <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
                Dados Insuficientes ({predictions.insufficientData.length})
              </Typography>
              {predictions.insufficientData.length === 0 ? (
                <Typography color="success.main">Nenhum tipo com dados insuficientes</Typography>
              ) : (
                <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {JSON.stringify(predictions.insufficientData, null, 2)}
                </pre>
              )}

              <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
                BedTime
              </Typography>
              <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {predictions.bedTime
                  ? JSON.stringify(predictions.bedTime, null, 2)
                  : '(null)'}
              </pre>

              <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
                Diaper
              </Typography>
              <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {predictions.diaper
                  ? JSON.stringify(predictions.diaper, null, 2)
                  : '(null)'}
              </pre>

              <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
                Feeding Volumes
              </Typography>
              <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {predictions.feedingVolumes
                  ? JSON.stringify(predictions.feedingVolumes, null, 2)
                  : '(null)'}
              </pre>

              <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
                Feeding Duration
              </Typography>
              <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {predictions.feedingDuration
                  ? JSON.stringify(predictions.feedingDuration, null, 2)
                  : '(null)'}
              </pre>

              <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
                Cry Cause
              </Typography>
              <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {predictions.cryCause
                  ? JSON.stringify(predictions.cryCause, null, 2)
                  : '(null)'}
              </pre>

              <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
                Wake Window
              </Typography>
              <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {predictions.wakeWindow
                  ? JSON.stringify(predictions.wakeWindow, null, 2)
                  : '(null)'}
              </pre>

              <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
                Patterns
              </Typography>
              <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {predictions.patterns && predictions.patterns.length > 0
                  ? JSON.stringify(predictions.patterns, null, 2)
                  : '(vazio)'}
              </pre>
            </Box>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}