import { useTranslation } from 'react-i18next';
import { Box, Stack, Typography } from '@mui/material';
import { formatDate } from '../i18n/format';
import { useLocale } from '../i18n/useLocale';
import { TERMS_LAST_UPDATED, TERMS_VERSION } from './consentVersions';
import { Rich } from './RichText';
import { slotsFor } from './richSlots';
import { termsFor } from './termsDocuments';

/**
 * The terms of use, without a page title (the page around it supplies the h1): the version line, the intro and the numbered
 * clauses, in the app's language. Shared by the public /terms page and the consent screen's link. The text is in terms.<lang>.ts.
 */
export function TermsContent() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const terms = termsFor(locale);
  const slots = slotsFor(terms, TERMS_VERSION, TERMS_LAST_UPDATED);
  const date = formatDate(TERMS_LAST_UPDATED, 'dayMonthYear', terms.locale);
  return (
    <Stack spacing={3} lang={terms.locale} data-terms="">
      <Typography color="text.secondary">
        {t('legal.terms.version', { version: TERMS_VERSION, date })}
      </Typography>
      <Typography>{t('legal.terms.intro')}</Typography>
      <Box component="ol" sx={{ m: 0, pl: 3, '& > li + li': { mt: 2 } }}>
        {terms.clauses.map((clause) => (
          <li key={clause.id} id={`terms-${clause.id}`}>
            <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
              {clause.title}
            </Typography>
            <Typography>
              <Rich text={clause.text} slots={slots} />
            </Typography>
          </li>
        ))}
      </Box>
    </Stack>
  );
}
