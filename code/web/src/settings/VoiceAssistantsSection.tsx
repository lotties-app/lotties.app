import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  CircularProgress,
  Divider,
  FormControlLabel,
  FormHelperText,
  Link,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useApiClient } from '../api/ApiClientContext';
import {
  ASSISTANT_SETTINGS_KEY,
  getAssistantSettings,
  saveAssistantSettings,
} from '../assistants/assistantSettingsApi';
import { configuredAuthority } from '../assistants/connectedApps';
import { canLog } from '../baby/permissions';
import type { Baby } from '../db/models';
import { ErrorNotice } from './ErrorNotice';
import { McpConnectorPanel } from './McpConnectorPanel';
import { useServerAction } from './useServerAction';

const NONE = '';

/**
 * Settings > Voice assistants (docs/design/32-assistants.md): the baby that voice commands log and
 * answer for, chosen among the babies the user can log for (the server refuses any other). With
 * one such baby it is used without a choice. When the server offers the MCP server, the AI
 * assistants panel follows (`authority` is the OIDC issuer whose account console lists the
 * connected apps). Online only.
 */
export function VoiceAssistantsSection({
  babies,
  authority = configuredAuthority(),
}: {
  babies: readonly Baby[];
  authority?: string | null;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const action = useServerAction({ validation_failed: () => t('assistants.saveFailed') });
  const [saved, setSaved] = useState(false);
  const settings = useQuery({
    queryKey: ASSISTANT_SETTINGS_KEY,
    queryFn: () => getAssistantSettings(api),
    enabled: action.online,
  });
  const loggable = babies.filter(canLog);

  if (!action.online && settings.data === undefined) {
    return <Alert severity="warning">{t('errors.offline')}</Alert>;
  }
  if (settings.isError) return <ErrorNotice message={t('assistants.loadFailed')} />;
  if (settings.data === undefined) return <CircularProgress aria-label={t('common.loading')} />;

  const stored = settings.data.defaultBabyId;
  const value = loggable.some((baby) => baby.id === stored) ? (stored ?? NONE) : NONE;

  const choose = async (babyId: string) => {
    setSaved(false);
    const ok = await action.run(async () => {
      const next = await saveAssistantSettings(api, babyId === NONE ? null : babyId);
      queryClient.setQueryData(ASSISTANT_SETTINGS_KEY, next);
    });
    setSaved(ok);
  };

  const sayBabyName = settings.data.sayBabyName === true;
  const toggleName = async (next: boolean) => {
    setSaved(false);
    const ok = await action.run(async () => {
      const result = await saveAssistantSettings(api, value === NONE ? null : value, next);
      queryClient.setQueryData(ASSISTANT_SETTINGS_KEY, result);
    });
    setSaved(ok);
  };

  return (
    <Stack spacing={1.5}>
      <Typography color="text.secondary">{t('assistants.intro')}</Typography>
      <TextField
        select
        label={t('assistants.babyLabel')}
        value={value}
        disabled={action.pending}
        onChange={(e) => void choose(e.target.value)}
        slotProps={{
          select: { native: true },
          inputLabel: { shrink: true },
          htmlInput: { 'aria-describedby': 'voice-assistants-hint' },
        }}
      >
        <option value={NONE}>{t('assistants.noneChosen')}</option>
        {loggable.map((baby) => (
          <option key={baby.id} value={baby.id}>
            {baby.name}
          </option>
        ))}
      </TextField>
      <FormHelperText id="voice-assistants-hint">
        {loggable.length === 1
          ? t('assistants.hintOne', { name: loggable[0].name })
          : t('assistants.hintSeveral')}
      </FormHelperText>
      <FormControlLabel
        control={
          <Switch
            checked={sayBabyName}
            disabled={action.pending}
            onChange={(e) => void toggleName(e.target.checked)}
            slotProps={{ input: { 'aria-describedby': 'voice-assistants-name-hint' } }}
          />
        }
        label={t('assistants.sayBabyName.label')}
      />
      <FormHelperText id="voice-assistants-name-hint" sx={{ mt: -1 }}>
        {t('assistants.sayBabyName.hint')}
      </FormHelperText>
      <ErrorNotice message={action.error} />
      <Typography variant="body2" role="status" aria-live="polite">
        {saved ? t('assistants.saved') : ''}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t('assistants.privacy')}
      </Typography>
      <Link
        component={RouterLink}
        to="/hub/privacy#privacy-sharing-companies"
        variant="body2"
        sx={{
          alignSelf: 'flex-start',
          minHeight: 44,
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        {t('assistants.privacyLink')}
      </Link>
      {settings.data.mcpEnabled && settings.data.mcpUrl && (
        <>
          <Divider />
          <McpConnectorPanel url={settings.data.mcpUrl} authority={authority} />
        </>
      )}
    </Stack>
  );
}
