import { useState } from 'react';
import {
  Alert,
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
import PersonRemoveIcon from '@mui/icons-material/PersonRemove';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { OFFLINE_MESSAGE } from '../api/errorMessages';
import { purgeBabyData } from '../db/purge';
import { changeMemberRole, leaveBaby, listMembers, removeMember } from '../api/managementApi';
import { useApiClient } from '../api/ApiClientContext';
import { isOwner } from '../baby/permissions';
import { useDatabase } from '../db/DatabaseContext';
import type { Baby, BabyRole } from '../db/models';
import { countUnsyncedMutations } from '../db/outbox';
import { UnsyncedChangesDialog } from '../session/UnsyncedChangesDialog';
import { unsyncedChangesLabel, usePushThenProceed } from '../session/usePushThenProceed';
import { parseRole, type MemberDto } from '../sync/contract';
import { useSyncEngine } from '../sync/SyncEngineContext';
import { ConfirmDialog } from './ConfirmDialog';
import { ErrorNotice } from './ErrorNotice';
import { InvitesPanel } from './InvitesPanel';
import { useServerAction } from './useServerAction';

const ROLES: BabyRole[] = ['Owner', 'Parent', 'Viewer'];

const memberName = (m: MemberDto) => m.displayName?.trim() || 'Unnamed member';

function MemberRow({
  member,
  manage,
  disabled,
  onRole,
  onRemove,
}: {
  member: MemberDto;
  manage: boolean;
  disabled: boolean;
  onRole: (role: BabyRole) => void;
  onRemove: () => void;
}) {
  const name = memberName(member);
  const role = parseRole(member.role);
  return (
    <ListItem divider sx={{ gap: 1, flexWrap: 'wrap' }}>
      <ListItemText
        primary={name}
        secondary={`Joined ${new Date(member.joinedAt).toLocaleDateString()}`}
      />
      {manage ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <TextField
            select
            size="small"
            label={`Role for ${name}`}
            value={role}
            disabled={disabled}
            onChange={(e) => onRole(e.target.value as BabyRole)}
            sx={{ minWidth: 120 }}
          >
            {ROLES.map((r) => (
              <MenuItem key={r} value={r}>
                {r}
              </MenuItem>
            ))}
          </TextField>
          <IconButton aria-label={`Remove ${name}`} disabled={disabled} onClick={onRemove}>
            <PersonRemoveIcon />
          </IconButton>
        </Stack>
      ) : (
        <Chip size="small" label={role} />
      )}
    </ListItem>
  );
}

/** Members of the baby, plus invites for the owner and a "leave" action for everyone. */
export function MembersSection({ baby }: { baby: Baby }) {
  const api = useApiClient();
  const db = useDatabase();
  const engine = useSyncEngine();
  const queryClient = useQueryClient();
  const { run, pending, error, online, clearError } = useServerAction();
  const manage = isOwner(baby);
  const [removing, setRemoving] = useState<MemberDto | null>(null);
  const [leaving, setLeaving] = useState<'confirm' | 'unsynced' | null>(null);
  const countUnsynced = () => countUnsyncedMutations(db, baby.id);
  const unsynced = useLiveQuery(countUnsynced, [db, baby.id]) ?? 0;
  const members = useQuery({
    queryKey: ['members', baby.id],
    queryFn: () => listMembers(api, baby.id),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['members', baby.id] });

  const setRole = (member: MemberDto, role: BabyRole) =>
    run(async () => {
      await changeMemberRole(api, baby.id, member.userId, role);
      await refresh();
      void engine.syncNow();
    });

  const confirmRemove = async (member: MemberDto) => {
    const ok = await run(async () => {
      await removeMember(api, baby.id, member.userId);
      await refresh();
    });
    if (ok) setRemoving(null);
  };

  const confirmLeave = async () => {
    const ok = await run(async () => {
      await leaveBaby(api, baby.id);
      await purgeBabyData(db, baby.id);
      await engine.syncNow();
    });
    if (ok) setLeaving(null);
  };
  // Leaving purges the baby's outbox: offer to push its unsynced changes first.
  const pushFirst = usePushThenProceed(countUnsynced, confirmLeave);

  const startLeave = async () => {
    setLeaving((await countUnsynced()) > 0 ? 'unsynced' : 'confirm');
  };

  const closeDialogs = () => {
    clearError();
    pushFirst.clearError();
    setRemoving(null);
    setLeaving(null);
  };
  const dialogOpen = removing !== null || leaving !== null;

  return (
    <Stack spacing={2}>
      {!online && <Alert severity="warning">{OFFLINE_MESSAGE}</Alert>}
      {!dialogOpen && <ErrorNotice message={error} />}
      {members.isError && <ErrorNotice message="Could not load members. Check your connection." />}
      <List aria-label="Members" disablePadding>
        {members.data?.map((m) => (
          <MemberRow
            key={m.userId}
            member={m}
            manage={manage}
            disabled={pending || !online}
            onRole={(role) => void setRole(m, role)}
            onRemove={() => setRemoving(m)}
          />
        ))}
      </List>
      {manage && <InvitesPanel baby={baby} />}
      {!manage && (
        <Typography color="text.secondary">
          Only the owner can manage members and invites.
        </Typography>
      )}
      <Button
        color="error"
        variant="outlined"
        disabled={!online}
        onClick={() => void startLeave()}
        sx={{ minHeight: 48, alignSelf: 'flex-start' }}
      >
        Leave this baby
      </Button>
      {removing && (
        <ConfirmDialog
          title={`Remove ${memberName(removing)}?`}
          body="They lose access to this baby immediately."
          confirmLabel="Remove member"
          pending={pending}
          error={error}
          onCancel={closeDialogs}
          onConfirm={() => void confirmRemove(removing)}
        />
      )}
      {leaving === 'unsynced' && (
        <UnsyncedChangesDialog
          title={`Leave ${baby.name}?`}
          message={`You have ${unsyncedChangesLabel(unsynced)} for ${baby.name} that will be lost.`}
          pushLabel="Push first"
          proceedLabel="Leave anyway"
          pending={pending || pushFirst.pushing}
          error={pushFirst.error ?? error}
          onPush={() => void pushFirst.pushThenProceed()}
          onProceed={() => void confirmLeave()}
          onCancel={closeDialogs}
        />
      )}
      {leaving === 'confirm' && (
        <ConfirmDialog
          title={`Leave ${baby.name}?`}
          body="You will need a new invite to follow this baby again."
          confirmLabel="Leave baby"
          pending={pending}
          error={error}
          onCancel={closeDialogs}
          onConfirm={() => void confirmLeave()}
        />
      )}
    </Stack>
  );
}
