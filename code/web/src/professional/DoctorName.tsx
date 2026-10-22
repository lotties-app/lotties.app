import { useTranslation } from 'react-i18next';
import { Box, Chip, Typography } from '@mui/material';
import type { PersonSummary } from '../db/models';
import { doctorLabel } from './doctorLabel';

/**
 * "Self-declared doctor": shown next to every doctor's name in v1 (nobody checked the registration;
 * docs/design/16-doctor-access.md). A verified profile (a later step) would read "Doctor".
 */
export function SelfDeclaredBadge({ verified = false }: { verified?: boolean }) {
  const { t } = useTranslation();
  return (
    <Chip
      size="small"
      variant="outlined"
      label={t(verified ? 'doctor.verifiedDoctor' : 'doctor.selfDeclared')}
      sx={{ height: 22, fontSize: '0.75rem' }}
    />
  );
}

/**
 * A doctor's name with the self-declared badge and, when known, her specialty: on notes, members,
 * measurements and the access log.
 */
export function DoctorName({
  person,
  hasAccess = true,
  variant = 'subtitle2',
}: {
  person: Pick<PersonSummary, 'displayName' | 'professional'>;
  hasAccess?: boolean;
  variant?: 'subtitle1' | 'subtitle2' | 'body2';
}) {
  const { t } = useTranslation();
  const specialty = person.professional?.specialty;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', minWidth: 0 }}>
      <Typography variant={variant} component="span" sx={{ fontWeight: 600 }}>
        {doctorLabel(t, person, hasAccess)}
      </Typography>
      <SelfDeclaredBadge verified={person.professional?.verified === true} />
      {specialty && (
        <Typography variant="caption" color="text.secondary" component="span">
          {specialty}
        </Typography>
      )}
    </Box>
  );
}
