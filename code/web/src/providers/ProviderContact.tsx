import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Link, Stack, Typography } from '@mui/material';
import type { CareProvider } from '../db/models';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/icons';
import { mailtoUrl, mapsUrl, telUrl, websiteLabel, websiteUrl, whatsappUrl } from './providerModel';

/** Links that leave the app open in a new tab and never hand it the opener. */
const NEW_TAB = { target: '_blank', rel: 'noopener noreferrer' } as const;

interface LinkRowProps {
  icon: IconName;
  /** What the link does, read before its value ("Call", "Open in maps"). */
  action?: string;
  href: string;
  /** Opens in a new tab (maps, WhatsApp, website). */
  external?: boolean;
  children: ReactNode;
}

/** One tappable contact line: icon, the visible value and, for a screen reader, the action first. */
function LinkRow({ icon, action, href, external = false, children }: LinkRowProps) {
  return (
    <Link
      href={href}
      {...(external ? NEW_TAB : {})}
      underline="hover"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        minHeight: 44,
        py: 0.5,
        color: 'primary.main',
      }}
    >
      <Box component="span" sx={{ flex: 'none', display: 'inline-flex' }}>
        <Icon name={icon} size={20} />
      </Box>
      <Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}>
        {action && (
          <Box component="span" sx={visuallyHidden}>
            {action}:{' '}
          </Box>
        )}
        {children}
      </Box>
    </Link>
  );
}

const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

type Contact = Pick<
  CareProvider,
  'phone' | 'whatsapp' | 'email' | 'website' | 'address' | 'clinicName'
>;

/**
 * A provider's contact details as links: call (`tel:`), WhatsApp, e-mail, website, and the address
 * with "Open in maps". Only what is filled in (and usable as a link) is shown. `withAddress` off
 * leaves the address text out (the appointment detail already prints the place it copied) but
 * keeps the maps link.
 */
export function ProviderContact({
  provider,
  withAddress = true,
}: {
  provider: Contact;
  withAddress?: boolean;
}) {
  const { t } = useTranslation();
  const tel = telUrl(provider.phone);
  const whatsapp = whatsappUrl(provider.whatsapp);
  const mail = mailtoUrl(provider.email);
  const site = websiteUrl(provider.website);
  const maps = mapsUrl(provider);
  const address = provider.address?.trim();
  return (
    <Stack spacing={0.25}>
      {tel && (
        <LinkRow icon="phone" action={t('providers.contact.call')} href={tel}>
          {provider.phone}
        </LinkRow>
      )}
      {!tel && provider.phone && (
        <Typography sx={{ display: 'flex', gap: 1.5, alignItems: 'center', minHeight: 44 }}>
          <Icon name="phone" size={20} />
          {provider.phone}
        </Typography>
      )}
      {whatsapp && (
        <LinkRow icon="whatsapp" action={t('providers.contact.whatsapp')} href={whatsapp} external>
          {provider.whatsapp}
        </LinkRow>
      )}
      {mail && (
        <LinkRow icon="mail" action={t('providers.contact.email')} href={mail}>
          {provider.email}
        </LinkRow>
      )}
      {site && (
        <LinkRow icon="world" action={t('providers.contact.website')} href={site} external>
          {websiteLabel(provider.website ?? '')}
        </LinkRow>
      )}
      {withAddress && address && (
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', py: 0.5 }}>
          <Box sx={{ color: 'text.secondary', pt: 0.25, flex: 'none' }}>
            <Icon name="map-pin" size={20} />
          </Box>
          <Typography sx={{ overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}>
            {address}
          </Typography>
        </Box>
      )}
      {maps && (
        <LinkRow icon="external-link" href={maps} external>
          {t('providers.contact.maps')}
        </LinkRow>
      )}
    </Stack>
  );
}
