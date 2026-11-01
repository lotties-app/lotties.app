import { useState } from 'react';
import { Button, Menu, MenuItem, Typography } from '@mui/material';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import { useSelectedBaby } from '../baby/SelectedBabyContext';

const grow = { flexGrow: 1 };

export function BabySwitcher() {
  const { babies, baby, select } = useSelectedBaby();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  if (!baby) {
    return (
      <Typography variant="h6" component="p" sx={grow}>
        Baby Routine
      </Typography>
    );
  }
  if (!babies || babies.length < 2) {
    return (
      <Typography variant="h6" component="p" sx={grow}>
        {baby.name}
      </Typography>
    );
  }

  return (
    <>
      <Button
        color="inherit"
        endIcon={<ArrowDropDownIcon />}
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-haspopup="menu"
        sx={{ minHeight: 48, flexGrow: 1, justifyContent: 'flex-start' }}
      >
        {baby.name}
      </Button>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        {babies.map((b) => (
          <MenuItem
            key={b.id}
            selected={b.id === baby.id}
            sx={{ minHeight: 48 }}
            onClick={() => {
              select(b.id);
              setAnchor(null);
            }}
          >
            {b.name}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
