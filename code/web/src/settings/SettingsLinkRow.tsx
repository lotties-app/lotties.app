import { Link as RouterLink } from 'react-router-dom';
import { ButtonBase, Paper, Typography } from '@mui/material';
import { RADIUS } from '../theme/tokens';
import { Icon } from '../ui/Icon';

interface Props {
  to: string;
  title: string;
}

/**
 * A settings entry that opens a page of its own (instead of expanding in place): the same surface
 * and title size as the collapsible groups, with a chevron pointing away.
 */
export function SettingsLinkRow({ to, title }: Props) {
  return (
    <Paper sx={{ borderRadius: `${RADIUS.card}px`, overflow: 'hidden' }}>
      <ButtonBase
        component={RouterLink}
        to={to}
        sx={{
          width: '100%',
          minHeight: 56,
          px: 2,
          display: 'flex',
          justifyContent: 'space-between',
          gap: 1,
          textAlign: 'start',
        }}
      >
        <Typography variant="h6" component="span">
          {title}
        </Typography>
        <Icon name="chevron-right" />
      </ButtonBase>
    </Paper>
  );
}
