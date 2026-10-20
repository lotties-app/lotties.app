import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyEvent } from '../db/models';
import { EVENT_TYPES, FEEDING } from '../test/seed';
import { RunningTimers } from './RunningTimers';

const START = new Date('2026-10-20T08:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date(START.getTime() + 5000));
});

afterEach(() => {
  vi.useRealTimers();
});

const event: BabyEvent = {
  id: 'e1',
  babyId: 'baby-1',
  typeId: FEEDING,
  startedAt: START.toISOString(),
  endedAt: null,
  payload: {},
  notes: null,
  createdBy: null,
  createdAt: START.toISOString(),
  updatedAt: START.toISOString(),
  deletedAt: null,
};

describe('RunningTimers', () => {
  it('shows elapsed time computed from startedAt and ticks every second', () => {
    render(
      <RunningTimers events={[event]} types={EVENT_TYPES} onStop={vi.fn()} onEdit={vi.fn()} />,
    );
    expect(screen.getByText('00:05')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('00:06')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(3_600_000);
    });
    expect(screen.getByText('1:00:06')).toBeTruthy();
  });

  it('stops and edits through callbacks', () => {
    const onStop = vi.fn();
    const onEdit = vi.fn();
    render(<RunningTimers events={[event]} types={EVENT_TYPES} onStop={onStop} onEdit={onEdit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Stop Feeding' }));
    expect(onStop).toHaveBeenCalledWith(event);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Feeding' }));
    expect(onEdit).toHaveBeenCalledWith(event);
  });

  it('renders nothing without running events', () => {
    const { container } = render(
      <RunningTimers events={[]} types={EVENT_TYPES} onStop={vi.fn()} onEdit={vi.fn()} />,
    );
    expect(container.textContent).toBe('');
  });
});
