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

const whenFormula = { visibleWhen: { field: 'bottle_feeding_type', equals: ['formula'] } };

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
    field('formula_id', 'Formula', 'text', { hidden: true, ...whenFormula }),
    field('formula_name', 'Formula name', 'text', { hidden: true, ...whenFormula }),
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

export const NASAL_SUCTION_DTO: EventTypeDto = {
  id: '4124b99c-e000-4ee0-b74a-a6579553a450',
  babyId: null,
  key: 'nasal_suction',
  name: 'Nasal suction',
  icon: 'air',
  color: '#78909c',
  hasDuration: false,
  fields: [
    field('tool', 'Tool', 'select', { options: ['bulb', 'electric', 'mouth'] }),
    field('saline', 'Saline used', 'bool'),
  ],
};

export const BELLY_MASSAGE_DTO: EventTypeDto = {
  id: '44540b60-eb87-470f-8a3e-08170a525538',
  babyId: null,
  key: 'belly_massage',
  name: 'Belly massage',
  icon: 'massage',
  color: '#ff7043',
  hasDuration: true,
  fields: [
    field('reason', 'Reason', 'select', { options: ['gas', 'constipation', 'colic', 'other'] }),
    field('helped', 'Did it help?', 'select', { options: ['yes', 'a_little', 'no'] }),
    ...PAUSE_FIELD_DTOS,
  ],
};

export const FUSSY_DTO: EventTypeDto = {
  id: '6191006e-8767-4cd8-882f-81898fad58d3',
  babyId: null,
  key: 'fussy',
  name: 'Fussy / crying',
  icon: 'sentiment_very_dissatisfied',
  color: '#81c784',
  hasDuration: true,
  fields: [
    field('intensity', 'Intensity', 'select', { options: ['mild', 'moderate', 'intense'] }),
    field('what_helped', 'What helped', 'select', {
      options: ['feeding', 'rocking', 'pacifier', 'massage', 'sleep', 'other', 'nothing'],
    }),
    ...PAUSE_FIELD_DTOS,
  ],
};

export const NAIL_TRIM_DTO: EventTypeDto = {
  id: 'bd1fde97-19c8-49a9-9ffd-537449183686',
  babyId: null,
  key: 'nail_trim',
  name: 'Nail trim',
  icon: 'content_cut',
  color: '#5c6bc0',
  hasDuration: false,
  fields: [field('where', 'Where', 'select', { options: ['hands', 'feet', 'both'] })],
};

export const TEMPERATURE_DTO: EventTypeDto = {
  id: 'c3691235-0279-429c-be1c-db6692ad5455',
  babyId: null,
  key: 'temperature',
  name: 'Temperature',
  icon: 'thermostat',
  color: '#ffca28',
  hasDuration: false,
  fields: [
    field('value_c', 'Temperature', 'number', {
      isRequired: true,
      min: 30,
      max: 45,
      unit: '°C',
      decimals: 1,
    }),
    field('method', 'Method', 'select', {
      options: ['armpit', 'ear', 'forehead', 'rectal', 'mouth'],
    }),
  ],
};

export const SPIT_UP_DTO: EventTypeDto = {
  id: '1a08d284-a71f-44f5-ae83-49446a6f0e3f',
  babyId: null,
  key: 'spit_up',
  name: 'Spit-up / vomit',
  icon: 'sentiment_sick',
  color: '#c0ca33',
  hasDuration: false,
  fields: [
    field('kind', 'Kind', 'select', { options: ['spit_up', 'vomit'] }),
    field('amount', 'Amount', 'select', { options: ['little', 'some', 'a_lot'] }),
  ],
};

export const TEETHING_DTO: EventTypeDto = {
  id: '0a3e94b0-55c5-4d85-b530-317f161ef0cc',
  babyId: null,
  key: 'teething',
  name: 'Teething',
  icon: 'dentistry',
  color: '#29b6f6',
  hasDuration: false,
  fields: [
    field('stage', 'Stage', 'select', { options: ['gums_sore', 'tooth_came_through'] }),
    field('tooth', 'Tooth', 'select', {
      options: [
        'lower_central_incisor',
        'upper_central_incisor',
        'lower_lateral_incisor',
        'upper_lateral_incisor',
        'first_molar',
        'canine',
        'second_molar',
        'other',
      ],
      visibleWhen: { field: 'stage', equals: ['tooth_came_through'] },
    }),
  ],
};

