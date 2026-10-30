import { describe, expect, it } from 'vitest';
import { boardItem } from './boardTestKit';
import {
  createBody,
  emptyForm,
  formOf,
  parseLabels,
  patchBody,
  validateForm,
} from './itemFormModel';

describe('the item form', () => {
  it('checks the API limits before sending', () => {
    expect(validateForm(emptyForm())).toEqual({
      title: 'titleRequired',
      topic: 'topicRequired',
    });
    const errors = validateForm(
      emptyForm({
        title: 'x'.repeat(201),
        topic: 'product',
        labels: 'ok, Not Ok!',
        dueDate: '24/10/2026',
        links: [{ label: 'x', url: 'javascript:alert(1)' }],
        body: 'x'.repeat(20_001),
      }),
    );
    expect(errors).toEqual({
      title: 'tooLong',
      labels: 'badLabel',
      dueDate: 'badDate',
      links: 'badLink',
      body: 'tooLong',
    });
    expect(
      validateForm(emptyForm({ title: 't', topic: 'p', labels: 'a b c d e f g h i j k' })).labels,
    ).toBe('tooManyLabels');
  });

  it('reads labels split by commas or spaces, lower case, once each', () => {
    expect(parseLabels('UI, ui  deploy,,area:web')).toEqual(['ui', 'deploy', 'area:web']);
  });

  it('creates with a client id and only the fields that are set', () => {
    const body = createBody(
      emptyForm({ title: '  Seed  ', topic: 'process-meta', labels: 'seed', pinned: true }),
      'id-1',
    );
    // Pinning is for notes and memories only, so a task never sends it.
    expect(body).toEqual({
      id: 'id-1',
      type: 'task',
      topic: 'process-meta',
      title: 'Seed',
      status: 'open',
      side: 'both',
      priority: 'normal',
      labels: ['seed'],
    });
  });

  it('patches only what changed', () => {
    const item = boardItem({ id: 'a', title: 'Old', labels: ['x'], body: 'text' });
    expect(patchBody(formOf(item), item)).toEqual({});
    const form = { ...formOf(item), title: 'New', labels: 'x, y', body: '' };
    expect(patchBody(form, item)).toEqual({ title: 'New', labels: ['x', 'y'], body: null });
  });

  it('clears the decision fields and the pin when the type moves away', () => {
    const decision = boardItem({
      id: 'd',
      title: 'D',
      type: 'decision',
      decision: { summary: 'S', rationale: 'R', decidedAt: '2026-10-01T00:00:00Z' },
    });
    expect(patchBody({ ...formOf(decision), type: 'task' }, decision)).toEqual({
      type: 'task',
      decisionSummary: null,
      rationale: null,
      decidedAt: null,
    });
    const note = boardItem({ id: 'n', title: 'N', type: 'note', pinned: true });
    expect(patchBody({ ...formOf(note), type: 'task' }, note)).toEqual({
      type: 'task',
      pinned: false,
    });
  });
});
