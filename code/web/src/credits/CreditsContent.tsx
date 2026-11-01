import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import { RADIUS } from '../theme/tokens';
import { CURATED_CREDITS, CURATED_KINDS, SOURCE_REPOSITORY } from './curatedCredits';
import { ExternalLink } from './ExternalLink';
import { isWebAddress } from './webAddress';
import { AllPackages, DirectList } from './PackageList';
import { usePackages } from './thirdPartyData';

const AGPL_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Box component="section" aria-labelledby={id}>
      <Typography variant="h6" component="h2" id={id} sx={{ mb: 1.5 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

function CuratedSection() {
  const { t } = useTranslation();
  return (
    <Stack spacing={2.5}>
      {CURATED_KINDS.map((kind) => {
        const items = CURATED_CREDITS.filter((item) => item.kind === kind);
        if (items.length === 0) return null;
        const headingId = `credits-kind-${kind}`;
        return (
          <Box component="section" key={kind} aria-labelledby={headingId}>
            <Typography
              variant="subtitle1"
              component="h3"
              id={headingId}
              sx={{ fontWeight: 600, mb: 1 }}
            >
              {t(`credits.kinds.${kind}`)}
            </Typography>
            <Stack component="ul" spacing={1.5} sx={{ m: 0, p: 0 }}>
              {items.map((item) => (
                <Paper
                  key={item.id}
                  component="li"
                  variant="outlined"
                  sx={{ listStyle: 'none', p: 2, borderRadius: `${RADIUS.tile}px`, minWidth: 0 }}
                >
                  <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                    <ExternalLink href={item.url}>{item.name}</ExternalLink>
                  </Typography>
                  <Typography color="text.secondary" sx={{ my: 0.5 }}>
                    {t(`credits.curated.${item.id}`)}
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ overflowWrap: 'anywhere' }}
                  >
                    {t('credits.licenseLabel')}:{' '}
                    {isWebAddress(item.licenseUrl) ? (
                      <ExternalLink href={item.licenseUrl}>{item.license}</ExternalLink>
                    ) : (
                      item.license
                    )}
                  </Typography>
                </Paper>
              ))}
            </Stack>
          </Box>
        );
      })}
    </Stack>
  );
}

function SoftwareSections() {
  const { t } = useTranslation();
  const [state, retry] = usePackages();
  if (state.status === 'loading') {
    return <CircularProgress aria-label={t('credits.all.loading')} />;
  }
  if (state.status === 'failed') {
    return (
      <Alert severity="warning" action={<Button onClick={retry}>{t('credits.all.retry')}</Button>}>
        {t('credits.all.loadFailed')}
      </Alert>
    );
  }
  const packages = state.data;
  const direct = packages.filter((p) => p.direct);
  const npm = direct.filter((p) => p.ecosystem === 'npm');
  const nuget = direct.filter((p) => p.ecosystem === 'nuget');
  const rest = packages.length - direct.length;
  return (
    <>
      <Section id="credits-direct" title={t('credits.sections.direct')}>
        <Stack spacing={2}>
          <Typography color="text.secondary">{t('credits.direct.intro')}</Typography>
          <Box component="section" aria-labelledby="credits-direct-npm">
            <Typography
              variant="subtitle1"
              component="h3"
              id="credits-direct-npm"
              sx={{ fontWeight: 600 }}
            >
              {t('credits.direct.npm')}
            </Typography>
            <DirectList packages={npm} />
          </Box>
          <Box component="section" aria-labelledby="credits-direct-nuget">
            <Typography
              variant="subtitle1"
              component="h3"
              id="credits-direct-nuget"
              sx={{ fontWeight: 600 }}
            >
              {t('credits.direct.nuget')}
            </Typography>
            <DirectList packages={nuget} />
          </Box>
          <Typography variant="body2" color="text.secondary">
            {t('credits.direct.bundled', { count: rest })}
          </Typography>
        </Stack>
      </Section>
      <Section id="credits-all" title={t('credits.sections.all')}>
        <Stack spacing={1.5}>
          <Typography color="text.secondary">
            {t('credits.all.intro', { count: packages.length })}
          </Typography>
          <AllPackages packages={packages} />
        </Stack>
      </Section>
    </>
  );
}

/**
 * The credits, without a page title (the page around it supplies the h1): our license and source,
 * the data sources and services, the direct dependencies and the searchable list of every package.
 * Shared by the public /credits page, the Hub entry and the doctor's shell.
 */
export function CreditsContent() {
  const { t } = useTranslation();
  return (
    <Stack spacing={4}>
      <Stack spacing={1.5}>
        <Typography>{t('credits.intro')}</Typography>
        <Typography variant="body2" color="text.secondary">
          {t('credits.noEndorsement')}
        </Typography>
      </Stack>
      <Section id="credits-license" title={t('credits.sections.license')}>
        <Stack spacing={1}>
          <Typography>{t('credits.license.body')}</Typography>
          <Typography>
            <ExternalLink href={SOURCE_REPOSITORY}>{t('credits.license.source')}</ExternalLink>
            {' · '}
            <ExternalLink href={AGPL_URL}>{t('credits.license.text')}</ExternalLink>
          </Typography>
          <Typography color="text.secondary">{t('credits.license.notMedical')}</Typography>
        </Stack>
      </Section>
      <Section id="credits-data" title={t('credits.sections.data')}>
        <CuratedSection />
      </Section>
      <SoftwareSections />
    </Stack>
  );
}
