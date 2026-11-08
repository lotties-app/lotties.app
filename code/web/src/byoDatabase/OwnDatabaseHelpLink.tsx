import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { Link } from '@mui/material';
import { ownDatabaseHelpHref, type GuideSection } from './guideSections';

/**
 * "What this means and what to do": from a store problem (status banner, test result, failed
 * action) to the matching part of `/help/own-database` (static text, works offline).
 */
export function OwnDatabaseHelpLink({
  section = 'troubleshooting',
}: {
  section?: GuideSection;
}) {
  const { t } = useTranslation();
  return (
    <Link
      component={RouterLink}
      to={ownDatabaseHelpHref(section)}
      sx={{ display: 'inline-flex', alignItems: 'center', minHeight: 44 }}
    >
      {t('byoDatabase.help.whatToDo')}
    </Link>
  );
}
