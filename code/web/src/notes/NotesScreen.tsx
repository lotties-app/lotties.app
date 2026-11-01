import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Box, Button, Skeleton, Stack, Typography } from '@mui/material';
import { canWriteNotes } from '../baby/permissions';
import type { Baby, Note } from '../db/models';
import { useMembers } from '../now/useMembers';
import { ConfirmDialog } from '../settings/ConfirmDialog';
import { CategoryIcon } from '../ui/CategoryIcon';
import { Icon } from '../ui/Icon';
import { NoteCard } from './NoteCard';
import { NoteComposer } from './NoteComposer';
import { isOwnNote, timelineOf } from './noteModel';
import { useReadRecommendationsOnView } from '../proposals/useProposals';
import { useNoteCommands, useNotes } from './useNotes';

type Composing = Note | 'new' | null;

function EmptyNotes({
  writable,
  name,
  onAdd,
}: {
  writable: boolean;
  name: string;
  onAdd: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Box sx={{ display: 'grid', justifyItems: 'center', gap: 1.5, py: 4, textAlign: 'center' }}>
      <CategoryIcon name="note" category="health" size={32} />
      <Typography variant="h6" component="h2">
        {t('doctor.notes.emptyTitle')}
      </Typography>
      <Typography color="text.secondary">
        {t(writable ? 'doctor.notes.emptyDoctor' : 'doctor.notes.emptyFamily', { name })}
      </Typography>
      {writable && (
        <Button
          variant="contained"
          startIcon={<Icon name="add" size={20} />}
          onClick={onAdd}
          sx={{ minHeight: 48, borderRadius: '999px', px: 3 }}
        >
          {t('doctor.notes.add')}
        </Button>
      )}
    </Box>
  );
}

/**
 * The notes of one baby (docs/design/16-doctor-access.md): newest first, from the device (offline
 * first). The Doctor writes notes and edits or deletes her own; the family reads the shared ones
 * (the server never sends anyone else's private notes).
 */
export function NotesScreen({ baby }: { baby: Baby }) {
  const { t } = useTranslation();
  const notes = useNotes(baby.id);
  const members = useMembers(baby);
  const commands = useNoteCommands();
  useReadRecommendationsOnView(baby);
  const [composing, setComposing] = useState<Composing>(null);
  const [deleting, setDeleting] = useState<Note | null>(null);
  const writable = canWriteNotes(baby);
  const hasAccess = (note: Note) =>
    !members || !note.authorUserId || members.some((m) => m.userId === note.authorUserId);

  if (!notes) {
    return (
      <Stack spacing={2} role="status" aria-busy="true" aria-label={t('common.loading')}>
        <Skeleton variant="rounded" height={44} />
        <Skeleton variant="rounded" height={140} />
      </Stack>
    );
  }
  const timeline = timelineOf(notes);

  return (
    <Stack spacing={2.5}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Stack sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h4" component="h1">
            {t('doctor.notes.title')}
          </Typography>
          <Typography color="text.secondary">{baby.name}</Typography>
        </Stack>
        {writable && timeline.length > 0 && (
          <Button
            variant="contained"
            startIcon={<Icon name="add" size={20} />}
            onClick={() => setComposing('new')}
            sx={{ minHeight: 48, borderRadius: '999px' }}
          >
            {t('doctor.notes.add')}
          </Button>
        )}
      </Box>
      {!writable && (
        <Alert severity="info">{t('doctor.notes.familyNotice', { name: baby.name })}</Alert>
      )}
      {timeline.length === 0 ? (
        <EmptyNotes writable={writable} name={baby.name} onAdd={() => setComposing('new')} />
      ) : (
        <Stack component="section" aria-label={t('doctor.notes.timeline')} spacing={1.5}>
          {timeline.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              own={writable && isOwnNote(baby, note)}
              authorHasAccess={hasAccess(note)}
              onEdit={() => setComposing(note)}
              onDelete={() => setDeleting(note)}
            />
          ))}
        </Stack>
      )}
      {composing && (
        <NoteComposer
          babyId={baby.id}
          authorUserId={baby.userId ?? null}
          note={composing === 'new' ? undefined : composing}
          onClose={() => setComposing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={t('doctor.notes.deleteTitle')}
          body={t(
            deleting.visibility === 'shared'
              ? 'doctor.notes.deleteSharedBody'
              : 'doctor.notes.deleteBody',
          )}
          confirmLabel={t('doctor.notes.deleteConfirm')}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            void commands.remove(deleting.id);
            setDeleting(null);
          }}
        />
      )}
    </Stack>
  );
}
