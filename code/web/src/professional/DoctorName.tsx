import { useTranslation } from 'react-i18next';
import { Box, Chip, Typography } from '@mui/material';
import type { PersonSummary } from '../db/models';
import { Icon } from '../ui/Icon';
import { doctorLabel } from './doctorLabel';

/**
 * "Self-declared doctor" next to every doctor's name, unless the operator verified the profile
 * (docs/design/16-doctor-access.md sections 1 and 10.6): then "Verified professional" with a check.
 * The app itself never checks a registration.
 */
export function SelfDeclaredBadge({ verified = false }: { verified?: boolean }) {
  const { t } = useTranslation();
  return (
    <Chip
      size="small"
      variant="outlined"
      color={verified ? 'success' : 'default'}
      icon={verified ? <Icon name="success" size={16} /> : undefined}
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
