import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventFieldDefinition, EventType } from '../db/models';
import { ErrorBoundary } from '../layout/ErrorBoundary';
import { payloadSummary } from '../timeline/payloadSummary';
import { describeFailure } from '../sync/failures';
import { httpError } from '../test/fakeApi';
import { withOwn } from '../util/ownProperty';
import { EventTypeIcon } from './eventIcons';
import { buildPayload, initialForm, validateForm } from './formModel';

afterEach(() => {
  vi.restoreAllMocks();
});

const field = (key: string, overrides: Partial<EventFieldDefinition> = {}) =>
  ({
    key,
    label: key,
    kind: 'text',
    isRequired: false,
    options: [],
    min: null,
    max: null,
    unit: null,
    ...overrides,
  }) satisfies EventFieldDefinition;

const typeWith = (...fields: EventFieldDefinition[]): EventType => ({
  id: 't1',
  babyId: 'b1',
  key: 'custom',
  name: 'Custom',
  icon: 'constructor',
  color: '#000000',
  hasDuration: false,
  fields,
});

describe('server-provided keys never hit inherited members (review #5)', () => {
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    'renders the fallback icon for the icon name %s',
    (name) => {
      render(<EventTypeIcon name={name} fontSize={24} />);
      expect(screen.getByTestId('EventNoteIcon')).toBeTruthy();
    },
  );

  it('reads, validates and writes a field keyed `constructor`', () => {
    const type = typeWith(field('constructor', { isRequired: true }), field('__proto__'));
    const event = {
      id: 'e1',
      babyId: 'b1',
      typeId: 't1',
      startedAt: '2026-10-20T08:00:00.000Z',
      endedAt: '2026-10-20T08:00:00.000Z',
      payload: {},
      notes: null,
      createdBy: null,
      createdAt: '2026-10-20T08:00:00.000Z',
      updatedAt: '2026-10-20T08:00:00.000Z',
      deletedAt: null,
    };

    const form = initialForm([type], event, undefined, new Date());
    expect(Object.keys(form.values)).toEqual([]);
    expect(validateForm(form, type)).toEqual(['constructor is required.']);

    const filled = {
      ...form,
      values: withOwn<string | boolean>(
        withOwn<string | boolean>(form.values, 'constructor', 'yes'),
        '__proto__',
        'p',
      ),
    };
    expect(validateForm(filled, type)).toEqual([]);
    const payload = buildPayload(filled, type);
    expect(Object.hasOwn(payload, 'constructor')).toBe(true);
    expect(Object.hasOwn(payload, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(payload)).toBe(Object.prototype);
    expect(JSON.stringify(payload)).toBe('{"constructor":"yes","__proto__":"p"}');
  });

  it('summarises a payload without inventing values for `constructor`', () => {
    expect(payloadSummary({}, typeWith(field('constructor')))).toBe('');
    expect(payloadSummary({ constructor: 'x' }, typeWith(field('constructor')))).toBe('x');
  });

  it('does not map an unknown problem code `constructor` to a message', () => {
    expect(describeFailure(httpError(409, 'constructor'))).toBe('The server rejected this change.');
  });
});

describe('ErrorBoundary', () => {
  function Boom(): never {
    throw new Error('bad record');
  }

  it('shows a friendly message with Reload instead of the failing subtree only', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onReload = vi.fn();
    render(
      <>
        <p>Still here</p>
        <ErrorBoundary onReload={onReload}>
          <Boom />
        </ErrorBoundary>
      </>,
    );

    expect(screen.getByText('Something went wrong.')).toBeTruthy();
    expect(screen.getByText('Still here')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalledOnce();
  });

  it('renders the children again when the reset key changes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail = true;
    function Maybe() {
      if (fail) throw new Error('bad');
      return <p>Recovered</p>;
    }
    const { rerender } = render(
      <ErrorBoundary resetKey="/a">
        <Maybe />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong.')).toBeTruthy();

    fail = false;
    rerender(
      <ErrorBoundary resetKey="/b">
        <Maybe />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Recovered')).toBeTruthy();
  });
});
