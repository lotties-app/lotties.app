import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Stack, Typography } from '@mui/material';
import { useDatabase } from '../db/DatabaseContext';
import type { Baby, Note } from '../db/models';
import { markNoteRead } from '../db/proposalCommands';
import { formatDateTime } from '../i18n/format';
import { SheetFrame } from '../now/ui/SheetFrame';
import { DoctorName } from '../professional/DoctorName';
import { CategoryIcon } from '../ui/CategoryIcon';

/**
 * A recommendation the doctor sent, read-only. Opening it marks it read for the person who opened
 * it (offline too: the mark is queued), so it leaves the inbox and the badge count.
 */
export function RecommendationSheet({
  baby,
  note,
  onClose,
}: {
  baby: Pick<Baby, 'id'>;
  note: Note;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const db = useDatabase();
  useEffect(() => {
    void markNoteRead(db, baby.id, note.id);
  }, [db, baby.id, note.id]);

  return (
    <SheetFrame
      open
      onClose={onClose}
      title={t('proposals.fromDoctor.recommendation')}
      subtitle={formatDateTime(note.createdAt)}
      leading={<CategoryIcon name="star" category="health" size={24} />}
    >
      <Stack spacing={1.5}>
        {note.author ? (
          <DoctorName person={note.author} variant="subtitle1" />
        ) : (
          <Typography sx={{ fontWeight: 600 }}>{t('proposals.unknownDoctor')}</Typography>
        )}
        <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {note.body}
        </Typography>
      </Stack>
    </SheetFrame>
  );
}
