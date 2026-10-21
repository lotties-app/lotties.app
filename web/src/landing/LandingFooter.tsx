import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Link, Stack, Typography } from '@mui/material';
import { isLocalePreference, LOCALES, type LocalePreference } from '../i18n/config';
import { useLocale } from '../i18n/useLocale';
import { InstallAppButton } from '../pwa/InstallAppButton';
import { useThemeMode } from '../theme/ThemeModeContext';
import type { ThemeMode } from '../theme/theme';
import { SegmentedControl } from '../ui/form';
import { PAGE_WIDTH } from './features';
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

/** Language and theme switches, the source link, the licence line, install and the medical note. */
export function LandingFooter() {
  const { t } = useTranslation('landing');
  const { preference, setPreference } = useLocale();
  const { mode, setMode } = useThemeMode();
  const source = repoUrl();
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
        <InstallAppButton />
        <Stack spacing={1}>
          {source && (
            <Link
              href={source}
              target="_blank"
              rel="noopener noreferrer"
              sx={{ alignSelf: 'flex-start' }}
            >
              {t('footer.source')}
            </Link>
          )}
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