export const MILESTONE_DTO: EventTypeDto = {
  id: '3491e7b4-895b-406f-885a-238da041dd7c',
  babyId: null,
  key: 'milestone',
  name: 'Milestone',
  icon: 'emoji_events',
  color: '#ab47bc',
  hasDuration: false,
  fields: [
    field('milestone', 'Milestone', 'select', {
      options: [
        'first_smile',
        'laughs',
        'holds_head',
        'rolls_over',
        'sits',
        'crawls',
        'stands',
        'first_steps',
        'first_word',
        'other',
      ],
    }),
    field('custom', 'Which milestone?', 'text', {
      visibleWhen: { field: 'milestone', equals: ['other'] },
    }),
  ],
};

export const SYMPTOM_DTO: EventTypeDto = {
  id: 'fb45be64-6741-4762-ab9a-abf5c9e6a875',
  babyId: null,
  key: 'symptom',
  name: 'Symptom',
  icon: 'coronavirus',
  color: '#e57373',
  hasDuration: false,
  fields: [
    field('symptom', 'Symptom', 'select', {
      options: ['cough', 'runny_nose', 'congestion', 'rash', 'diarrhea', 'constipation', 'other'],
    }),
    field('severity', 'Severity', 'select', { options: ['mild', 'moderate', 'severe'] }),
  ],
};

export const OUTDOOR_DTO: EventTypeDto = {
  id: 'b22205ae-bae1-432f-802a-06e0c173efe1',
  babyId: null,
  key: 'outdoor',
  name: 'Outdoor time',
  icon: 'park',
  color: '#66bb6a',
  hasDuration: true,
  fields: [
    field('kind', 'Kind', 'select', { options: ['sun', 'stroller_walk', 'park', 'other'] }),
    ...PAUSE_FIELD_DTOS,
  ],
};

export const SKIN_CARE_DTO: EventTypeDto = {
  id: '9ad3dce5-dd4e-43d8-a022-5561ee7256ee',
  babyId: null,
  key: 'skin_care',
  name: 'Skin care',
  icon: 'sanitizer',
  color: '#f48fb1',
  hasDuration: false,
  fields: [
    field('product', 'Product', 'select', {
      options: ['moisturizer', 'diaper_cream', 'sunscreen', 'other'],
    }),
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
export const NASAL_SUCTION_TYPE: EventType = fromEventTypeDto(NASAL_SUCTION_DTO);
export const BELLY_MASSAGE_TYPE: EventType = fromEventTypeDto(BELLY_MASSAGE_DTO);
export const FUSSY_TYPE: EventType = fromEventTypeDto(FUSSY_DTO);

export const TUMMY_TIME_TYPE: EventType = fromEventTypeDto(TUMMY_TIME_DTO);

export const NAIL_TRIM_TYPE: EventType = fromEventTypeDto(NAIL_TRIM_DTO);
export const TEMPERATURE_TYPE: EventType = fromEventTypeDto(TEMPERATURE_DTO);
export const SPIT_UP_TYPE: EventType = fromEventTypeDto(SPIT_UP_DTO);
export const TEETHING_TYPE: EventType = fromEventTypeDto(TEETHING_DTO);
export const MILESTONE_TYPE: EventType = fromEventTypeDto(MILESTONE_DTO);
export const SYMPTOM_TYPE: EventType = fromEventTypeDto(SYMPTOM_DTO);
export const OUTDOOR_TYPE: EventType = fromEventTypeDto(OUTDOOR_DTO);
export const SKIN_CARE_TYPE: EventType = fromEventTypeDto(SKIN_CARE_DTO);

/** The eight built-in types added with the `MoreEventTypes` migration. */
export const MORE_BUILT_IN_TYPES: readonly EventType[] = [
  NAIL_TRIM_TYPE,
  TEMPERATURE_TYPE,
  SPIT_UP_TYPE,
  TEETHING_TYPE,
  MILESTONE_TYPE,
  SYMPTOM_TYPE,
  OUTDOOR_TYPE,
  SKIN_CARE_TYPE,
];
