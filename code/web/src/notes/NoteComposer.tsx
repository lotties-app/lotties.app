import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button } from '@mui/material';
import { InvalidNoteError } from '../db/noteCommands';
import type { Note, NoteKind, NoteVisibility } from '../db/models';
import { SheetFrame } from '../now/ui/SheetFrame';
import { CategoryIcon } from '../ui/CategoryIcon';
import { ChipGroup, Field, NotesRow } from '../ui/form';
import {
  canMakePrivate,
  NOTE_BODY_MAX,
  NOTE_KINDS,
  noteTermsOf,
  type NoteTerms,
} from './noteModel';
import { useNoteCommands } from './useNotes';

interface Props {
  babyId: string;
  /** The author's server id (`Baby.userId`), stored on a new note until the server echoes it. */
  authorUserId: string | null;
  /** Omit to write a new note. */
  note?: Note;
  onClose: () => void;
}

type FormError = 'body' | 'failed';

const KIND_ICON = { note: 'note', recommendation: 'star' } as const;

/**
 * Write or edit a note (the Doctor): kind (Note, Recommendation), who sees it (Shared with the
 * parents by default, or Private: only her) and the text. A shared note stays shared, so Private is
 * offered only while it is not. Saved on the device and queued for sync.
 */
export function NoteComposer({ babyId, authorUserId, note, onClose }: Props) {
  const { t } = useTranslation();
  const commands = useNoteCommands();
  const [form, setForm] = useState<NoteTerms>(() =>
    note ? noteTermsOf(note) : { kind: 'note', visibility: 'shared', body: '' },
  );
  const [error, setError] = useState<FormError | null>(null);
  const [saving, setSaving] = useState(false);
  const privateAllowed = canMakePrivate(note);
  const change = (patch: Partial<NoteTerms>) => {
    setForm((current) => ({ ...current, ...patch }));
    setError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.body.trim()) return setError('body');
    setSaving(true);
    try {
      if (note) await commands.update(note.id, form);
      else await commands.create(babyId, authorUserId, form);
      onClose();
    } catch (e) {
      setError(e instanceof InvalidNoteError && e.code === 'body' ? 'body' : 'failed');
      setSaving(false);
    }
  };

  return (
    <SheetFrame
      open
      onClose={onClose}
      title={t(note ? 'doctor.notes.editTitle' : 'doctor.notes.newTitle')}
      leading={<CategoryIcon name={KIND_ICON[form.kind]} category="health" size={24} />}
    >
      <Box
        component="form"
        noValidate
        onSubmit={(e: FormEvent) => void submit(e)}
        sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 2.5 }}
      >
        <Field label={t('doctor.notes.kind')} group>
          <ChipGroup<NoteKind>
            value={form.kind}
            onChange={(kind) => kind && change({ kind })}
            options={NOTE_KINDS.map((kind) => ({
              value: kind,
              label: t(`doctor.notes.kinds.${kind}`),
              icon: KIND_ICON[kind],
            }))}
          />
        </Field>
        <Field
          label={t('doctor.notes.visibility')}
          group
          help={t(privateAllowed ? 'doctor.notes.visibilityHelp' : 'doctor.notes.staysShared')}
        >
          <ChipGroup<NoteVisibility>
            value={form.visibility}
            onChange={(visibility) => visibility && change({ visibility })}
            options={[
              { value: 'shared', label: t('doctor.notes.visibilities.shared'), icon: 'users' },
              {
                value: 'private',
                label: t('doctor.notes.visibilities.private'),
                icon: 'lock',
                disabled: !privateAllowed,
              },
            ]}
          />
        </Field>
        <Field
          label={t('doctor.notes.body')}
          required
          error={error === 'body' ? t('doctor.notes.bodyRequired') : undefined}
        >
          <NotesRow
            value={form.body}
            onChange={(body) => change({ body })}
            maxLength={NOTE_BODY_MAX}
            counterFrom={NOTE_BODY_MAX - 200}
            defaultOpened
          />
        </Field>
        {error === 'failed' && (
          <Box role="alert" sx={{ fontSize: '0.875rem', color: 'error.main' }}>
            {t('doctor.notes.saveFailed')}
          </Box>
        )}
        <Button
          type="submit"
          variant="contained"
          disabled={saving}
          sx={{ minHeight: 52, borderRadius: '999px' }}
        >
          {t('common.save')}
        </Button>
      </Box>
    </SheetFrame>
  );
}
