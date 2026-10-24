import { describe, expect, it } from 'vitest';
import { listQueryString } from './boardApi';
import {
  DEFAULT_FILTERS,
  isShortcutActive,
  listQuery,
  parseFilters,
  quickAddDefaults,
  shortcutFilters,
  writeFilters,
  type BoardFilters,
} from './boardQuery';
import { boardTopics } from './boardTestKit';

const params = (query: string) => new URLSearchParams(query);
const query = (filters: Partial<BoardFilters>, admin = false) =>
  listQueryString(listQuery({ ...DEFAULT_FILTERS, ...filters }, admin));

describe('the URL state', () => {
  it('defaults to the Topics view with done and dropped hidden', () => {
    expect(parseFilters(params(''))).toEqual(DEFAULT_FILTERS);
    expect(writeFilters(DEFAULT_FILTERS).toString()).toBe('');
  });

  it('round-trips every filter and keeps foreign parameters', () => {
    const filters: BoardFilters = {
      view: 'gaps',
      q: 'deploy',
      type: ['task', 'risk'],
      status: ['open', 'blocked'],
      side: ['owner'],
      priority: ['urgent'],
      label: ['deploy', 'ui'],
      topic: ['product'],
      hideClosed: false,
      deleted: true,
      sort: 'due',
    };
    const written = writeFilters(filters, params('panel=keys&state=admin'));
    expect(written.get('panel')).toBe('keys');
    expect(written.get('state')).toBe('admin');
    expect(parseFilters(written)).toEqual(filters);
  });

  it('ignores unknown and malformed values', () => {
    expect(
      parseFilters(
        params(
          'view=evil&type=task,nope&status=DONE&sort=random&label=Bad Label,ok:1&topic=X,product',
        ),
      ),
    ).toEqual({ ...DEFAULT_FILTERS, type: ['task'], label: ['ok:1'], topic: ['product'] });
  });
});

describe('the API query of each view', () => {
  it('Topics: open items only, newest first', () => {
    expect(query({})).toBe('open=true&sort=updated');
    expect(query({ hideClosed: false })).toBe('sort=updated');
  });

  it('Mine and Claude are a side, most urgent first', () => {
    expect(query({ view: 'mine' })).toBe('side=owner&open=true&sort=priority');
    expect(query({ view: 'assistant', side: ['owner'] })).toBe(
      'side=assistant&open=true&sort=priority',
    );
  });

  it('Decisions: every decision (done included), newest decision first', () => {
    expect(query({ view: 'decisions' })).toBe('type=decision&sort=decided');
  });

  it('Gaps: gaps by priority; Notes: notes and memories, the type filter narrows', () => {
    expect(query({ view: 'gaps', type: ['task'] })).toBe('type=gap&open=true&sort=priority');
    expect(query({ view: 'notes' })).toBe('type=note%2Cmemory&sort=updated');
    expect(query({ view: 'notes', type: ['memory'] })).toBe('type=memory&sort=updated');
  });

  it('adds the person’s filters, search and order', () => {
    expect(
      query({
        status: ['blocked'],
        priority: ['high', 'urgent'],
        label: ['ui'],
        topic: ['design-ux'],
        q: '  icon ',
        sort: 'due',
      }),
    ).toBe(
      'topic=design-ux&status=blocked&priority=high%2Curgent&label=ui&open=true&q=icon&sort=due',
    );
  });

  it('asks for deleted items only for an admin', () => {
    expect(query({ deleted: true }, false)).toBe('open=true&sort=updated');
    expect(query({ deleted: true }, true)).toBe('open=true&includeDeleted=true&sort=updated');
  });
});

describe('summary shortcuts', () => {
  it('apply their filter and know when they are applied', () => {
    expect(query(shortcutFilters('waitingOnOwner'))).toBe(
      'side=owner%2Cboth&open=true&sort=updated',
    );
    expect(query(shortcutFilters('waitingOnAssistant'))).toBe(
      'side=assistant%2Cboth&open=true&sort=updated',
    );
    expect(query(shortcutFilters('blocked'))).toBe('status=blocked&open=true&sort=updated');
    expect(query(shortcutFilters('overdue'))).toBe('open=true&sort=due');
    expect(isShortcutActive('blocked', shortcutFilters('blocked'))).toBe(true);
    expect(isShortcutActive('blocked', DEFAULT_FILTERS)).toBe(false);
    expect(isShortcutActive('blocked', { ...shortcutFilters('blocked'), q: 'x' })).toBe(false);
  });
});

describe('quick add defaults', () => {
  const topics = boardTopics();

  it('follow the view, the one filtered type, side and topic, then the last topic used', () => {
    expect(quickAddDefaults(DEFAULT_FILTERS, topics, null)).toEqual({
      type: 'task',
      side: 'both',
      topic: 'product',
    });
    expect(quickAddDefaults({ ...DEFAULT_FILTERS, view: 'gaps' }, topics, 'design-ux')).toEqual({
      type: 'gap',
      side: 'both',
      topic: 'design-ux',
    });
    expect(quickAddDefaults({ ...DEFAULT_FILTERS, view: 'assistant' }, topics, null).side).toBe(
      'assistant',
    );
    expect(
      quickAddDefaults(
        { ...DEFAULT_FILTERS, type: ['risk'], side: ['external'], topic: ['mobile-stores'] },
        topics,
        'design-ux',
      ),
    ).toEqual({ type: 'risk', side: 'external', topic: 'mobile-stores' });
    expect(quickAddDefaults({ ...DEFAULT_FILTERS, view: 'notes' }, topics, null).type).toBe('note');
  });

  it('never picks an archived or unknown topic', () => {
    const archived = topics.map((topic) =>
      topic.key === 'product' ? { ...topic, archived: true } : topic,
    );
    expect(quickAddDefaults(DEFAULT_FILTERS, archived, 'gone').topic).toBe('doctor-access');
  });
});
