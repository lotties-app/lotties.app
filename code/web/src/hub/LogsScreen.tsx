import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Chip, Stack, Typography } from '@mui/material';
import { RADIUS } from '../theme/tokens';
import { Icon } from '../ui/Icon';
import { getAppLogEntries, clearAppLog, type LogEntry, type LogLevel, type LogCategory } from '../logs/appLog';

const LEVEL_COLORS: Record<LogLevel, string> = {
  info: '#4caf50',
  warn: '#ff9800',
  error: '#f44336',
};

const CATEGORY_LABELS: Record<LogCategory, string> = {
  sync: 'Sync',
  prediction: 'Prediction',
  auth: 'Auth',
  event: 'Event',
  app: 'App',
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`;
}

/**
 * In-app diagnostic log viewer accessible from the Hub. Shows recent sync, prediction, auth,
 * and app events captured by the appLog module. Auto-scrolls to bottom on new entries.
 * Intended for screenshotting and sharing with the team to diagnose issues.
 */
export function LogsScreen() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<readonly LogEntry[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Poll for new log entries every second since appLog is a plain array, not reactive state.
  useEffect(() => {
    const update = () => setEntries([...getAppLogEntries()]);
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll to bottom when new entries appear.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries.length]);

  const handleCopy = useCallback(() => {
    const text = entries
      .map((e) => `[${formatTime(e.timestamp)}] [${e.level.toUpperCase()}] [${e.category}] ${e.message}${e.detail ? '\n  ' + JSON.stringify(e.detail) : ''}`)
      .join('\n');
    void navigator.clipboard.writeText(text);
  }, [entries]);

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="h5" component="h1">
          {t('hub.logs.title', 'Application Logs')}
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button size="small" onClick={handleCopy} startIcon={<Icon name="copy" size={16} />}>
            {t('common.copy', 'Copy')}
          </Button>
          <Button size="small" color="error" onClick={clearAppLog} startIcon={<Icon name="close" size={16} />}>
            {t('common.clear', 'Clear')}
          </Button>
        </Stack>
      </Stack>

      <Typography variant="body2" color="text.secondary">
        {t('hub.logs.description', 'Recent application events for diagnostics. Entries are kept in memory and cleared on reload.')}
      </Typography>

      <Box
        sx={{
          flex: 1,
          maxHeight: '70vh',
          overflow: 'auto',
          bgcolor: 'rgba(0,0,0,0.3)',
          borderRadius: `${RADIUS.card}px`,
          p: 1.5,
          fontFamily: 'monospace',
          fontSize: 11,
        }}
      >
        {entries.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
            {t('hub.logs.empty', 'No log entries yet. Use the app and logs will appear here.')}
          </Typography>
        ) : (
          entries.map((entry, i) => (
            <Box key={i} sx={{ mb: 0.75, pb: 0.75, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.25 }}>
                <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
                  {formatTime(entry.timestamp)}
                </Typography>
                <Chip
                  label={entry.level.toUpperCase()}
                  size="small"
                  sx={{
                    height: 18,
                    fontSize: 9,
                    fontWeight: 700,
                    bgcolor: LEVEL_COLORS[entry.level],
                    color: '#fff',
                  }}
                />
                <Chip
                  label={CATEGORY_LABELS[entry.category]}
                  size="small"
                  variant="outlined"
                  sx={{ height: 18, fontSize: 9, borderColor: 'rgba(255,255,255,0.2)', color: 'text.secondary' }}
                />
              </Stack>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-word' }}>
                {entry.message}
              </Typography>
              {entry.detail !== undefined && (
                <Typography
                  variant="caption"
                  sx={{ display: 'block', mt: 0.25, fontFamily: 'monospace', fontSize: 10, color: 'text.secondary', wordBreak: 'break-word' }}
                >
                  {JSON.stringify(entry.detail)}
                </Typography>
              )}
            </Box>
          ))
        )}
        <div ref={bottomRef} />
      </Box>
    </Stack>
  );
}