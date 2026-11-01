import type { TFunction } from 'i18next';
import { ListItemText, MenuItem } from '@mui/material';
import type { BabyRole } from '../db/models';

/**
 * The options of a role picker (invites, members): each role's name with its one-line
 * description. Pass `selectRoleProps(t)` to the select so the field itself shows the name only.
 */
export function roleOptions(roles: readonly BabyRole[], t: TFunction) {
  return roles.map((role) => (
    <MenuItem key={role} value={role} sx={{ whiteSpace: 'normal', maxWidth: 360 }}>
      <ListItemText primary={t(`baby.roles.${role}`)} secondary={t(`baby.roleHints.${role}`)} />
    </MenuItem>
  ));
}

/** `slotProps.select` of a role picker: the closed field shows the role's name. */
export function selectRoleProps(t: TFunction) {
  return { renderValue: (value: unknown): string => t(`baby.roles.${value as BabyRole}`) };
}
