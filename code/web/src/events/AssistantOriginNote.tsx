import { useTranslation } from 'react-i18next';
import { Typography } from '@mui/material';
import type { BabyEvent } from '../db/models';
import { createdVia, updatedVia } from './assistantOrigin';

/**
 * A quiet line when an assistant made or finished the entry ("Added by Alexa", "Finished by an AI
 * assistant"); nothing for an entry made in the app. The command still ran as the linked parent.
 */
export function AssistantOriginNote({ event }: { event: Pick<BabyEvent, 'payload'> }) {
  const { t } = useTranslation();
  const created = createdVia(event);
  const updated = updatedVia(event);
  const text = created
    ? t(
        created === 'alexa'
          ? 'assistants.origin.addedByAlexa'
          : 'assistants.origin.addedByAssistant',
      )
    : updated
      ? t(
          updated === 'alexa'
            ? 'assistants.origin.finishedByAlexa'
            : 'assistants.origin.finishedByAssistant',
        )
      : null;
  if (!text) return null;
  return (
    <Typography variant="caption" color="text.secondary" data-testid="assistant-origin">
      {text}
    </Typography>
  );
}
