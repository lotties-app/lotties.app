import { useTranslation } from 'react-i18next';
import { Box, Chip, IconButton, Paper, Stack, Typography } from '@mui/material';
import type { Note } from '../db/models';
import { formatDateTime } from '../i18n/format';
import { DoctorName } from '../professional/DoctorName';
import { RADIUS } from '../theme/tokens';
import { Icon } from '../ui/Icon';

interface Props {
  note: Note;
  /** The user wrote it: show "You" and the edit and delete buttons. */
  own: boolean;
  /** `false` once the author was removed from the baby (her notes stay). */
  authorHasAccess: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

function AuthorLine({ note, own, authorHasAccess }: Omit<Props, 'onEdit' | 'onDelete'>) {
  const { t } = useTranslation();
  if (own) {
    return (
      <Typography variant="subtitle2" component="span" sx={{ fontWeight: 600 }}>
        {t('doctor.notes.byYou')}
      </Typography>
    );
  }
  if (!note.author) {
    return (
      <Typography variant="subtitle2" component="span">
        {t('doctor.notes.unknownAuthor')}
      </Typography>
    );
  }
  return <DoctorName person={note.author} hasAccess={authorHasAccess} />;
}

/**
 * One note on the timeline: who wrote it (with the self-declared badge), when, its kind and who
 * sees it, then the text. The author edits and deletes; everyone else reads.
 */
export function NoteCard({ note, own, authorHasAccess, onEdit, onDelete }: Props) {
  const { t } = useTranslation();
  const when = formatDateTime(note.createdAt);
  return (
    <Paper
      component="article"
      aria-label={t('doctor.notes.cardLabel', { date: when })}
      sx={{ borderRadius: `${RADIUS.card}px`, p: 2 }}
    >
      <Stack spacing={1.25}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
          <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
            <AuthorLine note={note} own={own} authorHasAccess={authorHasAccess} />
            <Typography variant="caption" color="text.secondary">
              {when}
            </Typography>
          </Stack>
          {own && (
            <Stack direction="row">
              <IconButton aria-label={t('doctor.notes.edit', { date: when })} onClick={onEdit}>
                <Icon name="edit" />
              </IconButton>
              <IconButton aria-label={t('doctor.notes.delete', { date: when })} onClick={onDelete}>
                <Icon name="delete" />
              </IconButton>
            </Stack>
          )}
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          <Chip
            size="small"
            icon={<Icon name={note.kind === 'recommendation' ? 'star' : 'note'} size={16} />}
            label={t(`doctor.notes.kinds.${note.kind}`)}
          />
          <Chip
            size="small"
            variant="outlined"
            icon={<Icon name={note.visibility === 'shared' ? 'users' : 'lock'} size={16} />}
            label={t(`doctor.notes.visibilityChip.${note.visibility}`)}
          />
        </Stack>
        <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {note.body}
        </Typography>
      </Stack>
    </Paper>
  );
}
