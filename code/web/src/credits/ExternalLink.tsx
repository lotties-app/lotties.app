import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Link } from '@mui/material';
import { visuallyHidden } from '../insights/charts/chartStyle';
import { isNativeApp } from '../platform/nativeApp';

/**
 * A link to another site. In a browser it opens a new tab (noopener); inside the native app a plain
 * new-window link goes nowhere, so it opens the system browser through the platform adapter.
 * Screen readers are told it opens a new window.
 */
export function ExternalLink({
  href,
  children,
  sx,
}: {
  href: string;
  children: ReactNode;
  sx?: object;
}) {
  const { t } = useTranslation();
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => {
        if (!isNativeApp()) return;
        event.preventDefault();
        void import('../platform/nativeShell').then((m) => m.capacitorShell.openBrowser(href));
      }}
      sx={{ overflowWrap: 'anywhere', ...sx }}
    >
      {children}
      <Box component="span" sx={visuallyHidden}>
        {' '}
        {t('credits.externalSuffix')}
      </Box>
    </Link>
  );
}
