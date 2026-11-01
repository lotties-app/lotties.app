import { useTranslation } from 'react-i18next';
import { Typography } from '@mui/material';
import { Rich } from '../legal/RichText';
import { NO_SLOTS } from '../legal/richSlots';

/**
 * "Lotties is in beta. Read the Terms of Use." (docs/design/38-consent-and-terms.md section 5; draft text in
 * docs/CONSENT-AND-TERMS-DRAFT.md section 2): one line next to the sign-up button and in the footer, linking the terms.
 */
export function BetaNotice() {
  const { t } = useTranslation('landing');
  return (
    <Typography variant="body2" color="text.secondary" data-beta-notice="">
      <Rich text={t('beta.notice')} slots={NO_SLOTS} />
    </Typography>
  );
}
