import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { Box, ButtonBase, Chip, Typography } from '@mui/material';
import { formatDate, formatRelative } from '../i18n/format';
import { visuallyHidden } from '../insights/charts/chartStyle';
import { palette } from '../ui/form/styles';
import { Icon } from '../ui/Icon';
import type { BoardItemSummary } from './boardApi';
import { LOUD_PRIORITIES, STATUS_COLORS, TYPE_ICONS, todayUtc } from './boardLook';
import { useBoardLinks } from './useBoardLinks';

interface Props {
  item: BoardItemSummary;
  /** The item open in the drawer. */
  selected: boolean;
  /** Leave out the side chip (the view is a side already). */
  hideSide?: boolean;
  now: number;
}

/**
 * One item as a compact row, a link to its drawer: the type icon, the title, then status, side,
 * priority, due date and the last update. Wraps on narrow screens; the whole row is the target.
 */
export function ItemRow({ item, selected, hideSide = false, now }: Props) {
  const { t } = useTranslation();
  const links = useBoardLinks();
  const closed = item.status === 'done' || item.status === 'dropped';
  const overdue = !!item.dueDate && !closed && item.dueDate < todayUtc(now);
  return (
    <Box component="li" sx={{ listStyle: 'none' }}>
      <ButtonBase
        component={RouterLink}
        to={links.item(item.id)}
        data-board-row={item.id}
        aria-current={selected ? 'true' : undefined}
        sx={(theme) => ({
          width: '100%',
          minHeight: 56,
          px: 1.5,
          py: 1,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 1.25,
          textAlign: 'start',
          borderRadius: '12px',
          backgroundColor: selected ? palette(theme).surfaceRaised : 'transparent',
          '&:hover': { backgroundColor: palette(theme).surfaceRaised },
          '&:focus-visible': {
            outline: `2px solid ${palette(theme).primary.main}`,
            outlineOffset: -2,
          },
        })}
      >
        <Box sx={{ pt: '2px', color: 'text.secondary', display: 'flex' }}>
          <Icon name={TYPE_ICONS[item.type]} size={20} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            component="span"
            sx={{
              display: 'block',
              fontWeight: 600,
              overflowWrap: 'anywhere',
              textDecoration: item.deletedAt ? 'line-through' : undefined,
            }}
          >
            <Box component="span" sx={visuallyHidden}>
              {`${t(`board.types.${item.type}`)}: `}
            </Box>
            {item.title}
          </Typography>
          <Box
            component="span"
            sx={{
              mt: 0.5,
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 0.75,
              color: 'text.secondary',
              fontSize: '0.8125rem',
            }}
          >
            <Chip
              component="span"
              size="small"
              color={STATUS_COLORS[item.status]}
              variant={item.status === 'open' ? 'outlined' : 'filled'}
              label={t(`board.statuses.${item.status}`)}
            />
            {!hideSide && (
              <Chip
                component="span"
                size="small"
                variant="outlined"
                icon={<Icon name={item.side === 'assistant' ? 'board' : 'users'} size={16} />}
                label={t(`board.sides.${item.side}`)}
              />
            )}
            {LOUD_PRIORITIES.includes(item.priority) && (
              <Box
                component="span"
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.25,
                  fontWeight: 600,
                  color: item.priority === 'urgent' ? 'error.main' : 'warning.main',
                }}
              >
                <Icon name="flag" size={16} />
                {t(`board.priorities.${item.priority}`)}
              </Box>
            )}
            {item.dueDate && (
              <Box
                component="span"
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.25,
                  color: overdue ? 'error.main' : undefined,
                  fontWeight: overdue ? 600 : undefined,
                }}
              >
                <Icon name="calendar" size={16} />
                {overdue
                  ? t('board.row.overdue', { date: formatDate(item.dueDate, 'dayMonth') })
                  : t('board.row.due', { date: formatDate(item.dueDate, 'dayMonth') })}
              </Box>
            )}
            {item.pinned && (
              <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center' }}>
                <Icon name="pin" size={16} label={t('board.row.pinned')} />
              </Box>
            )}
            {item.deletedAt && (
              <Chip component="span" size="small" color="error" label={t('board.row.deleted')} />
            )}
            <span>
              {t('board.row.updated', { when: formatRelative(Date.parse(item.updatedAt), now) })}
            </span>
          </Box>
        </Box>
      </ButtonBase>
    </Box>
  );
}
