import { use, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Avatar,
  Divider,
  IconButton,
  ListItemIcon,
  ListSubheader,
  Menu,
  MenuItem,
  Switch,
  Typography,
} from '@mui/material';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '../auth/useAuth';
import { SelectedBabyContext } from '../baby/SelectedBabyContext';
import { useDatabase } from '../db/DatabaseContext';
import { useBabies } from '../db/hooks';
import { hasBothModes } from '../doctor/appMode';
import { writeAppMode, type AppMode } from '../doctor/dashboardStorage';
import { countUnsyncedMutations } from '../db/outbox';
import { UnsyncedChangesDialog } from '../session/UnsyncedChangesDialog';
import { unsyncedChangesLabel, usePushThenProceed } from '../session/usePushThenProceed';
import { useSignOut } from '../session/useSignOut';
import { useNightFeed } from '../theme/NightFeedContext';
import { Icon } from '../ui/Icon';

/** The two apps of a user who is both a parent and a doctor. */
const APP_MODES: readonly AppMode[] = ['babies', 'patients'];

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
  const { t } = useTranslation();
  const { user } = useAuth();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const logout = useLogoutFlow();
  const nightFeed = useNightFeed();
  // The selected baby, when the menu sits inside the shell (the baby profile entry needs one).
  const baby = use(SelectedBabyContext)?.baby;
  const label = user?.name ?? user?.email ?? t('common.account');
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // Inside the doctor's dashboard: its own Settings, no baby profile or night view.
  const doctorMode = pathname === '/doctor' || pathname.startsWith('/doctor/');
  const bothModes = hasBothModes(useBabies());
  const settingsPath = doctorMode ? '/doctor/settings' : '/settings';

  const startLogout = () => {
    setAnchor(null);
    void logout.start();
  };
  const switchMode = (mode: AppMode) => {
    setAnchor(null);
    writeAppMode(mode);
    navigate(mode === 'patients' ? '/doctor' : '/');
  };

  return (
    <>
      <IconButton
        aria-label={t('layout.userMenu')}
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
        {bothModes && <Divider />}
        {bothModes && (
          <ListSubheader sx={{ lineHeight: '32px', bgcolor: 'transparent' }}>
            {t('doctorDashboard.mode.label')}
          </ListSubheader>
        )}
        {bothModes &&
          APP_MODES.map((mode) => {
            const current = (mode === 'patients') === doctorMode;
            return (
              <MenuItem
                key={mode}
                role="menuitemradio"
                aria-checked={current}
                selected={current}
                sx={{ minHeight: 48 }}
                onClick={() => switchMode(mode)}
              >
                <ListItemIcon>
                  <Icon name={mode === 'patients' ? 'stethoscope' : 'mood-kid'} size={20} />
                </ListItemIcon>
                {t(`doctorDashboard.mode.${mode}`)}
                {current && <Icon name="check" size={20} sx={{ ml: 'auto' }} />}
              </MenuItem>
            );
          })}
        {bothModes && <Divider />}
        {baby && !doctorMode && (
          <MenuItem
            component={Link}
            to="/settings#baby"
            sx={{ minHeight: 48 }}
            onClick={() => setAnchor(null)}
          >
            <ListItemIcon>
              <Icon name="mood-kid" size={20} />
            </ListItemIcon>
            {t('layout.babyProfile')}
          </MenuItem>
        )}
        <MenuItem
          component={Link}
          to={settingsPath}
          sx={{ minHeight: 48 }}
          onClick={() => setAnchor(null)}
        >
          <ListItemIcon>
            <Icon name="settings" size={20} />
          </ListItemIcon>
          {t('layout.settings')}
        </MenuItem>
        <MenuItem
          component={Link}
          to={`${settingsPath}#appearance`}
          sx={{ minHeight: 48 }}
          onClick={() => setAnchor(null)}
        >
          <ListItemIcon>
            <Icon name="sun" size={20} />
          </ListItemIcon>
          {t('layout.appearanceLanguage')}
        </MenuItem>
        {doctorMode && (
          <MenuItem
            component={Link}
            to="/doctor/credits"
            sx={{ minHeight: 48 }}
            onClick={() => setAnchor(null)}
          >
            <ListItemIcon>
              <Icon name="heart" size={20} />
            </ListItemIcon>
            {t('credits.title')}
          </MenuItem>
        )}
        {!doctorMode && (
          <MenuItem
            sx={{ minHeight: 48 }}
            role="menuitemcheckbox"
            aria-checked={nightFeed.active}
            onClick={nightFeed.toggle}
          >
            <ListItemIcon>
              <Icon name="night-mode" size={20} />
            </ListItemIcon>
            {t('layout.nightView')}
            <Switch
              edge="end"
              size="small"
              checked={nightFeed.active}
              tabIndex={-1}
              slotProps={{ input: { 'aria-hidden': true, tabIndex: -1, disabled: true } }}
              sx={{ ml: 'auto', pointerEvents: 'none' }}
            />
          </MenuItem>
        )}
        <MenuItem sx={{ minHeight: 48 }} onClick={startLogout}>
          <ListItemIcon>
            <Icon name="logout" size={20} />
          </ListItemIcon>
          {t('layout.logout')}
        </MenuItem>
      </Menu>
      {logout.confirming && (
        <UnsyncedChangesDialog
          title={t('layout.logoutTitle')}
          message={t('layout.logoutMessage', { changes: unsyncedChangesLabel(logout.unsynced) })}
          pushLabel={t('layout.pushNow')}
          proceedLabel={t('layout.logoutAnyway')}
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
