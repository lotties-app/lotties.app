import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Stack } from '@mui/material';
import { leaveDemo, readDemoSession } from '../auth/demo/demoSession';
import { useIsDemo } from '../auth/demo/useIsDemo';
import { formatRelative } from '../i18n/format';

/**
 * Always visible in a demo (docs/design/45-try-it-demo.md): when the sample data goes away, and the
 * two ways out. "Create my real account" starts from nothing: demo data is never carried over.
 */
export function DemoBanner() {
  const { t } = useTranslation();
  const demo = useIsDemo();
  const [session] = useState(() => readDemoSession());
  // Read once with the session: the sentence is relative to when the page opened.
  const [openedAt] = useState(() => Date.now());
  if (!demo || !session) return null;
  const when = formatRelative(Date.parse(session.expiresAt), openedAt);
  return (
    <Alert
      severity="info"
      role="status"
      sx={{ mx: 2, mb: 1 }}
      action={
        <Stack direction="row" spacing={0.5}>
          <Button
            color="inherit"
            size="small"
            title={t('demo.banner.createHint')}
            onClick={() => void leaveDemo({ register: true })}
          >
            {t('demo.banner.createAccount')}
          </Button>
          <Button color="inherit" size="small" onClick={() => void leaveDemo()}>
            {t('demo.banner.leave')}
          </Button>
        </Stack>
      }
    >
      {t('demo.banner.text', { when })}
    </Alert>
  );
}
