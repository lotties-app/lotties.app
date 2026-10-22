import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
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
import { useLiveQuery } from 'dexie-react-hooks';
import { purgeBabyData } from '../db/purge';
import { changeMemberRole, leaveBaby, listMembers, removeMember } from '../api/managementApi';
import { useApiClient } from '../api/ApiClientContext';
import { isOwner } from '../baby/permissions';
import { useDatabase } from '../db/DatabaseContext';
import type { Baby, BabyRole } from '../db/models';
import { formatDate } from '../i18n/format';
import { t as translate } from '../i18n/i18n';
import { countUnsyncedMutations } from '../db/outbox';
import { UnsyncedChangesDialog } from '../session/UnsyncedChangesDialog';
import { unsyncedChangesLabel, usePushThenProceed } from '../session/usePushThenProceed';
import { parseRole, type MemberDto } from '../sync/contract';
import { useSyncEngine } from '../sync/SyncEngineContext';
import { ConfirmDialog } from './ConfirmDialog';
import { ErrorNotice } from './ErrorNotice';
import { InvitesPanel } from './InvitesPanel';
import { AccessLogPanel } from './AccessLogPanel';
import { DoctorName } from '../professional/DoctorName';
import { fromProfessionalDto } from '../sync/contract';
import { roleOptions, selectRoleProps } from './roleOptions';
import { useServerAction } from './useServerAction';
import { Icon } from '../ui/Icon';

const ROLES: BabyRole[] = ['Owner', 'Parent', 'Caregiver', 'Viewer'];

const memberName = (m: MemberDto) => m.displayName?.trim() || translate('settings.members.unnamed');

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
  const { t } = useTranslation();
  const name = memberName(member);
  const role = parseRole(member.role);
  const professional = role === 'Doctor' ? fromProfessionalDto(member.professional) : null;
  return (
    <ListItem divider sx={{ gap: 1, flexWrap: 'wrap' }}>
      <ListItemText
        disableTypography={!!professional}
        primary={
          professional ? (
            <DoctorName person={{ displayName: name, professional }} variant="body2" />
          ) : (
            name
          )
        }
        secondary={
          professional ? (
            <Typography variant="body2" color="text.secondary" component="p">
              {t('settings.members.joined', { date: formatDate(member.joinedAt) })}
            </Typography>
          ) : (
            t('settings.members.joined', { date: formatDate(member.joinedAt) })
          )
        }
      />
      {manage && role === 'Doctor' ? (
        // Doctor access comes with an invite (it needs her professional profile) and ends by
        // removing her: no role picker.
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Chip size="small" label={t('baby.roles.Doctor')} />
          <IconButton
            aria-label={t('settings.members.removeNamed', { name })}
            disabled={disabled}
            onClick={onRemove}
          >
            <Icon name="person-remove" />
          </IconButton>
        </Stack>
      ) : manage ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <TextField
            select
            size="small"
            label={t('settings.members.roleFor', { name })}
            value={role}
            disabled={disabled}
            onChange={(e) => onRole(e.target.value as BabyRole)}
            slotProps={{ select: selectRoleProps(t) }}
            sx={{ minWidth: 120 }}
          >
            {roleOptions(ROLES, t)}
          </TextField>
          <IconButton
            aria-label={t('settings.members.removeNamed', { name })}
            disabled={disabled}
            onClick={onRemove}
          >
            <Icon name="person-remove" />
          </IconButton>
        </Stack>
      ) : (
        <Chip size="small" label={t(`baby.roles.${role}`)} />
      )}
    </ListItem>
  );
}

/** Members of the baby, plus invites for the owner and a "leave" action for everyone. */
export function MembersSection({ baby }: { baby: Baby }) {
  const { t } = useTranslation();
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
      {!online && <Alert severity="warning">{t('errors.offline')}</Alert>}
      {!dialogOpen && <ErrorNotice message={error} />}
      {members.isError && <ErrorNotice message={t('settings.members.loadFailed')} />}
      <List aria-label={t('settings.members.list')} disablePadding>
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
      {manage && <AccessLogPanel baby={baby} />}
      {!manage && <Typography color="text.secondary">{t('settings.members.ownerOnly')}</Typography>}
      <Button
        color="error"
        variant="outlined"
        disabled={!online}
        onClick={() => void startLeave()}
        sx={{ minHeight: 48, alignSelf: 'flex-start' }}
      >
        {t('settings.members.leave')}
      </Button>
      {removing && (
        <ConfirmDialog
          title={t('settings.members.removeTitle', { name: memberName(removing) })}
          body={t(
            parseRole(removing.role) === 'Doctor'
              ? 'doctor.members.removeBody'
              : 'settings.members.removeBody',
            { baby: baby.name },
          )}
          confirmLabel={t('settings.members.removeConfirm')}
          pending={pending}
          error={error}
          onCancel={closeDialogs}
          onConfirm={() => void confirmRemove(removing)}
        />
      )}
      {leaving === 'unsynced' && (
        <UnsyncedChangesDialog
          title={t('settings.members.leaveTitle', { name: baby.name })}
          message={t('settings.members.leaveUnsynced', {
            changes: unsyncedChangesLabel(unsynced),
            name: baby.name,
          })}
          pushLabel={t('settings.members.pushFirst')}
          proceedLabel={t('settings.members.leaveAnyway')}
          pending={pending || pushFirst.pushing}
          error={pushFirst.error ?? error}
          onPush={() => void pushFirst.pushThenProceed()}
          onProceed={() => void confirmLeave()}
          onCancel={closeDialogs}
        />
      )}
      {leaving === 'confirm' && (
        <ConfirmDialog
          title={t('settings.members.leaveTitle', { name: baby.name })}
          body={t('settings.members.leaveBody')}
          confirmLabel={t('settings.members.leaveConfirm')}
          pending={pending}
          error={error}
          onCancel={closeDialogs}
          onConfirm={() => void confirmLeave()}
        />
      )}
    </Stack>
  );
}
