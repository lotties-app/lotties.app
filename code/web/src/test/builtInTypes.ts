import type { EventType } from '../db/models';
import {
  fromEventTypeDto,
  type EventFieldDefinitionDto,
  type EventTypeDto,
} from '../sync/contract';

/*
 * Built-in event types exactly as `GET /babies/{id}/event-types` serves them (copied from
 * code/api/src/Lotties.Domain/EventTypes/BuiltInEventTypes.cs and docs/SPEC.md), mapped through the
 * real DTO mapper. Ids are the API's stable built-in ids.
 */

const field = (
  key: string,
  label: string,
  kind: string,
  extra: Partial<EventFieldDefinitionDto> = {},
): EventFieldDefinitionDto => ({
  key,
  label,
  kind,
  isRequired: false,
  options: null,
  min: null,
  max: null,
  unit: null,
  visibleWhen: null,
  ...extra,
});

/** The reserved pause keys as the built-in timed types declare them (hidden from forms). */
export const PAUSE_FIELD_DTOS: EventFieldDefinitionDto[] = [
  field('pause_count', 'Pauses', 'number', { min: 0, max: 100, hidden: true, integer: true }),
  field('paused_seconds', 'Paused time', 'number', {
    min: 0,
    max: 86_400,
    unit: 's',
    hidden: true,
    integer: true,
  }),
  field('paused_at', 'Paused since', 'text', { hidden: true }),
];

const whenKindIs = (...kinds: string[]) => ({ visibleWhen: { field: 'kind', equals: kinds } });

const whenMethodIs = (method: string) => ({ visibleWhen: { field: 'method', equals: [method] } });

export const FEEDING_DTO: EventTypeDto = {
  id: 'e6428ccb-7061-4cf4-a5d0-67c89a396a5f',
  babyId: null,
  key: 'feeding',
  name: 'Feeding',
  icon: 'local_drink',
  color: '#4f8ef7',
  hasDuration: true,
  fields: [
    field('method', 'Method', 'select', {
      isRequired: true,
      options: ['breast', 'bottle', 'solid'],
    }),
    field('side', 'Side', 'select', {
      options: ['left', 'right', 'both'],
      ...whenMethodIs('breast'),
    }),
    field('amount_ml', 'Amount', 'number', { min: 0, unit: 'ml', ...whenMethodIs('bottle') }),
    field('bottle_feeding_type', 'Bottle content', 'select', {
      options: ['formula', 'breast_milk'],
      ...whenMethodIs('bottle'),
    }),
    field('breast_left_seconds', 'Left breast', 'number', {
      min: 0,
      unit: 's',
      ...whenMethodIs('breast'),
    }),
    field('breast_right_seconds', 'Right breast', 'number', {
      min: 0,
      unit: 's',
      ...whenMethodIs('breast'),
    }),
    field('food', 'Food', 'text', whenMethodIs('solid')),
    ...PAUSE_FIELD_DTOS,
  ],
};

export const SLEEP_DTO: EventTypeDto = {
  id: '5cbe3692-d4df-4d5f-85d6-2282d9733b35',
  babyId: null,
  key: 'sleep',
  name: 'Sleep',
  icon: 'bedtime',
  color: '#7e57c2',
  hasDuration: true,
  fields: [
    field('kind', 'Kind', 'select', {
      options: ['nap', 'night', 'night_waking', 'bed_time', 'woke_up', 'fell_asleep'],
    }),
    field('mood', 'Mood', 'text', { hidden: true }),
    field('how_slept', 'How slept', 'select', {
      options: [
        'in_bed',
        'nursing',
        'held',
        'next_to_me',
        'bottle',
        'stroller',
        'car',
        'swing',
        'other',
      ],
      ...whenKindIs('nap', 'night'),
    }),
    field('fall_asleep', 'Fall asleep', 'select', {
      options: ['easy', 'took_long', 'fussy'],
      ...whenKindIs('nap', 'night'),
    }),
    field('time_to_fall_asleep_minutes', 'Time to fall asleep', 'number', {
      min: 0,
      max: 240,
      unit: 'min',
      integer: true,
      ...whenKindIs('nap', 'night'),
    }),
    field('how_woke', 'How woke', 'select', {
      options: ['naturally', 'woken'],
      ...whenKindIs('nap', 'night'),
    }),
    field('mood_on_wake', 'Mood on wake', 'select', {
      options: ['good', 'neutral', 'bad'],
      ...whenKindIs('nap', 'night'),
    }),
    ...PAUSE_FIELD_DTOS,
  ],
};

export const DIAPER_DTO: EventTypeDto = {
  id: '318d1395-e373-4d89-a3cd-cdd7ad5187ab',
  babyId: null,
  key: 'diaper',
  name: 'Diaper',
  icon: 'baby_changing_station',
  color: '#8d6e63',
  hasDuration: false,
  fields: [
    field('content', 'Content', 'select', { isRequired: true, options: ['WET', 'DIRTY', 'MIXED'] }),
  ],
};

export const BREAST_PUMP_DTO: EventTypeDto = {
  id: 'ddfdaa52-57ee-4d34-8129-a78262c2172c',
  babyId: null,
  key: 'breast_pump',
  name: 'Breast pump',
  icon: 'opacity',
  color: '#26c6da',
  hasDuration: true,
  fields: [
    field('amount_left_ml', 'Left amount', 'number', { min: 0, unit: 'ml' }),
    field('amount_right_ml', 'Right amount', 'number', { min: 0, unit: 'ml' }),
    ...PAUSE_FIELD_DTOS,
  ],
};

export const TUMMY_TIME_DTO: EventTypeDto = {
  id: 'a2b6f1c4-5a0e-4a62-9e0d-0b8c3d1c7e11',
  babyId: null,
  key: 'tummy_time',
  name: 'Tummy time',
  icon: 'child_care',
  color: '#66bb6a',
  hasDuration: true,
  fields: [field('mood', 'Mood', 'text'), ...PAUSE_FIELD_DTOS],
};

export const FEEDING_TYPE: EventType = fromEventTypeDto(FEEDING_DTO);
export const SLEEP_TYPE: EventType = fromEventTypeDto(SLEEP_DTO);
export const DIAPER_TYPE: EventType = fromEventTypeDto(DIAPER_DTO);
export const BREAST_PUMP_TYPE: EventType = fromEventTypeDto(BREAST_PUMP_DTO);

export const TUMMY_TIME_TYPE: EventType = fromEventTypeDto(TUMMY_TIME_DTO);
