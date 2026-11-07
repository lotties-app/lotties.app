import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Box, Button, FormControlLabel, Switch, Typography } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../api/ApiClientContext';
import type { ProfessionalSummary } from '../db/models';
import { ErrorNotice } from '../settings/ErrorNotice';
import { useServerAction } from '../settings/useServerAction';
import { Field, TextInput } from '../ui/form';
import {
  PROFESSIONAL_LIMITS,
  PROFESSIONAL_PROFILE_KEY,
  saveProfessionalProfile,
} from './professionalApi';

interface Props {
  /** The stored profile to edit, or `null` to declare one. */
  initial: ProfessionalSummary | null;
  /** Called with the stored profile after a successful save. */
  onSaved?: (profile: ProfessionalSummary) => void;
  /** The button text ("Save", or "Save and continue" on the invite screen). */
  submitLabel?: string;
}

/**
 * The healthcare professional form (docs/design/16-doctor-access.md): the name families see, an
 * optional specialty and registration number (e.g. CRM). Self-declared: the app never checks the
 * registration and every screen says so next to her name. Online only.
 */
export function ProfessionalProfileForm({ initial, onSaved, submitLabel }: Props) {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const { run, pending, error, online } = useServerAction();
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  const [specialty, setSpecialty] = useState(initial?.specialty ?? '');
  const [registrationNumber, setRegistrationNumber] = useState(initial?.registrationNumber ?? '');
  const [shareName, setShareName] = useState(initial?.shareDisplayName ?? false);
  const [shareRegistration, setShareRegistration] = useState(initial?.shareRegistration ?? false);
  const [specialtyMissing, setSpecialtyMissing] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!specialty.trim()) return setSpecialtyMissing(true);
    const result: { profile?: ProfessionalSummary } = {};
    const ok = await run(async () => {
      result.profile = await saveProfessionalProfile(api, {
        displayName: displayName.trim(),
        specialty: specialty.trim(),
        registrationNumber: registrationNumber.trim() || null,
        shareDisplayName: shareName && displayName.trim() !== '',
        shareRegistration: shareRegistration && registrationNumber.trim() !== '',
      });
      queryClient.setQueryData(PROFESSIONAL_PROFILE_KEY, result.profile);
    });
    if (ok && result.profile) onSaved?.(result.profile);
  };

  return (
    <Box
      component="form"
      noValidate
      onSubmit={(e: FormEvent) => void submit(e)}
      sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 2 }}
    >
      <Alert severity="info">{t('doctor.profile.selfDeclaredNotice')}</Alert>
      <ErrorNotice message={error} />
      <Field
        label={t('doctor.profile.specialty')}
        required
        help={t('doctor.profile.specialtyHelp')}
        error={specialtyMissing ? t('doctor.profile.specialtyRequired') : undefined}
      >
        <TextInput
          value={specialty}
          onChange={(value) => {
            setSpecialty(value);
            setSpecialtyMissing(false);
          }}
          maxLength={PROFESSIONAL_LIMITS.specialty}
          placeholder={t('doctor.profile.specialtyPlaceholder')}
        />
      </Field>
      <Field
        label={t('doctor.profile.displayName')}
        optional
        help={t('doctor.profile.displayNameHelp')}
      >
        <TextInput
          value={displayName}
          onChange={setDisplayName}
          maxLength={PROFESSIONAL_LIMITS.displayName}
        />
      </Field>
      <FormControlLabel
        control={
          <Switch
            checked={shareName && displayName.trim() !== ''}
            disabled={displayName.trim() === ''}
            onChange={(e) => setShareName(e.target.checked)}
          />
        }
        label={t('doctor.profile.shareName')}
      />
      <Field
        label={t('doctor.profile.registrationNumber')}
        optional
        help={t('doctor.profile.registrationNumberHelp')}
      >
        <TextInput
          value={registrationNumber}
          onChange={setRegistrationNumber}
          maxLength={PROFESSIONAL_LIMITS.registrationNumber}
        />
      </Field>
      <FormControlLabel
        control={
          <Switch
            checked={shareRegistration && registrationNumber.trim() !== ''}
            disabled={registrationNumber.trim() === ''}
            onChange={(e) => setShareRegistration(e.target.checked)}
          />
        }
        label={t('doctor.profile.shareRegistration')}
      />
      <Typography variant="body2" color="text.secondary">
        {t('doctor.profile.shareNotice')}
      </Typography>
      <Button
        type="submit"
        variant="contained"
        disabled={pending || !online}
        sx={{ minHeight: 48, justifySelf: 'start', borderRadius: '999px', px: 3 }}
      >
        {submitLabel ?? t('common.save')}
      </Button>
    </Box>
  );
}
