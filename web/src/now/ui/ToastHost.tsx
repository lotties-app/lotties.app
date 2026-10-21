import { useEffect, type FocusEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, ButtonBase, Typography } from '@mui/material';
import { describeApiError } from '../../api/errorMessages';
import { CONTENT_MAX_WIDTH, RADIUS } from '../../theme/tokens';
import { palette } from '../../ui/form/styles';
import { useQuickLogToastContext } from '../QuickLogToastContext';
import { shiftChipLabel } from '../nowText';

/** Space the bottom navigation takes (64 px) plus a gap. */
export const TOAST_BOTTOM = 'calc(64px + env(safe-area-inset-bottom) + 12px)';

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * The receipt toast of the Now commands (docs/design/03-interaction.md section 2): what was
 * logged, Undo and the time-shift chips ("Now", "-5 min", ...). One at a time, hidden after 6 s,
 * paused while hovered, touched or focused (WCAG 2.2.1). The live region is always in the page so
 * screen readers announce each new message politely. Ctrl or Cmd + Z undoes outside text fields.
 */
export function ToastHost() {
  const { t } = useTranslation();
  const toast = useQuickLogToastContext();
  const current = toast?.current ?? null;
  const undo = toast?.undo;

  useEffect(() => {
    if (!current || !undo) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        if (isEditable(event.target)) return;
        event.preventDefault();
        void undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, undo]);

  if (!toast) return null;
  const leave = (event: FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) toast.resume();
  };

  return (
    <Box
      sx={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: TOAST_BOTTOM,
        zIndex: (theme) => theme.zIndex.snackbar,
        display: 'flex',
        justifyContent: 'center',
        px: 1.5,
        pointerEvents: 'none',
      }}
    >
      <Box
        role="status"
        aria-live="polite"
        sx={{ width: '100%', maxWidth: CONTENT_MAX_WIDTH - 24, pointerEvents: 'none' }}
      >
        {current && (
          <Box
            key={current.id}
            data-testid="quick-log-toast"
            onPointerEnter={toast.pause}
            onPointerLeave={toast.resume}
            onFocus={toast.pause}
            onBlur={leave}
            sx={(theme) => ({
              pointerEvents: 'auto',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 0.75,
              py: 1,
              pl: 2,
              pr: 1,
              borderRadius: `${RADIUS.input}px`,
              backgroundColor: palette(theme).selection,
              color: palette(theme).onSelection,
              boxShadow: palette(theme).cardShadow,
            })}
          >
            <Typography
              variant="body2"
              sx={{ flex: '1 1 140px', fontWeight: 600, color: 'inherit' }}
            >
              {current.message}
            </Typography>
            {current.shiftable && (
              <Box
                role="group"
                aria-label={t('now.toast.shiftGroup')}
                sx={{ display: 'flex', gap: 0.5 }}
              >
                {current.shiftOptions.map((minutes) => (
                  <ButtonBase
                    key={minutes}
                    aria-pressed={current.shiftMinutes === minutes}
                    onClick={() => void toast.shift(minutes)}
                    sx={{
                      minHeight: 40,
                      minWidth: 40,
                      px: 1.25,
                      borderRadius: `${RADIUS.pill}px`,
                      fontSize: '0.8125rem',
                      color: 'inherit',
                      border: '1px solid currentColor',
                      opacity: current.shiftMinutes === minutes ? 1 : 0.8,
                      fontWeight: current.shiftMinutes === minutes ? 700 : 500,
                      backgroundColor:
                        current.shiftMinutes === minutes
                          ? 'color-mix(in srgb, currentColor 18%, transparent)'
                          : 'transparent',
                    }}
                  >
                    {shiftChipLabel(minutes)}
                  </ButtonBase>
                ))}
              </Box>
            )}
            <ButtonBase
              onClick={() => void toast.undo()}
              sx={{
                minHeight: 40,
                minWidth: 56,
                px: 1.5,
                borderRadius: `${RADIUS.pill}px`,
                fontWeight: 700,
                fontSize: '0.875rem',
                color: 'inherit',
                textDecoration: 'underline',
              }}
            >
              {t('presets.undo.action')}
            </ButtonBase>
          </Box>
        )}
        {toast.error !== null && (
          <Typography
            variant="body2"
            sx={(theme) => ({
              pointerEvents: 'auto',
              p: 1.5,
              borderRadius: `${RADIUS.input}px`,
              backgroundColor: palette(theme).category.health.bg,
              color: palette(theme).category.health.fg,
            })}
          >
            {describeApiError(toast.error)}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
