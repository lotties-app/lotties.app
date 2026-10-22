import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Chip,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createInvite, listInvites, revokeInvite } from '../api/managementApi';
import { useApiClient } from '../api/ApiClientContext';
import type { Baby, BabyRole } from '../db/models';
import { formatDate } from '../i18n/format';
import { parseRole, type InviteDto } from '../sync/contract';
import { ErrorNotice } from './ErrorNotice';
import { InviteLinkDialog } from './InviteLinkDialog';
import { roleOptions, selectRoleProps } from './roleOptions';
import { useServerAction } from './useServerAction';
import { Icon } from '../ui/Icon';

const ROLES: BabyRole[] = ['Parent', 'Caregiver', 'Viewer', 'Owner'];
const DEFAULT_DAYS = 7;

const invitesKey = (babyId: string) => ['invites', babyId] as const;

function PendingInvite({ invite, onRevoke }: { invite: InviteDto; onRevoke: () => void }) {
  const { t } = useTranslation();
  const role = parseRole(invite.role);
  return (
    <ListItem
      divider
      secondaryAction={
        <IconButton
          aria-label={t('settings.invites.revoke', { role: t(`baby.roles.${role}`) })}
          onClick={onRevoke}
        >
          <Icon name="delete" />
        </IconButton>
      }
    >
      <ListItemText
        primary={<Chip size="small" label={t(`baby.roles.${role}`)} />}
        secondary={t('settings.invites.expires', { date: formatDate(invite.expiresAt) })}
      />
    </ListItem>
  );
}

/** Owner-only: create invite links and revoke pending ones. */
export function InvitesPanel({ baby }: { baby: Baby }) {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const { run, pending, error, online } = useServerAction();
  const [role, setRole] = useState<BabyRole>('Parent');
  const [days, setDays] = useState(String(DEFAULT_DAYS));
  const [token, setToken] = useState<string | null>(null);
  const invites = useQuery({
    queryKey: invitesKey(baby.id),
    queryFn: () => listInvites(api, baby.id),
  });

  const daysNumber = Number(days);
  const daysValid = Number.isInteger(daysNumber) && daysNumber >= 1 && daysNumber <= 30;
  const refresh = () => queryClient.invalidateQueries({ queryKey: invitesKey(baby.id) });

  const create = () =>
    run(async () => {
      const created = await createInvite(api, baby.id, { role, expiresInDays: daysNumber });
      setToken(created.token);
      await refresh();
    });

  const revoke = (invite: InviteDto) =>
    run(async () => {
      await revokeInvite(api, baby.id, invite.id);
      await refresh();
    });

  return (
    <Stack spacing={2}>
      <Typography variant="subtitle1" component="h3">
        {t('settings.invites.inviteSomeone')}
      </Typography>
      <ErrorNotice message={error} />
      <Stack direction="row" spacing={1}>
        <TextField
          select
          label={t('settings.invites.role')}
          value={role}
          onChange={(e) => setRole(e.target.value as BabyRole)}
          helperText={t(`baby.roleHints.${role}`)}
          slotProps={{ select: selectRoleProps(t) }}
          sx={{ flex: 1 }}
        >
          {roleOptions(ROLES, t)}
        </TextField>
        <TextField
          label={t('settings.invites.expiresIn')}
          type="number"
          value={days}
          onChange={(e) => setDays(e.target.value)}
          error={!daysValid}
          helperText={daysValid ? null : t('settings.invites.daysRange')}
          slotProps={{ htmlInput: { min: 1, max: 30 } }}
          sx={{ flex: 1 }}
        />
      </Stack>
      <Button
        variant="contained"
        disabled={!daysValid || pending || !online}
        onClick={() => void create()}
        sx={{ minHeight: 48, alignSelf: 'flex-start' }}
      >
        {t('settings.invites.create')}
      </Button>
      <Typography variant="subtitle1" component="h3">
        {t('settings.invites.pending')}
      </Typography>
      {invites.data?.length === 0 && (
        <Typography color="text.secondary">{t('settings.invites.none')}</Typography>
      )}
      <List aria-label={t('settings.invites.pending')} disablePadding>
        {invites.data?.map((invite) => (
          <PendingInvite key={invite.id} invite={invite} onRevoke={() => void revoke(invite)} />
        ))}
      </List>
      {token && <InviteLinkDialog token={token} onClose={() => setToken(null)} />}
    </Stack>
  );
}
