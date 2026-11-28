import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Stack,
  Typography,
} from '@mui/material';
import { formatTime } from '../i18n/format';
import { useLocale } from '../i18n/useLocale';
import { Icon } from '../ui/Icon';

/** Keys shown at once, newest first. */
const KEPT = 20;

interface Press {
  id: number;
  key: string;
  code: string;
  at: number;
}

/** Every `keydown` while it is open: what a Bluetooth button or a remote sends (mode c, design 49). */
function useKeyPresses(active: boolean) {
  const [presses, setPresses] = useState<Press[]>([]);
  const counter = useRef(0);
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      counter.current += 1;
      const press = { id: counter.current, key: event.key, code: event.code, at: Date.now() };
      setPresses((all) => [press, ...all].slice(0, KEPT));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
  return { presses, clear: () => setPresses([]) };
}

export function KeyLogger() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const { presses, clear } = useKeyPresses(open);
  return (
    <Accordion
      expanded={open}
      onChange={(_, next) => setOpen(next)}
      disableGutters
      slotProps={{ transition: { unmountOnExit: true } }}
      data-testid="voice-lab-keys"
    >
      <AccordionSummary expandIcon={<Icon name="expand" />} sx={{ minHeight: 56 }}>
        <Typography variant="subtitle1" component="h2">
          {t('voiceLab.keys.title')}
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary">
            {t('voiceLab.keys.hint')}
          </Typography>
          {presses.length === 0 ? (
            <Typography variant="body2">{t('voiceLab.keys.empty')}</Typography>
          ) : (
            <Box component="ul" sx={{ m: 0, pl: 3 }} aria-live="polite">
              {presses.map((press) => (
                <Typography
                  component="li"
                  variant="body2"
                  key={press.id}
                  sx={{ fontFamily: 'monospace' }}
                >
                  {t('voiceLab.keys.row', {
                    time: formatTime(press.at, locale),
                    keyName: press.key,
                    code: press.code || t('voiceLab.summary.missing'),
                  })}
                </Typography>
              ))}
            </Box>
          )}
          <Button size="small" sx={{ alignSelf: 'flex-start' }} onClick={clear}>
            {t('voiceLab.keys.clear')}
          </Button>
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}
