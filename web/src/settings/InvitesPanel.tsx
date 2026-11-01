import { useState } from 'react';
import {
  Button,
  Chip,
  IconButton,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createInvite, listInvites, revokeInvite } from '../api/managementApi';
import { useApiClient } from '../api/ApiClientContext';
import type { Baby, BabyRole } from '../db/models';
import { parseRole, type InviteDto } from '../sync/contract';
import { ErrorNotice } from './ErrorNotice';
import { InviteLinkDialog } from './InviteLinkDialog';
import { useServerAction } from './useServerAction';

const ROLES: BabyRole[] = ['Parent', 'Viewer', 'Owner'];
const DEFAULT_DAYS = 7;

const invitesKey = (babyId: string) => ['invites', babyId] as const;

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString();
}

function PendingInvite({ invite, onRevoke }: { invite: InviteDto; onRevoke: () => void }) {
  const role = parseRole(invite.role);
  return (
    <ListItem
      divider
      secondaryAction={
        <IconButton aria-label={`Revoke ${role} invite`} onClick={onRevoke}>
          <DeleteIcon />
        </IconButton>
      }
    >
      <ListItemText
        primary={<Chip size="small" label={role} />}
        secondary={`Expires ${formatDate(invite.expiresAt)}`}
      />
    </ListItem>
  );
}

/** Owner-only: create invite links and revoke pending ones. */
export function InvitesPanel({ baby }: { baby: Baby }) {
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
        Invite someone
      </Typography>
      <ErrorNotice message={error} />
      <Stack direction="row" spacing={1}>
        <TextField
          select
          label="Invite role"
          value={role}
          onChange={(e) => setRole(e.target.value as BabyRole)}
          sx={{ flex: 1 }}
        >
          {ROLES.map((r) => (
            <MenuItem key={r} value={r}>
              {r}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Expires in (days)"
          type="number"
          value={days}
          onChange={(e) => setDays(e.target.value)}
          error={!daysValid}
          helperText={daysValid ? null : '1 to 30 days.'}
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
        Create invite link
      </Button>
      <Typography variant="subtitle1" component="h3">
        Pending invites
      </Typography>
      {invites.data?.length === 0 && (
        <Typography color="text.secondary">No pending invites.</Typography>
      )}
      <List aria-label="Pending invites" disablePadding>
        {invites.data?.map((invite) => (
          <PendingInvite key={invite.id} invite={invite} onRevoke={() => void revoke(invite)} />
        ))}
      </List>
      {token && <InviteLinkDialog token={token} onClose={() => setToken(null)} />}
    </Stack>
  );
}
