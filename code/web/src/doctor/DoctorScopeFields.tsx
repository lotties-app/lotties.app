import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Box, FormControlLabel, Stack, Switch, Typography } from '@mui/material';
import { DOCTOR_SCOPES, type DoctorScope } from './scopes';

/**
 * The six sections an owner shares with a doctor (docs/design/19-doctor-dashboard.md section 2):
 * one switch per section with a one-line explanation, and what is never shared. Used by the Doctor
 * invite and by the "Doctor access" sheet of a doctor already in Members.
 */
export function DoctorScopeFields({
  value,
  onChange,
  disabled = false,
}: {
  value: readonly DoctorScope[];
  onChange: (next: DoctorScope[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const headingId = useId();
  const toggle = (scope: DoctorScope, on: boolean) => {
    const next = new Set(value);
    if (on) next.add(scope);
    else next.delete(scope);
    onChange(DOCTOR_SCOPES.filter((candidate) => next.has(candidate)));
  };
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2" component="h4" id={headingId}>
        {t('doctorDashboard.scopes.label')}
      </Typography>
      <Box role="group" aria-labelledby={headingId} sx={{ display: 'grid', gap: 0.5 }}>
        {DOCTOR_SCOPES.map((scope) => (
          <FormControlLabel
            key={scope}
            disabled={disabled}
            sx={{ alignItems: 'flex-start', mx: 0, gap: 1, py: 0.5 }}
            control={
              <Switch
                checked={value.includes(scope)}
                onChange={(event) => toggle(scope, event.target.checked)}
                sx={{ mt: -0.5 }}
              />
            }
            label={
              <Box sx={{ display: 'grid' }}>
                <Typography component="span">
                  {t(`doctorDashboard.scopes.titles.${scope}`)}
                </Typography>
                <Typography component="span" variant="body2" color="text.secondary">
                  {t(`doctorDashboard.scopes.hints.${scope}`)}
                </Typography>
              </Box>
            }
          />
        ))}
      </Box>
      {value.length === 0 && (
        <Alert severity="info">{t('doctorDashboard.scopes.noneWarning')}</Alert>
      )}
      <Typography variant="body2" color="text.secondary">
        {t('doctorDashboard.scopes.never')}
      </Typography>
    </Stack>
  );
}
