import { useTranslation } from 'react-i18next';
import type { EventFieldDefinition, EventType } from '../db/models';
import { catalogText } from './catalog';

/**
 * Names, field labels and option labels of the built-in event types come from the catalog
 * (`eventTypes.<typeKey>...`); anything without a translation falls back to what the server sent.
 * Types, fields and options created by users are content and are never translated.
 */
export interface EventTypeText {
  typeName: (type: Pick<EventType, 'key' | 'name' | 'babyId'>) => string;
  fieldLabel: (
    type: Pick<EventType, 'key' | 'babyId'>,
    field: Pick<EventFieldDefinition, 'key' | 'label'>,
  ) => string;
  /** Options are looked up in lower case (older data used `FORMULA`, `WET`, ...). */
  optionLabel: (
    type: Pick<EventType, 'key' | 'babyId'>,
    field: Pick<EventFieldDefinition, 'key'>,
    option: string,
  ) => string;
}

const isBuiltIn = (type: Pick<EventType, 'babyId'>) => type.babyId === null;

export const eventTypeText: EventTypeText = {
  typeName: (type) =>
    (isBuiltIn(type) ? catalogText('eventTypes', type.key, 'name') : undefined) ?? type.name,
  fieldLabel: (type, field) =>
    (isBuiltIn(type)
      ? catalogText('eventTypes', type.key, 'fields', field.key, 'label')
      : undefined) ?? field.label,
  optionLabel: (type, field, option) =>
    (isBuiltIn(type)
      ? catalogText('eventTypes', type.key, 'options', field.key, option.toLowerCase())
      : undefined) ?? option,
};

/** The catalog-backed helpers; subscribes the component to language changes. */
export function useEventTypeText(): EventTypeText {
  useTranslation();
  return eventTypeText;
}
