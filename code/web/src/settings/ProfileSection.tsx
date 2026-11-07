import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, CircularProgress, Stack, TextField, Typography } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../api/ApiClientContext';
import { LabelPicker } from '../baby/LabelPicker';
import { LABEL_MAX_LENGTH, ROLE_LABEL_PRESETS, roleLabelText } from '../baby/shownName';
import { MY_PROFILE_KEY, saveMyProfile, useMyProfile, type MyProfile } from '../profile/profileApi';
import { ErrorNotice } from './ErrorNotice';
import { useServerAction } from './useServerAction';

function ProfileForm({ initial }: { initial: MyProfile }) {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const { run, pending, error, online } = useServerAction();
  const [name, setName] = useState(initial.displayName);
  const [roleLabel, setRoleLabel] = useState(initial.roleLabel ?? ROLE_LABEL_PRESETS[0]);
  const [saved, setSaved] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSaved(false);
    void run(async () => {
      const profile = await saveMyProfile(api, {
        displayName: name,
        roleLabel: roleLabel.trim() || null,
      });
      queryClient.setQueryData(MY_PROFILE_KEY, profile);
      setSaved(true);
    });
  };

  return (
    <Stack component="form" spacing={2} onSubmit={submit} noValidate>
      <Typography color="text.secondary">{t('profile.intro')}</Typography>
      <ErrorNotice message={error} />
      <TextField
        label={t('profile.nameLabel')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        slotProps={{ htmlInput: { maxLength: LABEL_MAX_LENGTH } }}
        autoComplete="off"
      />
      <LabelPicker
        value={roleLabel}
        presets={ROLE_LABEL_PRESETS}
        presetText={roleLabelText}
        label={t('profile.roleLabel')}
        customLabel={t('profile.customLabel')}
        customOption={t('profile.custom')}
        onChange={setRoleLabel}
      />
      {saved && <Alert severity="success">{t('profile.saved')}</Alert>}
      <Button
        type="submit"
        variant="contained"
        disabled={pending || !online}
        sx={{ minHeight: 48, alignSelf: 'flex-start' }}
      >
        {t('profile.save')}
      </Button>
    </Stack>
  );
}

/** Settings > "Your name on Lotties": the optional display name and the role label (docs/design/45). */
export function ProfileSection() {
  const { t } = useTranslation();
  const profile = useMyProfile();
  if (profile.isError) return <ErrorNotice message={t('profile.loadFailed')} />;
  if (!profile.data) return <CircularProgress aria-label={t('common.loading')} />;
  return <ProfileForm key={`${profile.data.displayName}|${profile.data.roleLabel}`} initial={profile.data} />;
}
