import { Stack } from '@mui/material';
import { BabySwitcher } from './BabySwitcher';
import { SyncIconButton } from './SyncIconButton';
import { UserMenu } from './UserMenu';

/** Transparent header over the page background (docs/DESIGN.md section 2). */
export function TopBar() {
  return (
    <Stack
      component="header"
      direction="row"
      spacing={0.5}
      sx={{ alignItems: 'center', px: 2, pt: 'calc(env(safe-area-inset-top) + 8px)', pb: 1 }}
    >
      <BabySwitcher />
      <SyncIconButton />
      <UserMenu />
    </Stack>
  );
}
