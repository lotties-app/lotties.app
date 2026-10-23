import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { Link, Paper, Stack, Typography } from '@mui/material';
import { readBuildInfo } from '../config/buildInfo';
import { formatDateTime } from '../i18n/format';
import { repoUrl } from '../landing/repoUrl';
import { RADIUS } from '../theme/tokens';

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Typography variant="caption" color="text.secondary" component="dt">
        {label}
      </Typography>
      <Typography component="dd" sx={{ m: 0, fontWeight: 500, overflowWrap: 'anywhere' }}>
        {value}
      </Typography>
    </div>
  );
}

/** Hub > About: what this build is (version, build date and commit stamped at build time) and its licence. */
export function AboutScreen() {
  const { t } = useTranslation();
  const { version, builtAt, commit } = readBuildInfo();
  const source = repoUrl();
  return (
    <Paper sx={{ p: 2.5, borderRadius: `${RADIUS.card}px` }}>
      <Stack spacing={2}>
        <Typography color="text.secondary">{t('hub.about.tagline')}</Typography>
        <Stack component="dl" spacing={1.5} sx={{ m: 0 }}>
          <Fact label={t('hub.about.version')} value={version} />
          <Fact
            label={t('hub.about.builtAt')}
            value={builtAt ? formatDateTime(builtAt) : t('hub.about.unknown')}
          />
          {commit && <Fact label={t('hub.about.commit')} value={commit} />}
          <Fact label={t('hub.about.license')} value={t('hub.about.licenseValue')} />
        </Stack>
        <Link
          component={RouterLink}
          to="/hub/credits"
          sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}
        >
          {t('hub.about.credits')}
        </Link>
        {source && (
          <Link
            href={source}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}
          >
            {t('hub.about.source')}
          </Link>
        )}
      </Stack>
    </Paper>
  );
}
