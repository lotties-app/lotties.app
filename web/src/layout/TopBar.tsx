import { AppBar, Toolbar } from '@mui/material';
import { BabySwitcher } from './BabySwitcher';
import { UserMenu } from './UserMenu';

export function TopBar() {
  return (
    <AppBar position="sticky" color="primary" enableColorOnDark>
      <Toolbar>
        <BabySwitcher />
        <UserMenu />
      </Toolbar>
    </AppBar>
  );
}
