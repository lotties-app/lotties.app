import { useTranslation } from 'react-i18next';
import { Box, Button, Chip, Link, Stack, Typography } from '@mui/material';
import { useInstallState } from '../install/useInstallState';
import { Icon } from '../ui/Icon';
import { PAGE_WIDTH } from './features';
import { NEW_TAB, newTabFor } from './outboundLinks';
import { hasAndroid, hasIphone, phoneAppLinks } from './phoneAppLinks';
import { useProblemReportUrl } from './useProblemReportUrl';

const CARD_SX = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1.5,
  p: { xs: 2, sm: 3 },
  border: 1,
  borderColor: 'divider',
  borderRadius: 3,
  bgcolor: 'background.paper',
} as const;

/**
 * "Get the phone app": how to join the iPhone beta (TestFlight) and the Android closed test
 * (Google Group + Play opt-in). Plain outbound links, no script, nothing about a person. A card, a
 * step or a button whose link is not configured is not drawn, and the whole section is absent when
 * nothing is configured (so it is safe to ship before the owner has the links). Absent in the
 * store app, which is already the phone app.
 */
export function PhoneAppStrip() {
  const { t } = useTranslation('landing');
  const { native } = useInstallState();
  const links = phoneAppLinks();
  const problem = useProblemReportUrl(t('footer.reportSubject'));
  if (native || (!hasIphone(links) && !hasAndroid(links))) return null;
  const bugs = problem;
  const steps = [
    links.androidGroup
      ? {
          key: 'group',
          href: links.androidGroup,
          label: t('phoneApp.android.group.title'),
          hint: t('phoneApp.android.group.hint'),
        }
      : null,
    links.androidOptIn
      ? {
          key: 'optIn',
          href: links.androidOptIn,
          label: t('phoneApp.android.optIn.title'),
          hint: t('phoneApp.android.optIn.hint'),
        }
      : null,
  ].filter((step): step is NonNullable<typeof step> => !!step);

  return (
    <Box
      component="section"
      id="phone-app"
      aria-labelledby="landing-phone-app"
      sx={{ maxWidth: PAGE_WIDTH, mx: 'auto', px: 2, pb: { xs: 5, md: 8 } }}
    >
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1 }}>
        <Typography id="landing-phone-app" variant="h4" component="h2">
          {t('phoneApp.title')}
        </Typography>
        <Chip label={t('phoneApp.beta')} size="small" color="secondary" />
      </Stack>
      <Typography color="text.secondary" sx={{ mb: 3, maxWidth: '65ch' }}>
        {t('phoneApp.intro')}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' },
          alignItems: 'stretch',
        }}
      >
        {hasIphone(links) && (
          <Box sx={CARD_SX}>
            <Icon name="apple" size={32} />
            <Typography variant="h6" component="h3">
              {t('phoneApp.iphone.title')}
            </Typography>
            <Typography color="text.secondary">{t('phoneApp.iphone.body')}</Typography>
            <Box sx={{ flexGrow: 1 }} />
            <Button
              component="a"
              href={links.testflight ?? undefined}
              {...NEW_TAB}
              variant="contained"
              endIcon={<Icon name="external-link" size={20} />}
              sx={{ minHeight: 48 }}
            >
              {t('phoneApp.iphone.cta')}
            </Button>
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
              {t('phoneApp.iphone.note')}
            </Typography>
          </Box>
        )}
        {hasAndroid(links) && (
          <Box sx={CARD_SX}>
            <Icon name="android" size={32} />
            <Typography variant="h6" component="h3">
              {t('phoneApp.android.title')}
            </Typography>
            {steps.length > 0 && (
              <Box component="ol" sx={{ m: 0, pl: 3, display: 'grid', gap: 1 }}>
                {steps.map((step) => (
                  <li key={step.key}>
                    <Link href={step.href} {...NEW_TAB}>
                      {step.label}
                    </Link>
                    <Typography variant="body2" color="text.secondary">
                      {step.hint}
                    </Typography>
                  </li>
                ))}
              </Box>
            )}
            <Box sx={{ flexGrow: 1 }} />
            {links.playStore && (
              <Button
                component="a"
                href={links.playStore}
                {...NEW_TAB}
                variant="contained"
                endIcon={<Icon name="external-link" size={20} />}
                sx={{ minHeight: 48 }}
              >
                {t('phoneApp.android.cta')}
              </Button>
            )}
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
              {t('phoneApp.android.note')}
            </Typography>
          </Box>
        )}
      </Box>
      {bugs && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2, textAlign: 'center' }}>
          {t('phoneApp.bug.before')}{' '}
          <Link href={bugs} {...newTabFor(bugs)}>
            {t(isGithub(bugs) ? 'phoneApp.bug.link' : 'phoneApp.bug.linkOther')}
          </Link>
          {t('phoneApp.bug.after')}
        </Typography>
      )}
    </Box>
  );
}

/** Whether the report link goes to GitHub (the text then names it; a mailto: or other tracker does not). */
function isGithub(address: string): boolean {
  try {
    return new URL(address).hostname.replace(/^www\./, '') === 'github.com';
  } catch {
    return false;
  }
}
