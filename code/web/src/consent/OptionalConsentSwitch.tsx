import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { FormControlLabel, FormHelperText, Switch } from '@mui/material';
import { useApiClient } from '../api/ApiClientContext';
import { useOnline } from '../sync/useOnline';
import { CONSENTS_QUERY_KEY, getConsents, type OptionalConsentKind } from './consentApi';
import { useConsent } from './ConsentContext';

const LABEL = { alexa: 'consent.optional.switchAlexa', mcp: 'consent.optional.switchMcp' } as const;

/**
 * The switch that records an optional consent for a feature with no switch of its own in the app (the Alexa skill, an AI assistant
 * connection), with the sentence of docs/CONSENT-AND-TERMS-DRAFT.md section 3 next to it. It is a record, not a lock: the adapters
 * work for anyone with the core consent; the record says the person was told what leaves our control and turned the feature on. The
 * change is recorded through `ConsentProvider.recordOptional`, which never blocks and retries a failed call.
 */
export function OptionalConsentSwitch({
  kind,
}: {
  kind: Extract<OptionalConsentKind, 'alexa' | 'mcp'>;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const online = useOnline();
  const { recordOptional } = useConsent();
  const [chosen, setChosen] = useState<boolean | null>(null);
  const stored = useQuery({
    queryKey: CONSENTS_QUERY_KEY,
    queryFn: () => getConsents(api),
    enabled: online,
    gcTime: 0,
  });
  const checked = chosen ?? stored.data?.optional?.[kind]?.accepted ?? false;
  const hintId = `optional-consent-${kind}-hint`;
  return (
    <>
      <FormControlLabel
        control={
          <Switch
            checked={checked}
            onChange={(event) => {
              setChosen(event.target.checked);
              recordOptional(kind, event.target.checked);
            }}
            slotProps={{ input: { 'aria-describedby': hintId } }}
          />
        }
        label={t(LABEL[kind])}
      />
      <FormHelperText id={hintId} sx={{ mt: -1 }}>
        {t(`consent.optional.${kind}`)}
      </FormHelperText>
    </>
  );
}
