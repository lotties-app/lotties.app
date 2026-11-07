import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ButtonBase, Menu, MenuItem, Stack, Typography } from '@mui/material';
import { BabyAvatar } from '../baby/BabyAvatar';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import type { Baby } from '../db/models';
import { formatAge } from '../i18n/format';
import { Icon } from '../ui/Icon';
import { babyShownName } from '../baby/shownName';

const grow = { flexGrow: 1, minWidth: 0 };

function BabyHeading({ baby, switchable }: { baby: Baby; switchable: boolean }) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ minWidth: 0, alignItems: 'center' }}>
      <BabyAvatar id={baby.id} name={babyShownName(baby)} />
      <Stack sx={{ minWidth: 0, textAlign: 'left' }}>
        <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center' }}>
          <Typography variant="h5" component="p" noWrap>
            {babyShownName(baby)}
          </Typography>
          {switchable && <Icon name="expand" size={20} />}
        </Stack>
        <Typography variant="caption" color="text.secondary" noWrap>
          {formatAge(baby.birthDate, new Date(), undefined, baby.birthWeekOnly === true)}
        </Typography>
      </Stack>
    </Stack>
  );
}

/** Avatar, name and age line; a menu to switch babies when there is more than one. */
export function BabySwitcher() {
  const { t } = useTranslation();
  const { babies, baby, select } = useSelectedBaby();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  if (!baby) {
    return (
      <Typography variant="h5" component="p" sx={grow}>
        {t('app.name')}
      </Typography>
    );
  }
  if (!babies || babies.length < 2) {
    return (
      <Stack direction="row" sx={{ ...grow, minHeight: 44, alignItems: 'center' }}>
        <BabyHeading baby={baby} switchable={false} />
      </Stack>
    );
  }

  return (
    <>
      <ButtonBase
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-haspopup="menu"
        aria-label={t('layout.switchBaby', { name: babyShownName(baby) })}
        sx={{ ...grow, justifyContent: 'flex-start', minHeight: 44, borderRadius: 2, py: 0.5 }}
      >
        <BabyHeading baby={baby} switchable />
      </ButtonBase>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        {babies.map((b) => (
          <MenuItem
            key={b.id}
            selected={b.id === baby.id}
            sx={{ minHeight: 48, gap: 1.5 }}
            onClick={() => {
              select(b.id);
              setAnchor(null);
            }}
          >
            <BabyAvatar id={b.id} name={babyShownName(b)} size={32} />
            {babyShownName(b)}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
