import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Link, Typography } from '@mui/material';
import { readBuildInfo } from '../config/buildInfo';
import { displayVersion } from '../config/versionInfo';

const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

/**
 * The quiet version line at the bottom of a page (Settings, the Hub, the public footers): this
 * device's release as real text, "v0.1.38", or "Lotties v0.1.38" with `brand`. With `to` it is a
 * link to the About screen. Screen readers hear "App version" first.
 */
export function VersionLine({ to, brand = false }: { to?: string; brand?: boolean }) {
  const { t } = useTranslation();
  const version = displayVersion(readBuildInfo().version);
  const text = (
    <>
      <Box component="span" sx={visuallyHidden}>
        {`${t('hub.about.appVersion')}:`}
      </Box>{' '}
      {brand ? `Lotties ${version}` : version}
    </>
  );
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      component="p"
      data-testid="version-line"
      sx={{ m: 0 }}
    >
      {to ? (
        <Link
          component={RouterLink}
          to={to}
          color="inherit"
          sx={{ display: 'inline-flex', alignItems: 'center', minHeight: 44 }}
        >
          {text}
        </Link>
      ) : (
        text
      )}
    </Typography>
  );
}
