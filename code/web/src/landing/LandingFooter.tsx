import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Divider, Link, Stack, Typography } from '@mui/material';
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

/** One footer link: an in-app route (`to`) or an outbound address (`href` with its tab attributes). */
interface FooterLink {
  key: string;
  label: string;
  to?: string;
  href?: string;
  target?: string;
  rel?: string;
}

const LINK_SX = {
  alignSelf: 'flex-start',
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: { xs: 44, md: 'auto' },
} as const;

/** A labelled column of links, a `nav` landmark named by its heading; nothing when it has no link. */
function LinkGroup({ id, label, links }: { id: string; label: string; links: FooterLink[] }) {
  if (links.length === 0) return null;
  return (
    <Box component="nav" aria-labelledby={id} sx={{ minWidth: 0 }}>
      <Typography id={id} variant="overline" component="p" color="text.secondary" sx={{ mb: 0.5 }}>
        {label}
      </Typography>
      <Stack spacing={{ xs: 0, md: 1 }}>
        {links.map(({ key, label: text, to, href, target, rel }) =>
          to ? (
            <Link key={key} component={RouterLink} to={to} sx={LINK_SX}>
              {text}
            </Link>
          ) : (
            <Link key={key} href={href} target={target} rel={rel} sx={LINK_SX}>
              {text}
            </Link>
          ),
        )}
      </Stack>
    </Box>
  );
}

/**
 * Language and theme switches; three link columns (App: install guide, voice commands, self-host;
 * Project: source, credits, "Support the developer"; Help and legal: "Report a problem", privacy, terms),
 * the outbound ones only when configured (src/landing/outboundLinks.ts); then the version, the beta
 * notice, the licence line and the medical note as plain text.
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
  const groups: { id: string; label: string; links: FooterLink[] }[] = [
    {
      id: 'landing-footer-app',
      label: t('footer.groupApp'),
      links: [
        ...(native ? [] : [{ key: 'install', label: t('footer.install'), to: '/install' }]),
        { key: 'voice', label: t('footer.voiceCommands'), to: '/voice-commands' },
        { key: 'self-host', label: t('footer.selfHost'), to: '/self-host' },
      ],
    },
    {
      id: 'landing-footer-project',
      label: t('footer.groupProject'),
      links: [
        ...(source
          ? [
              {
                key: 'source',
                label: t(onGithub(source) ? 'footer.sourceGithub' : 'footer.source'),
                href: source,
                target: '_blank',
                rel: 'noopener noreferrer',
              },
            ]
          : []),
        { key: 'credits', label: t('footer.credits'), to: '/credits' },
        ...(support
          ? [{ key: 'support', label: t('footer.support'), href: support, ...newTabFor(support) }]
          : []),
      ],
    },
    {
      id: 'landing-footer-help',
      label: t('footer.groupHelp'),
      links: [
        ...(report
          ? [
              {
                key: 'report',
                label: t('footer.reportProblem'),
                href: report,
                ...newTabFor(report),
              },
            ]
          : []),
        { key: 'privacy', label: t('footer.privacy'), to: '/privacy' },
        { key: 'terms', label: t('footer.terms'), to: '/terms' },
      ],
    },
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
        <Divider sx={{ borderColor: 'divider' }} />
        <Box
          sx={{
            display: 'grid',
            gap: 3,
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(3, minmax(0, 1fr))' },
          }}
        >
          {groups.map((group) => (
            <LinkGroup key={group.id} id={group.id} label={group.label} links={group.links} />
          ))}
        </Box>
        <Divider sx={{ borderColor: 'divider' }} />
        <Box
          sx={{
            display: 'grid',
            gap: { xs: 1, md: 3 },
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(3, minmax(0, 1fr))' },
            alignItems: 'start',
          }}
        >
          <VersionLine brand prominent />
          <Stack spacing={1} sx={{ gridColumn: { md: 'span 2' } }}>
            <BetaNotice />
            <Typography variant="body2" color="text.secondary">
              {t('footer.licence')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('footer.notMedical')}
            </Typography>
          </Stack>
        </Box>
      </Stack>
    </Box>
  );
}
