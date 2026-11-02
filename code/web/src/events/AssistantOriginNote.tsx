import { useTranslation } from 'react-i18next';
import { Typography } from '@mui/material';
import type { BabyEvent } from '../db/models';
import { createdVia, updatedVia } from './assistantOrigin';

const ADDED_BY = {
  alexa: 'assistants.origin.addedByAlexa',
  siri: 'assistants.origin.addedBySiri',
  android: 'assistants.origin.addedByAndroid',
  assistant: 'assistants.origin.addedByAssistant',
} as const;

const FINISHED_BY = {
  alexa: 'assistants.origin.finishedByAlexa',
  siri: 'assistants.origin.finishedBySiri',
  android: 'assistants.origin.finishedByAndroid',
  assistant: 'assistants.origin.finishedByAssistant',
} as const;

/**
 * A quiet line when an assistant made or finished the entry ("Added by Alexa", "Added by Siri", "Finished by an AI
 * assistant"); nothing for an entry made in the app. The command still ran as the linked parent.
 */
export function AssistantOriginNote({ event }: { event: Pick<BabyEvent, 'payload'> }) {
  const { t } = useTranslation();
  const created = createdVia(event);
  const updated = updatedVia(event);
  const text = created
    ? t(ADDED_BY[created])
    : updated
      ? t(FINISHED_BY[updated])
      : null;
  if (!text) return null;
  return (
    <Typography variant="caption" color="text.secondary" data-testid="assistant-origin">
      {text}
    </Typography>
  );
}
