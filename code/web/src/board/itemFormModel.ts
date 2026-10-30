import type {
  BoardItem,
  BoardItemCreate,
  BoardItemPatch,
  BoardLink,
  BoardPriority,
  BoardSide,
  BoardStatus,
  BoardType,
} from './boardApi';
import { LABEL_PATTERN } from './boardQuery';
import { safeHref } from './markdown';

/*
 * The item form's state, its checks (the API's limits, so most mistakes are caught before a
 * round trip) and what it sends: a create body, or a merge patch of the changed fields only.
 */

export interface ItemFormState {
  title: string;
  type: BoardType;
  topic: string;
  status: BoardStatus;
  side: BoardSide;
  priority: BoardPriority;
  /** Labels as typed: separated by commas or spaces. */
  labels: string;
  /** `yyyy-mm-dd` or empty. */
  dueDate: string;
  links: BoardLink[];
  pinned: boolean;
  decisionSummary: string;
  rationale: string;
  source: string;
  body: string;
}

export const LIMITS = {
  title: 200,
  body: 20_000,
  labels: 10,
  links: 10,
  linkLabel: 100,
  linkUrl: 2_000,
  decisionSummary: 1_000,
  rationale: 4_000,
  source: 200,
} as const;

/** Fields that can carry an error message (the API's `field` names). */
export const FORM_FIELDS = [
  'title',
  'topic',
  'labels',
  'dueDate',
  'links',
  'decisionSummary',
  'rationale',
  'source',
  'body',
] as const;
export type FormField = (typeof FORM_FIELDS)[number];

export type FormErrorCode =
  | 'titleRequired'
  | 'tooLong'
  | 'topicRequired'
  | 'tooManyLabels'
  | 'badLabel'
  | 'badDate'
  | 'tooManyLinks'
  | 'badLink';

/** Catalog keys under `board.form.errors` by field. */
export type FormErrors = Partial<Record<FormField, FormErrorCode>>;

export const canPin = (type: BoardType) => type === 'note' || type === 'memory';
export const isDecision = (type: BoardType) => type === 'decision';

export function emptyForm(defaults: Partial<ItemFormState> = {}): ItemFormState {
  return {
    title: '',
    type: 'task',
    topic: '',
    status: 'open',
    side: 'both',
    priority: 'normal',
    labels: '',
    dueDate: '',
    links: [],
    pinned: false,
    decisionSummary: '',
    rationale: '',
    source: '',
    body: '',
    ...defaults,
  };
}

export function formOf(item: BoardItem): ItemFormState {
  return {
    title: item.title,
    type: item.type,
    topic: item.topic,
    status: item.status,
    side: item.side,
    priority: item.priority,
    labels: item.labels.join(', '),
    dueDate: item.dueDate ?? '',
    links: item.links.map((link) => ({ ...link })),
    pinned: item.pinned,
    decisionSummary: item.decision?.summary ?? '',
    rationale: item.decision?.rationale ?? '',
    source: item.source ?? '',
    body: item.body ?? '',
  };
}

/** The labels of the typed text, lower case, without duplicates. */
export function parseLabels(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,\s]+/)
        .map((label) => label.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateForm(state: ItemFormState): FormErrors {
  const errors: FormErrors = {};
  const title = state.title.trim();
  if (!title) errors.title = 'titleRequired';
  else if (title.length > LIMITS.title) errors.title = 'tooLong';
  if (!state.topic) errors.topic = 'topicRequired';
  const labels = parseLabels(state.labels);
  if (labels.length > LIMITS.labels) errors.labels = 'tooManyLabels';
  else if (labels.some((label) => !LABEL_PATTERN.test(label))) errors.labels = 'badLabel';
  if (state.dueDate && !DATE.test(state.dueDate)) errors.dueDate = 'badDate';
  if (state.links.length > LIMITS.links) errors.links = 'tooManyLinks';
  else if (
    state.links.some(
      (link) =>
        !link.label.trim() ||
        link.label.trim().length > LIMITS.linkLabel ||
        link.url.trim().length > LIMITS.linkUrl ||
        !safeHref(link.url),
    )
  ) {
    errors.links = 'badLink';
  }
  if (state.body.length > LIMITS.body) errors.body = 'tooLong';
  if (state.source.trim().length > LIMITS.source) errors.source = 'tooLong';
  if (isDecision(state.type)) {
    if (state.decisionSummary.trim().length > LIMITS.decisionSummary)
      errors.decisionSummary = 'tooLong';
    if (state.rationale.trim().length > LIMITS.rationale) errors.rationale = 'tooLong';
  }
  return errors;
}

const orNull = (text: string) => (text.trim() ? text.trim() : null);
const cleanLinks = (links: readonly BoardLink[]) =>
  links.map((link) => ({ label: link.label.trim(), url: link.url.trim() }));

/** Everything the form says, as the API's fields (optional ones `null` when empty). */
function fieldsOf(state: ItemFormState) {
  const decision = isDecision(state.type);
  return {
    type: state.type,
    topic: state.topic,
    title: state.title.trim(),
    body: state.body.trim() ? state.body : null,
    status: state.status,
    side: state.side,
    priority: state.priority,
    labels: parseLabels(state.labels),
    dueDate: state.dueDate || null,
    links: cleanLinks(state.links),
    pinned: canPin(state.type) && state.pinned,
    decisionSummary: decision ? orNull(state.decisionSummary) : null,
    rationale: decision ? orNull(state.rationale) : null,
    source: orNull(state.source),
  };
}

/** The create body: a client id (a retry is idempotent) and the fields that are set. */
export function createBody(state: ItemFormState, id: string): BoardItemCreate {
  const fields = fieldsOf(state);
  const body: BoardItemCreate = {
    id,
    type: fields.type,
    topic: fields.topic,
    title: fields.title,
    status: fields.status,
    side: fields.side,
    priority: fields.priority,
  };
  if (fields.body) body.body = fields.body;
  if (fields.labels.length) body.labels = fields.labels;
  if (fields.dueDate) body.dueDate = fields.dueDate;
  if (fields.links.length) body.links = fields.links;
  if (fields.pinned) body.pinned = true;
  if (fields.decisionSummary) body.decisionSummary = fields.decisionSummary;
  if (fields.rationale) body.rationale = fields.rationale;
  if (fields.source) body.source = fields.source;
  return body;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A merge patch of what changed against the stored item. Moving away from a decision clears
 * its decision fields, and away from a note or memory its pin (the API refuses them elsewhere).
 */
export function patchBody(state: ItemFormState, item: BoardItem): BoardItemPatch {
  const next = fieldsOf(state);
  const stored = fieldsOf(formOf(item));
  const patch: BoardItemPatch = {};
  for (const key of Object.keys(next) as (keyof typeof next)[]) {
    if (!sameJson(next[key], stored[key])) {
      (patch as Record<string, unknown>)[key] = next[key];
    }
  }
  if (patch.type && !isDecision(next.type) && item.decision?.decidedAt) patch.decidedAt = null;
  return patch;
}
