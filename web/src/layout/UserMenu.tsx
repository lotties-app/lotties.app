import { useState } from 'react';
import { Avatar, IconButton, ListItemIcon, Menu, MenuItem, Typography } from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import { useAuth } from '../auth/useAuth';

export function UserMenu() {
  const { user, logout } = useAuth();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const label = user?.name ?? user?.email ?? 'Account';

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
        <MenuItem sx={{ minHeight: 48 }} onClick={() => void logout()}>
          <ListItemIcon>
            <LogoutIcon fontSize="small" />
          </ListItemIcon>
          Log out
        </MenuItem>
      </Menu>
    </>
  );
}
