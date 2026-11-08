import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { Alert, Box, Link, Stack, Typography } from '@mui/material';
import { ExternalLink } from '../credits/ExternalLink';
import { repoUrl } from '../landing/repoUrl';
import { ProviderGuide } from './ProviderGuide';
import { PROVIDERS } from './providers';
import { fullGuideUrl, GUIDE_SECTIONS, guideSectionId, type GuideSection } from './guideSections';

/** A key of one part (`title`, `p1`...); the parts share one shape, checked by the guide's test. */
const sectionKey = (section: GuideSection, rest: string) =>
  `byoDatabase.help.sections.${section}.${rest}` as 'byoDatabase.help.sections.about.p1';

const sectionTitleKey = (section: GuideSection) => sectionKey(section, 'title');

/** One part of the guide: a heading with an anchor and its numbered paragraphs. */
function GuidePart({ section, paragraphs }: { section: GuideSection; paragraphs: number }) {
  const { t } = useTranslation();
  const key = (rest: string) => sectionKey(section, rest);
  return (
    <Stack component="section" spacing={1} aria-labelledby={guideSectionId(section)}>
      <Typography
        id={guideSectionId(section)}
        variant="h6"
        component="h2"
        sx={{ scrollMarginTop: 72 }}
      >
        {t(key('title'))}
      </Typography>
      {Array.from({ length: paragraphs }, (_, index) => (
        <Typography key={index} variant="body2">
          {t(key(`p${index + 1}`))}
        </Typography>
      ))}
      {section === 'providers' && (
        <Stack spacing={3} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t('byoDatabase.provider.prices')}
          </Typography>
          {PROVIDERS.map((provider) => (
            <ProviderGuide key={provider} provider={provider} headingLevel="h3" />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

/**
 * `/help/own-database`: the user guide of "bring your own database" in the app (static text, works
 * offline), the short form of docs/BYO-DATABASE.md. Store problems link to its parts
 * (`OwnDatabaseHelpLink`); `#own-database-<part>` scrolls there.
 */
export function OwnDatabaseGuide() {
  const { t } = useTranslation();
  const { hash } = useLocation();
  const fullGuide = fullGuideUrl(repoUrl());

  useEffect(() => {
    const target = hash.slice(1);
    if (target) document.getElementById(target)?.scrollIntoView?.({ block: 'start' });
  }, [hash]);

  return (
    <Stack spacing={3}>
      <Typography variant="body1">{t('byoDatabase.help.intro')}</Typography>
      <Alert severity="info">{t('byoDatabase.help.availability')}</Alert>
      <Box component="nav" aria-label={t('byoDatabase.help.contents')}>
        <Box component="ul" sx={{ m: 0, pl: 3, display: 'grid', gap: 0.5 }}>
          {GUIDE_SECTIONS.map(({ id }) => (
            <li key={id}>
              <Link href={`#${guideSectionId(id)}`} sx={{ display: 'inline-block', py: 0.5 }}>
                {t(sectionTitleKey(id))}
              </Link>
            </li>
          ))}
        </Box>
      </Box>
      {GUIDE_SECTIONS.map(({ id, paragraphs }) => (
        <GuidePart key={id} section={id} paragraphs={paragraphs} />
      ))}
      {fullGuide && <ExternalLink href={fullGuide}>{t('byoDatabase.help.fullGuide')}</ExternalLink>}
    </Stack>
  );
}
