import { Stack } from '@mui/material';
import type { Baby } from '../db/models';
import { CatchUpButton } from '../now/ui/CatchUpButton';
import { RunningTimerPill } from '../timers/RunningTimerPill';
import { BabySwitcher } from './BabySwitcher';
import { SyncIconButton } from './SyncIconButton';
import { UserMenu } from './UserMenu';

/**
 * Transparent header over the page background (docs/DESIGN.md section 2). The live running-timer
 * pill sits between the baby and the sync icon while a timer runs (it takes no page space); the
 * "Since you last looked" button sits before the avatar while the Now screen has a catch-up.
 */
export function TopBar({ baby }: { baby?: Baby }) {
  return (
    <Stack
      component="header"
      direction="row"
      spacing={0.5}
      sx={{ alignItems: 'center', px: 2, pt: 'calc(env(safe-area-inset-top) + 8px)', pb: 1 }}
    >
      <BabySwitcher />
      {baby && <RunningTimerPill key={baby.id} baby={baby} />}
      <SyncIconButton />
      {baby && <CatchUpButton babyId={baby.id} />}
      <UserMenu />
    </Stack>
  );
}
