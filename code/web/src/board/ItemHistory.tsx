import { useTranslation } from 'react-i18next';
import { Box, Typography } from '@mui/material';
import { catalogText } from '../i18n/catalog';
import { formatDateTime } from '../i18n/format';
import { palette } from '../ui/form/styles';
import { Icon } from '../ui/Icon';
import type { BoardFieldChange, BoardHistoryEvent } from './boardApi';

/** Fields whose values are codes with a catalog name (`board.<group>.<code>`). */
const CODED: Record<string, string> = {
  type: 'types',
  status: 'statuses',
  side: 'sides',
  priority: 'priorities',
};

function ChangeLine({ change }: { change: BoardFieldChange }) {
  const { t } = useTranslation();
  const name = catalogText('board', 'fields', change.field) ?? change.field;
  const group = Object.hasOwn(CODED, change.field) ? CODED[change.field] : null;
  const value = (raw: string | null) => {
    if (raw === null || raw === '') return t('board.history.empty');
    return (group && catalogText('board', group, raw)) || raw;
  };
  return (
    <li>
      {t('board.history.change', { field: name, from: value(change.from), to: value(change.to) })}
    </li>
  );
}

/** The item's immutable history, oldest first: who, when, what changed, and the comments. */
export function ItemHistory({ history }: { history: readonly BoardHistoryEvent[] }) {
  const { t } = useTranslation();
  if (history.length === 0) {
    return <Typography color="text.secondary">{t('board.history.none')}</Typography>;
  }
  return (
    <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 1.5 }}>
      {history.map((entry) => (
        <Box
          component="li"
          key={entry.id}
          sx={(theme) => ({
            pl: 1.5,
            borderInlineStart: `2px solid ${palette(theme).hairline}`,
          })}
        >
          <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
            {t(`board.history.kinds.${entry.kind}`, {
              name:
                entry.actor.kind === 'api_key'
                  ? t('board.history.keyActor', { name: entry.actor.name })
                  : entry.actor.name,
            })}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ m: 0 }}>
            <time dateTime={entry.at}>{formatDateTime(entry.at)}</time>
          </Typography>
          {entry.changes.length > 0 && (
            <Box
              component="ul"
              sx={{ m: 0, mt: 0.5, pl: 2.5, fontSize: '0.875rem', overflowWrap: 'anywhere' }}
            >
              {entry.changes.map((change, index) => (
                <ChangeLine key={`${change.field}-${index}`} change={change} />
              ))}
            </Box>
          )}
          {entry.comment && (
            <Box
              sx={(theme) => ({
                mt: 0.75,
                p: 1.25,
                display: 'flex',
                gap: 1,
                borderRadius: '12px',
                backgroundColor: palette(theme).surfaceRaised,
              })}
            >
              <Icon name="comment" size={16} sx={{ mt: '3px', color: 'text.secondary' }} />
              <Typography
                variant="body2"
                sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', minWidth: 0 }}
              >
                {entry.comment}
              </Typography>
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}
