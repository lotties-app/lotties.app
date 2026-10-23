import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { RADIUS } from '../theme/tokens';
import { Icon } from '../ui/Icon';
import { ExternalLink } from './ExternalLink';
import { isWebAddress } from './webAddress';
import { useLicenses, type ThirdPartyPackage } from './thirdPartyData';

/** In package.json's devDependencies, but their code ships inside the service worker. */
const SHIPPED_DEV = ['workbox-precaching', 'workbox-routing'];

const matches = (p: ThirdPartyPackage, query: string) =>
  `${p.name} ${p.version} ${p.license} ${p.ecosystem}`.toLowerCase().includes(query);

/** The standard text of an SPDX license, for packages that ship none. */
const spdxUrl = (license: string) =>
  /^[\w.+-]+$/.test(license)
    ? `https://spdx.org/licenses/${license}.html`
    : 'https://spdx.org/licenses/';

function LicenseText({ pkg }: { pkg: ThirdPartyPackage }) {
  const { t } = useTranslation();
  const [state, retry] = useLicenses(true);
  if (!pkg.licenseId) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('credits.all.noText', { license: pkg.license })}{' '}
        <ExternalLink href={spdxUrl(pkg.license)}>{t('credits.all.spdx')}</ExternalLink>
      </Typography>
    );
  }
  if (state.status === 'loading') {
    return <CircularProgress size={20} aria-label={t('credits.all.loading')} />;
  }
  if (state.status === 'failed') {
    return (
      <Alert severity="warning" action={<Button onClick={retry}>{t('credits.all.retry')}</Button>}>
        {t('credits.all.loadFailed')}
      </Alert>
    );
  }
  return (
    <Box
      component="pre"
      // A scrollable region must be reachable by keyboard and have a role to carry its name.
      role="region"
      tabIndex={0}
      lang="en"
      aria-label={t('credits.all.showText', { name: pkg.name })}
      sx={{
        m: 0,
        p: 1.5,
        maxHeight: 320,
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: '0.75rem',
        lineHeight: 1.5,
        borderRadius: `${RADIUS.tile}px`,
        bgcolor: 'background.default',
        color: 'text.primary',
        border: 1,
        borderColor: 'divider',
      }}
    >
      {state.data[pkg.licenseId]}
    </Box>
  );
}

/** One package: name, version and license, a link, and its license text behind a toggle. */
export function PackageRow({ pkg }: { pkg: ThirdPartyPackage }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const home = isWebAddress(pkg.homepage) ? pkg.homepage : null;
  return (
    <Box
      component="li"
      sx={{ listStyle: 'none', py: 1.25, borderTop: 1, borderColor: 'divider', minWidth: 0 }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>
            {home ? <ExternalLink href={home}>{pkg.name}</ExternalLink> : pkg.name}
            <Typography component="span" color="text.secondary" sx={{ ml: 1 }}>
              {pkg.version}
            </Typography>
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            {t(`credits.all.ecosystem.${pkg.ecosystem}`)} · {pkg.license}
          </Typography>
        </Box>
        <Button
          size="small"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={t('credits.all.showText', { name: pkg.name })}
          onClick={() => setOpen((v) => !v)}
          endIcon={<Icon name={open ? 'collapse' : 'expand'} size={20} />}
          sx={{ minHeight: 44, flexShrink: 0 }}
        >
          {t('credits.licenseLabel')}
        </Button>
      </Stack>
      <Box id={panelId} hidden={!open} sx={{ mt: 1 }}>
        {open && <LicenseText pkg={pkg} />}
      </Box>
    </Box>
  );
}

/** The direct dependencies, each with its version, license and link (no texts: they are below). */
export function DirectList({ packages }: { packages: readonly ThirdPartyPackage[] }) {
  const { t } = useTranslation();
  return (
    <Box component="ul" sx={{ m: 0, p: 0 }}>
      {packages.map((pkg) => {
        const home = isWebAddress(pkg.homepage) ? pkg.homepage : null;
        return (
          <Box
            component="li"
            key={`${pkg.name}@${pkg.version}`}
            sx={{
              listStyle: 'none',
              py: 1,
              borderTop: 1,
              borderColor: 'divider',
              display: 'flex',
              flexWrap: 'wrap',
              columnGap: 1.5,
              minWidth: 0,
            }}
          >
            <Typography sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>
              {home ? <ExternalLink href={home}>{pkg.name}</ExternalLink> : pkg.name}
            </Typography>
            <Typography color="text.secondary">
              {pkg.version} · {pkg.license}
            </Typography>
            {SHIPPED_DEV.includes(pkg.name) && (
              <Typography variant="body2" color="text.secondary">
                {t('credits.direct.shippedDev')}
              </Typography>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

/** Every package behind a toggle, with a search box (name or license) and expandable license texts. */
export function AllPackages({ packages }: { packages: readonly ThirdPartyPackage[] }) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  const [query, setQuery] = useState('');
  const searchId = useId();
  const listId = useId();
  const needle = query.trim().toLowerCase();
  const list = useMemo(
    () => (needle ? packages.filter((p) => matches(p, needle)) : packages),
    [packages, needle],
  );
  return (
    <Stack spacing={1.5}>
      <Button
        variant="outlined"
        aria-expanded={shown}
        aria-controls={listId}
        onClick={() => setShown((v) => !v)}
        sx={{ alignSelf: 'flex-start', minHeight: 48 }}
      >
        {shown ? t('credits.all.toggleHide') : t('credits.all.toggle', { count: packages.length })}
      </Button>
      <Box id={listId} hidden={!shown}>
        {shown && (
          <Stack spacing={1}>
            <TextField
              id={searchId}
              type="search"
              fullWidth
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('credits.all.searchPlaceholder')}
              slotProps={{
                htmlInput: { 'aria-label': t('credits.all.searchLabel'), enterKeyHint: 'search' },
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <Icon name="search" size={20} />
                    </InputAdornment>
                  ),
                  endAdornment: query ? (
                    <InputAdornment position="end">
                      <IconButton
                        aria-label={t('credits.all.clear')}
                        onClick={() => setQuery('')}
                        edge="end"
                        sx={{ width: 44, height: 44 }}
                      >
                        <Icon name="close" size={20} />
                      </IconButton>
                    </InputAdornment>
                  ) : undefined,
                  sx: { minHeight: 48, borderRadius: `${RADIUS.input}px` },
                },
              }}
            />
            <Typography role="status" variant="body2" color="text.secondary">
              {list.length === 0
                ? t('credits.all.none', { query: query.trim() })
                : t('credits.all.results', { count: list.length })}
            </Typography>
            <Box component="ul" sx={{ m: 0, p: 0 }}>
              {list.map((pkg) => (
                <PackageRow key={`${pkg.ecosystem}:${pkg.name}@${pkg.version}`} pkg={pkg} />
              ))}
            </Box>
          </Stack>
        )}
      </Box>
    </Stack>
  );
}
