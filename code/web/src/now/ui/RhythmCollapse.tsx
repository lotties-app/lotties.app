import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button } from '@mui/material';
import { Icon } from '../../ui/Icon';
import { readRingOpen, writeRingOpen } from '../ringPrefs';

/**
 * The folding part of the state card that holds the day ring (or the ruler) and its view toggle.
 * Open or folded is remembered per device; a short or narrow screen starts folded so the actions
 * stay in the first screen (`defaultRingOpen`).
 */
export function RhythmCollapse({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(readRingOpen);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    writeRingOpen(next);
  };
  return (
    <Box sx={{ mt: 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
        <Button
          color="inherit"
          aria-expanded={open}
          aria-controls={id}
          onClick={toggle}
          endIcon={<Icon name={open ? 'collapse' : 'expand'} size={16} />}
          sx={{ minHeight: 44, color: 'text.secondary', fontWeight: 600 }}
        >
          {open ? t('nowLayout.ring.hide') : t('nowLayout.ring.show')}
        </Button>
      </Box>
      <Box id={id} hidden={!open} data-testid="rhythm-region">
        {open && children}
      </Box>
    </Box>
  );
}
