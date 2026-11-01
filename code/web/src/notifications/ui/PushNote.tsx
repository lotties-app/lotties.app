import type { ReactNode } from 'react';
import { Box } from '@mui/material';
import { Icon } from '../../ui/Icon';

/** A quiet note with an info icon, styled like the medication guardrail note. */
export function PushNote({ children }: { children: ReactNode }) {
  return (
    <Box
      role="note"
      sx={{
        display: 'flex',
        gap: 1,
        alignItems: 'flex-start',
        fontSize: '0.8125rem',
        color: 'text.secondary',
      }}
    >
      <Icon name="info" size={16} sx={{ mt: '2px', flex: 'none' }} />
      <span>{children}</span>
    </Box>
  );
}
