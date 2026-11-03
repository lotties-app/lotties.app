import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Link, Stack, Typography } from '@mui/material';
import { isLocalePreference, LOCALES, type LocalePreference } from '../i18n/config';
import { useLocale } from '../i18n/useLocale';
import { readBuildInfo } from '../config/buildInfo';
import { displayVersion } from '../config/versionInfo';
import { useInstallState } from '../install/useInstallState';
import { useThemeMode } from '../theme/ThemeModeContext';
import type { ThemeMode } from '../theme/theme';
import { SegmentedControl } from '../ui/form';
import { VersionLine } from '../ui/VersionLine';
import { BetaNotice } from './BetaNotice';
import { PAGE_WIDTH } from './features';
import { newTabFor, problemReportUrl, supportUrl } from './outboundLinks';
import { repoUrl } from './repoUrl';

const THEME_OPTIONS = [
  { value: 'system', key: 'footer.themeSystem' },
  { value: 'light', key: 'footer.themeLight' },
  { value: 'dark', key: 'footer.themeDark' },
] as const satisfies readonly { value: ThemeMode; key: string }[];

function Setting({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <Box role="group" aria-labelledby={id} sx={{ minWidth: 0 }}>
      <Typography id={id} variant="overline" component="p" color="text.secondary" sx={{ mb: 0.5 }}>
        {label}
      </Typography>
      {children}
    </Box>
  );
}

/** Whether `url` points at GitHub (the source link then says so). */
function onGithub(url: string): boolean {
  return new URL(url).hostname.replace(/^www\./, '') === 'github.com';
}

/**
 * Language and theme switches, the version line with the source link, the install guide, credits,
 * privacy, terms, self-host and voice commands links, "Report a problem" and "Support Lotties"
 * (each only when configured, src/landing/outboundLinks.ts), the licence line and the medical note.
 */
export function LandingFooter() {
  const { t } = useTranslation('landing');
  const { native } = useInstallState();
  const { preference, setPreference } = useLocale();
  const { mode, setMode } = useThemeMode();
  const source = repoUrl();
  const support = supportUrl();
  const report = problemReportUrl(undefined, {
    subject: t('footer.reportSubject'),
    body: `Lotties ${displayVersion(readBuildInfo().version)}`,
  });
  const languages: { value: LocalePreference; label: string }[] = [
    { value: 'system', label: t('footer.languageSystem') },
    ...LOCALES.map((l) => ({
      value: l.code,
      label: l.code === 'pt-BR' ? 'Português' : l.nativeName,
    })),
  ];
  return (
    <Box component="footer" sx={{ borderTop: 1, borderColor: 'divider', pb: 5 }}>
      <Stack spacing={3} sx={{ maxWidth: PAGE_WIDTH, mx: 'auto', px: 2, pt: 4 }}>
        <Box
          sx={{
            display: 'grid',
            gap: 3,
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' },
          }}
        >
          <Setting id="landing-language" label={t('footer.language')}>
            <SegmentedControl<LocalePreference>
              aria-label={t('footer.language')}
              value={preference}
              onChange={(value) => value && isLocalePreference(value) && setPreference(value)}
              options={languages}
            />
          </Setting>
          <Setting id="landing-theme" label={t('footer.theme')}>
            <SegmentedControl<ThemeMode>
              aria-label={t('footer.theme')}
              value={mode}
              onChange={(value) => value && setMode(value)}
              options={THEME_OPTIONS.map((o) => ({ value: o.value, label: t(o.key) }))}
            />
          </Setting>
        </Box>
        <Stack spacing={1}>
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ alignItems: 'center', flexWrap: 'wrap' }}
          >
            <VersionLine brand />
            {source && (
              <>
                <Typography variant="caption" color="text.secondary" aria-hidden>
                  ·
                </Typography>
                <Link href={source} target="_blank" rel="noopener noreferrer">
                  {t(onGithub(source) ? 'footer.sourceGithub' : 'footer.source')}
                </Link>
              </>
            )}
          </Stack>
          {!native && (
            <Link component={RouterLink} to="/install" sx={{ alignSelf: 'flex-start' }}>
              {t('footer.install')}
            </Link>
          )}
          <Link component={RouterLink} to="/credits" sx={{ alignSelf: 'flex-start' }}>
            {t('footer.credits')}
          </Link>
          <Link component={RouterLink} to="/privacy" sx={{ alignSelf: 'flex-start' }}>
            {t('footer.privacy')}
          </Link>
          <Link component={RouterLink} to="/terms" sx={{ alignSelf: 'flex-start' }}>
            {t('footer.terms')}
          </Link>
          <Link component={RouterLink} to="/self-host" sx={{ alignSelf: 'flex-start' }}>
            {t('footer.selfHost')}
          </Link>
          <Link component={RouterLink} to="/voice-commands" sx={{ alignSelf: 'flex-start' }}>
            {t('footer.voiceCommands')}
          </Link>
          {report && (
            <Link href={report} {...newTabFor(report)} sx={{ alignSelf: 'flex-start' }}>
              {t('footer.reportProblem')}
            </Link>
          )}
          {support && (
            <Link href={support} {...newTabFor(support)} sx={{ alignSelf: 'flex-start' }}>
              {t('footer.support')}
            </Link>
          )}
          <BetaNotice />
          <Typography variant="body2" color="text.secondary">
            {t('footer.licence')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('footer.notMedical')}
          </Typography>
        </Stack>
      </Stack>
    </Box>
  );
}
