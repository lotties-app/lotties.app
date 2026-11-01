import { useTranslation } from 'react-i18next';
import { Box } from '@mui/material';
import { Icon } from '../ui/Icon';

/**
 * The standing guardrail wherever doses or intervals appear (docs/design/06-medications.md
 * section 0): the app logs and reminds, the doctor's prescription is the source, no dosing advice.
 */
export function GuardrailNote() {
  const { t } = useTranslation();
  return (
    <Box
      role="note"
      sx={{
        display: 'flex',
        gap: 1,
        alignItems: 'flex-start',
        fontSize: '0.8125rem',
        color: 'text.secondary',
      }}
    >
      <Icon name="info" size={16} sx={{ mt: '2px', flex: 'none' }} />
      <span>{t('medications.guardrail')}</span>
    </Box>
  );
}
