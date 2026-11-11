import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Checkbox, FormControlLabel, Link, Stack, Typography } from '@mui/material';
import { useApiClient } from '../api/ApiClientContext';
import { babyShownName } from '../baby/shownName';
import type { Baby } from '../db/models';
import { formatDate } from '../i18n/format';
import { useLocale } from '../i18n/useLocale';
import { ErrorNotice } from '../settings/ErrorNotice';
import { SettingsSection } from '../settings/SettingsSection';
import { useServerAction } from '../settings/useServerAction';
import {
  COMMUNITY_CONSENT_TEXT_VERSION,
  communityConsentQueryKey,
  setCommunityConsent,
  type CommunityConsentView,
  type SetCommunityConsentRequest,
} from './communityConsentApi';
import { useCommunityConsent } from './useCommunityConsent';

/** The state line: off, on since (and by whom), off since, or waiting for a yes to a changed text. */
function StateLine({ view, name }: { view: CommunityConsentView; name: string }) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const latest = view.latest;
  if (view.status === 'renewal_needed') {
    return (
      <Typography variant="body2">
        {t('communityInsights.state.renewalNeeded', { name })}
      </Typography>
    );
  }
  if (!latest || (view.status !== 'on' && view.status !== 'off')) {
    return <Typography variant="body2">{t('communityInsights.state.none', { name })}</Typography>;
  }
  const values = {
    name,
    date: formatDate(latest.at, 'dayMonthYear', locale),
    who: latest.byMe ? t('communityInsights.state.you') : latest.byName,
  };
  return (
    <Typography variant="body2">
      {t(
        view.status === 'on' ? 'communityInsights.state.on' : 'communityInsights.state.off',
        values,
      )}
    </Typography>
  );
}

/** The three points of the opt-in screen, in order. */
const SCREEN_POINTS = [
  'communityInsights.screen.onlyUse',
  'communityInsights.screen.groups',
  'communityInsights.screen.optional',
] as const;

/** The opt-in screen of design 34 section 3.5: the text, both declarations (required), turn on or not now. */
function OptInScreen({
  name,
  pending,
  onTurnOn,
  onNotNow,
}: {
  name: string;
  pending: boolean;
  onTurnOn: () => void;
  onNotNow: () => void;
}) {
  const { t } = useTranslation();
  const [guardian, setGuardian] = useState(false);
  const [agree, setAgree] = useState(false);
  return (
    <Stack spacing={1.5} component="section" aria-labelledby="community-insights-screen-title">
      <Typography variant="subtitle1" component="h3" id="community-insights-screen-title">
        {t('communityInsights.title')}
      </Typography>
      <Typography variant="body2">{t('communityInsights.screen.intro', { name })}</Typography>
      <Box component="ul" sx={{ m: 0, pl: 3 }}>
        {SCREEN_POINTS.map((key) => (
          <Typography key={key} component="li" variant="body2" sx={{ mb: 0.5 }}>
            {t(key, { name })}
          </Typography>
        ))}
      </Box>
      <FormControlLabel
        control={<Checkbox checked={guardian} onChange={(e) => setGuardian(e.target.checked)} />}
        label={t('communityInsights.screen.guardian', { name })}
      />
      <FormControlLabel
        control={<Checkbox checked={agree} onChange={(e) => setAgree(e.target.checked)} />}
        label={
          <Trans
            i18nKey="communityInsights.screen.agree"
            values={{ name }}
            components={{
              privacy: <Link component={RouterLink} to="/privacy#privacy-community-insights" />,
            }}
          />
        }
      />
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <Button
          variant="contained"
          disabled={!guardian || !agree || pending}
          onClick={onTurnOn}
          sx={{ minHeight: 44 }}
        >
          {t('communityInsights.screen.turnOn', { name })}
        </Button>
        <Button onClick={onNotNow} disabled={pending} sx={{ minHeight: 44 }}>
          {t('communityInsights.screen.notNow')}
        </Button>
      </Stack>
    </Stack>
  );
}

/** Turning it on or off, with the answer written straight into the query cache. */
function useSetCommunityConsent(baby: Baby) {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const { locale } = useLocale();
  const action = useServerAction({
    community_consent_version_outdated: () => t('communityInsights.errors.outdated'),
    community_consent_not_allowed: () => t('communityInsights.errors.notAllowed'),
  });
  const send = (request: SetCommunityConsentRequest) =>
    action.run(async () => {
      const view = await setCommunityConsent(api, baby.id, { ...request, locale });
      queryClient.setQueryData(communityConsentQueryKey(baby.id), view);
    });
  return {
    ...action,
    turnOn: () =>
      send({ granted: true, textVersion: COMMUNITY_CONSENT_TEXT_VERSION, guardianConfirmed: true }),
    turnOff: () => send({ granted: false }),
  };
}

/**
 * Settings > Community insights (docs/design/34-community-insights.md section 3, task T2): the
 * baby's consent and the switch, for an Owner or a Parent, only when the server offers the feature
 * (a 404, an error or offline: nothing at all). Turning it off is one tap and takes effect at once.
 */
export function CommunityInsightsSection({ baby, expanded }: { baby: Baby; expanded: boolean }) {
  const { t } = useTranslation();
  const { data } = useCommunityConsent(baby);
  const consent = useSetCommunityConsent(baby);
  const [screenOpen, setScreenOpen] = useState(false);
  if (!data) return null;
  const name = babyShownName(baby);
  const on = data.status === 'on';

  const turnOn = async () => {
    if (await consent.turnOn()) setScreenOpen(false);
  };

  return (
    <SettingsSection
      id="community-insights"
      title={t('communityInsights.title')}
      defaultExpanded={expanded}
    >
      <Stack spacing={1.5}>
        <StateLine view={data} name={name} />
        {on && (
          <Button
            variant="outlined"
            onClick={() => void consent.turnOff()}
            disabled={consent.pending}
            sx={{ alignSelf: 'flex-start', minHeight: 44 }}
          >
            {t('communityInsights.turnOff')}
          </Button>
        )}
        {!on && !screenOpen && (
          <Button
            variant="outlined"
            onClick={() => setScreenOpen(true)}
            sx={{ alignSelf: 'flex-start', minHeight: 44 }}
          >
            {t('communityInsights.open')}
          </Button>
        )}
        {!on && screenOpen && (
          <OptInScreen
            name={name}
            pending={consent.pending}
            onTurnOn={() => void turnOn()}
            onNotNow={() => setScreenOpen(false)}
          />
        )}
        <ErrorNotice message={consent.error} />
      </Stack>
    </SettingsSection>
  );
}
