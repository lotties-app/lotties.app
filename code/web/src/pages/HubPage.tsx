import { useTranslation } from 'react-i18next';
import { CircularProgress } from '@mui/material';
import { HubScreen } from '../hub/HubScreen';
import { useHubContext } from '../hub/useHubContext';

/** `/hub`: the places that are not a daily tab, grouped (docs/design/21-hub.md). */
export function HubPage() {
  const { t } = useTranslation();
  const context = useHubContext();
  if (!context) return <CircularProgress aria-label={t('common.loading')} />;
  return <HubScreen context={context} />;
}
