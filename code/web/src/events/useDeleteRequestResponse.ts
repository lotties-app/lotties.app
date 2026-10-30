import { useTranslation } from 'react-i18next';
import { useDatabase } from '../db/DatabaseContext';
import { editEvent } from '../db/eventCommands';
import type { BabyEvent, EventType } from '../db/models';
import { useEventTypeText } from '../i18n/eventTypeText';
import { deleteEventWithWakeUp } from '../now/nightEndsWakeUp';
import { withoutDeleteRequest } from './assistantOrigin';
import { announceEventDeleted } from './deletedEvents';

/**
 * The two answers to an assistant's request to delete an entry: Delete is the normal soft delete
 * (with the usual Undo notice), Keep is a normal edit that removes the two request members (so the
 * client `updatedAt` conflict rule applies, like any other edit).
 */
export function useDeleteRequestResponse(typeOf: (event: BabyEvent) => EventType | undefined) {
  const db = useDatabase();
  const names = useEventTypeText();
  const { t } = useTranslation();
  return {
    approve: async (event: BabyEvent) => {
      const { deleted, wakeUp } = await deleteEventWithWakeUp(db, event.id);
      const type = typeOf(event);
      announceEventDeleted(deleted, type ? names.typeName(type) : t('common.event'), wakeUp);
    },
    keep: async (event: BabyEvent) => {
      await editEvent(db, event.id, { payload: withoutDeleteRequest(event.payload) });
    },
  };
}
