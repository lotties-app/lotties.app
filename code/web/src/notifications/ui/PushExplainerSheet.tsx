import { useTranslation } from 'react-i18next';
import { Button, Stack, Typography } from '@mui/material';
import { SheetFrame } from '../../now/ui/SheetFrame';
import { Icon } from '../../ui/Icon';
import { PushNote } from './PushNote';

interface Props {
  open: boolean;
  pending?: boolean;
  onClose: () => void;
  /** Runs inside the click handler, so the browser prompt keeps the user gesture. */
  onTurnOn: () => void;
}

/**
 * Our own explainer before the browser's permission prompt (docs/design/09-push-notifications.md
 * section 11): what is sent, generic lock-screen text, the medication guardrail, off anytime.
 * The drawer traps focus and returns it to the switch on close.
 */
export function PushExplainerSheet({ open, pending = false, onClose, onTurnOn }: Props) {
  const { t } = useTranslation();
  return (
    <SheetFrame
      open={open}
      onClose={onClose}
      title={t('notifications.explainer.title')}
      leading={<Icon name="bell" />}
    >
      <Typography>{t('notifications.explainer.kinds')}</Typography>
      <Typography>{t('notifications.explainer.lockScreen')}</Typography>
      <PushNote>{t('notifications.guardrail')}</PushNote>
      <Typography color="text.secondary">{t('notifications.explainer.turnOff')}</Typography>
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
        <Button onClick={onClose} sx={{ minHeight: 48 }}>
          {t('notifications.explainer.notNow')}
        </Button>
        <Button variant="contained" onClick={onTurnOn} disabled={pending} sx={{ minHeight: 48 }}>
          {t('notifications.explainer.turnOn')}
        </Button>
      </Stack>
    </SheetFrame>
  );
}
