import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  ButtonBase,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material';
import type { EventType } from '../db/models';
import { useEventTypeText } from '../i18n/eventTypeText';
import { typeCategory, typeIcon } from '../now/typeVisual';
import { CategoryIcon } from '../ui/CategoryIcon';
import { Icon } from '../ui/Icon';

interface Props {
  titleId: string;
  type: EventType | undefined;
  /** Replaces the type name (the "Finish this ..." title). */
  title?: string;
  subtitle: string;
  /** The types the name switches between; omit for a fixed type. */
  types?: readonly EventType[];
  onChangeType?: (type: EventType) => void;
  onClose: () => void;
  /** Adds the overflow menu with Delete. */
  onDelete?: () => void;
}

function TypeMenu({
  anchor,
  types,
  current,
  onPick,
  onClose,
}: {
  anchor: HTMLElement | null;
  types: readonly EventType[];
  current: string | undefined;
  onPick: (type: EventType) => void;
  onClose: () => void;
}) {
  const names = useEventTypeText();
  return (
    <Menu anchorEl={anchor} open={anchor !== null} onClose={onClose}>
      {types.map((candidate) => (
        <MenuItem
          key={candidate.id}
          selected={candidate.id === current}
          onClick={() => {
            onClose();
            onPick(candidate);
          }}
          sx={{ minHeight: 48, gap: 1.5 }}
        >
          <ListItemIcon sx={{ minWidth: 0 }}>
            <CategoryIcon name={typeIcon(candidate)} category={typeCategory(candidate)} size={16} />
          </ListItemIcon>
          {names.typeName(candidate)}
        </MenuItem>
      ))}
    </Menu>
  );
}

/**
 * Top of the event sheet: close (X) at the left, the category icon with the type name (a button
 * that opens the type list when the type can change) and a quiet subtitle, and the overflow menu
 * (Delete) at the right. The heading names the dialog.
 */
export function SheetHeader({
  titleId,
  type,
  title,
  subtitle,
  types,
  onChangeType,
  onClose,
  onDelete,
}: Props) {
  const { t } = useTranslation();
  const names = useEventTypeText();
  const menuId = useId();
  const [typeAnchor, setTypeAnchor] = useState<HTMLElement | null>(null);
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  const name = title ?? (type ? names.typeName(type) : t('common.event'));
  const switchable = !!types && types.length > 1 && !!onChangeType;

  const label = (
    <>
      <span>{name}</span>
      {switchable && <Icon name="expand" size={20} />}
    </>
  );
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, pt: 1, pb: 1.5 }}>
      <IconButton
        onClick={onClose}
        aria-label={t('now.sheet.close')}
        sx={{ width: 48, height: 48 }}
      >
        <Icon name="close" />
      </IconButton>
      <CategoryIcon name={typeIcon(type)} category={typeCategory(type)} />
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography id={titleId} variant="h5" component="h2" sx={{ lineHeight: 1.2 }}>
          {switchable ? (
            <ButtonBase
              aria-haspopup="menu"
              aria-expanded={typeAnchor !== null}
              title={t('events.sheet.changeType')}
              onClick={(e) => setTypeAnchor(e.currentTarget)}
              sx={{
                font: 'inherit',
                color: 'inherit',
                gap: 0.5,
                minHeight: 44,
                borderRadius: 2,
                textAlign: 'start',
                maxWidth: '100%',
                '&:focus-visible': { outline: '2px solid currentColor', outlineOffset: 2 },
              }}
            >
              {label}
            </ButtonBase>
          ) : (
            name
          )}
        </Typography>
        <Typography variant="caption" color="text.secondary" component="p">
          {subtitle}
        </Typography>
      </Box>
      {onDelete && (
        <>
          <IconButton
            onClick={(e) => setMoreAnchor(e.currentTarget)}
            aria-label={t('events.sheet.moreActions')}
            aria-haspopup="menu"
            aria-controls={moreAnchor ? menuId : undefined}
            sx={{ width: 48, height: 48 }}
          >
            <Icon name="more" />
          </IconButton>
          <Menu
            id={menuId}
            anchorEl={moreAnchor}
            open={moreAnchor !== null}
            onClose={() => setMoreAnchor(null)}
          >
            <MenuItem
              onClick={() => {
                setMoreAnchor(null);
                onDelete();
              }}
              sx={{ minHeight: 48, gap: 1.5, color: 'error.main' }}
            >
              <Icon name="delete" />
              {t('common.delete')}
            </MenuItem>
          </Menu>
        </>
      )}
      {switchable && types && onChangeType && (
        <TypeMenu
          anchor={typeAnchor}
          types={types}
          current={type?.id}
          onPick={onChangeType}
          onClose={() => setTypeAnchor(null)}
        />
      )}
    </Box>
  );
}
