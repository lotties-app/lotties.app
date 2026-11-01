import { useState } from 'react';
import { Avatar, IconButton, ListItemIcon, Menu, MenuItem, Typography } from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '../auth/useAuth';
import { useDatabase } from '../db/DatabaseContext';
import { countUnsyncedMutations } from '../db/outbox';
import { UnsyncedChangesDialog } from '../session/UnsyncedChangesDialog';
import { unsyncedChangesLabel, usePushThenProceed } from '../session/usePushThenProceed';
import { useSignOut } from '../session/useSignOut';

/** Log out: warns first when the outbox still holds changes, which signing out deletes. */
function useLogoutFlow() {
  const db = useDatabase();
  const { signOut, countUnsynced } = useSignOut();
  const unsynced = useLiveQuery(() => countUnsyncedMutations(db), [db]) ?? 0;
  const [confirming, setConfirming] = useState(false);
  const push = usePushThenProceed(countUnsynced, signOut);

  const start = async () => {
    if ((await countUnsynced()) > 0) setConfirming(true);
    else await signOut();
  };
  const cancel = () => {
    push.clearError();
    setConfirming(false);
  };
  return { unsynced, confirming, start, cancel, signOut, push };
}

export function UserMenu() {
  const { user } = useAuth();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const logout = useLogoutFlow();
  const label = user?.name ?? user?.email ?? 'Account';

  const startLogout = () => {
    setAnchor(null);
    void logout.start();
  };

  return (
    <>
      <IconButton
        aria-label="User menu"
        onClick={(e) => setAnchor(e.currentTarget)}
        color="inherit"
      >
        <Avatar src={user?.picture} alt="" sx={{ width: 32, height: 32 }}>
          {label.charAt(0).toUpperCase()}
        </Avatar>
      </IconButton>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        <MenuItem disabled>
          <Typography variant="body2">{label}</Typography>
        </MenuItem>
        <MenuItem sx={{ minHeight: 48 }} onClick={startLogout}>
          <ListItemIcon>
            <LogoutIcon fontSize="small" />
          </ListItemIcon>
          Log out
        </MenuItem>
      </Menu>
      {logout.confirming && (
        <UnsyncedChangesDialog
          title="Log out?"
          message={`You have ${unsyncedChangesLabel(logout.unsynced)} that will be lost.`}
          pushLabel="Push now"
          proceedLabel="Logout anyway"
          pending={logout.push.pushing}
          error={logout.push.error}
          onPush={() => void logout.push.pushThenProceed()}
          onProceed={() => void logout.signOut()}
          onCancel={logout.cancel}
        />
      )}
    </>
  );
}
