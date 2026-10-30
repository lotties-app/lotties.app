import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Box, Link, Stack, Typography } from '@mui/material';
import { PublicTopBar } from '../landing/PublicTopBar';
import { repoUrl } from '../landing/repoUrl';
import { SelfHostGenerator } from './SelfHostGenerator';

const NEED = ['server', 'domain', 'oidc', 'postgres'] as const;
const STEPS = ['clone', 'client', 'generate', 'run', 'proxy'] as const;
/** Sections of docs/DEPLOY.md worth a link, with their GitHub anchors. */
const MORE = [
  ['deploy', ''],
  ['identity', '#identity-provider'],
  ['proxy', '#reverse-proxy-and-tls'],
  ['migrations', '#database-roles'],
  ['push', '#push-notifications'],
  ['privacy', '#privacy-policy'],
] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Stack spacing={1} component="section" aria-label={title}>
      <Typography variant="h5" component="h2">
        {title}
      </Typography>
      {children}
    </Stack>
  );
}

/**
 * The public "run it yourself" page (route `/self-host`, no sign-in): what self-hosting takes, who is responsible
 * for the data, and a generator for the `.env` and `docker-compose.yml` that runs entirely in the browser.
 */
export default function SelfHostPage() {
  const { t } = useTranslation();
  const title = t('selfHost.title');
  const source = repoUrl();
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · Lotties`;
    return () => {
      document.title = previous;
    };
  }, [title]);
  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default', color: 'text.primary' }}>
      <PublicTopBar />
      <Box component="main" sx={{ maxWidth: 760, mx: 'auto', px: 2, py: 3, pb: 8 }}>
        <Stack spacing={4}>
          <Stack spacing={2}>
            <Typography variant="h4" component="h1">
              {title}
            </Typography>
            <Typography>{t('selfHost.intro')}</Typography>
            <Alert severity="info" icon={false}>
              <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
                {t('selfHost.responsibility.title')}
              </Typography>
              <Typography>{t('selfHost.responsibility.body')}</Typography>
            </Alert>
            <Typography variant="body2" color="text.secondary">
              {t('selfHost.notMedical')}
            </Typography>
          </Stack>

          <Section title={t('selfHost.need.title')}>
            <Typography>{t('selfHost.need.intro')}</Typography>
            <Typography component="ul" sx={{ m: 0, pl: 3 }}>
              {NEED.map((key) => (
                <li key={key}>{t(`selfHost.need.${key}`)}</li>
              ))}
            </Typography>
          </Section>

          <Section title={t('selfHost.steps.title')}>
            <Typography component="ol" sx={{ m: 0, pl: 3 }}>
              {STEPS.map((key) => (
                <li key={key}>{t(`selfHost.steps.${key}`)}</li>
              ))}
            </Typography>
          </Section>

          <SelfHostGenerator />

          <Section title={t('selfHost.data.title')}>
            <Typography>{t('selfHost.data.body')}</Typography>
          </Section>

          <Section title={t('selfHost.update.title')}>
            <Typography>{t('selfHost.update.body')}</Typography>
          </Section>

          <Section title={t('selfHost.more.title')}>
            <Typography>{t('selfHost.more.intro')}</Typography>
            <Typography component="ul" sx={{ m: 0, pl: 3 }}>
              {MORE.map(([key, anchor]) => (
                <li key={key}>
                  {source ? (
                    <Link
                      href={`${source.replace(/\/$/, '')}/blob/main/docs/DEPLOY.md${anchor}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t(`selfHost.more.${key}`)}
                    </Link>
                  ) : (
                    t(`selfHost.more.${key}`)
                  )}
                </li>
              ))}
            </Typography>
          </Section>
        </Stack>
      </Box>
    </Box>
  );
}
