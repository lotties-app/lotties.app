import { useTranslation } from 'react-i18next';
import { Box, Stack, Typography } from '@mui/material';
import { LockedNote } from '../baby/LockedNote';
import type { BabyEvent, EventType, Medication, Prescription } from '../db/models';
import { eventWhen, presentSafely } from '../day/ribbonText';
import { useEventTypeText } from '../i18n/eventTypeText';
import { SheetFrame } from '../now/ui/SheetFrame';
import { CategoryIcon } from '../ui/CategoryIcon';
import type { FedToSleep } from '../now/bottleFollowUp';
import { FUSSY_KEY } from '../now/fussyPattern';
import { AssistantOriginNote } from './AssistantOriginNote';
import { preparedMl } from './bottleAmounts';
import { BottleHistory } from './BottleHistoryList';
import { isBuiltInBottle } from './bottleSegments';
import { CryAnswerRow } from './CryAnswerRow';
import { DeleteRequestBanner } from './DeleteRequestBanner';
import { cryAnswer, isAutoDetected } from './cryDetection';
import { isMedicationType } from './formModel';

interface Props {
  event: BabyEvent;
  type: EventType | undefined;
  medications: Medication[];
  /** Prescriptions of the baby, deleted ones included (they name logged doses). */
  prescriptions?: Prescription[];
  /** Who logged it (`''` while the name is unknown). */
  author: string;
  /** A sleep that began while she was feeding (`fedToSleep`): a quiet line says so. */
  fedToSleep?: FedToSleep;
  onClose: () => void;
}

/**
 * An entry someone else logged, opened by a Caregiver (who changes only their own): the same
 * title, time and details as the Day row and the ribbon detail, its note, who gave a medication,
 * and why it cannot be changed here. Nothing in it edits.
 */
export function EventReadOnlySheet({
  event,
  type,
  medications,
  prescriptions,
  author,
  fedToSleep = null,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const names = useEventTypeText();
  const view = presentSafely(event, type, medications, names, prescriptions);
  const when = eventWhen(event, type, t, new Date());
  const typeName = type ? names.typeName(type) : '';
  const who = author || t('access.someoneElse');
  return (
    <SheetFrame
      open
      onClose={onClose}
      title={view.title}
      {...(typeName && typeName !== view.title ? { subtitle: typeName } : {})}
      leading={<CategoryIcon name={view.icon} category={view.category} size={20} />}
    >
      <Stack spacing={1.5}>
        <Box>
          <Typography sx={{ fontVariantNumeric: 'lining-nums tabular-nums' }}>
            {when.time}
            {when.duration && (
              <Box component="span" sx={{ color: 'text.secondary' }}>
                {` · ${when.duration}`}
              </Box>
            )}
          </Typography>
          {view.detail && (
            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
              {view.detail}
            </Typography>
          )}
          {isMedicationType(type) && (
            <Typography variant="body2" color="text.secondary">
              {t('access.givenBy', { name: who })}
            </Typography>
          )}
          {fedToSleep && (
            <Typography variant="body2" color="text.secondary">
              {t(`feedingAmounts.fedToSleep.${fedToSleep}`)}
            </Typography>
          )}
        </Box>
        {type?.key === FUSSY_KEY && isAutoDetected(event) && (
          <CryAnswerRow answer={cryAnswer(event)} />
        )}
        {isBuiltInBottle(type, event.payload) && event.endedAt !== event.startedAt && (
          <BottleHistory
            bottle={event}
            preparedMl={preparedMl(event.payload) ?? null}
            nowMs={Date.parse(event.startedAt)}
            editable={false}
          />
        )}
        <AssistantOriginNote event={event} />
        <DeleteRequestBanner event={event} />
        {event.notes && (
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}>
            {event.notes}
          </Typography>
        )}
        <LockedNote name={author} kind="entry" />
      </Stack>
    </SheetFrame>
  );
}
