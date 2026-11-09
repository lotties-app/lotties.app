import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyEvent } from '../db/models';
import { SLEEP, event } from '../presets/presetFixtures';
import { SLEEP_TYPE } from '../test/builtInTypes';
import { useTestLocale } from '../test/locale';
import { renderUi } from '../test/renderUi';
import { DayRow } from './DayRow';
import { HOLD_MS } from './useLongPress';

const nap: BabyEvent = event({
  id: 'n',
  typeId: SLEEP,
  startedAt: '2026-10-20T13:00:00.000Z',
  endedAt: '2026-10-20T14:15:00.000Z',
  payload: { kind: 'nap' },
});

function renderRow(props: Partial<Parameters<typeof DayRow>[0]> = {}) {
  const onEdit = vi.fn();
  const onMenu = vi.fn();
  renderUi(
    <ul>
      <DayRow
        event={nap}
        type={SLEEP_TYPE}
        medications={[]}
        syncState={undefined}
        hasNext={false}
        onEdit={onEdit}
        onMenu={onMenu}
        {...props}
      />
    </ul>,
  );
  const row = screen.getByRole('button', { name: /^(Edit|Editar) / });
  return { onEdit, onMenu, row };
}

/** A finger down, held for `ms`, then lifted where it went (`dx`, `dy`), then the tap's click. */
function press(target: Element, ms: number, move = { dx: 0, dy: 0 }) {
  fireEvent.pointerDown(target, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
  if (move.dx || move.dy) {
    fireEvent.pointerMove(target, {
      clientX: 100 + move.dx,
      clientY: 100 + move.dy,
      pointerId: 1,
    });
  }
  act(() => {
    vi.advanceTimersByTime(ms);
  });
  fireEvent.pointerUp(target, { button: 0, pointerId: 1 });
  fireEvent.click(target);
}

describe('DayRow press and hold', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens the menu after a hold and does not also edit', () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    const { onEdit, onMenu, row } = renderRow();
    press(row, HOLD_MS + 10);
    expect(onMenu).toHaveBeenCalledWith(nap);
    expect(onEdit).not.toHaveBeenCalled();
    expect(vibrate).toHaveBeenCalledWith(10);
    // The next plain tap edits again.
    press(row, 50);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('edits on a short tap without opening the menu', () => {
    const { onEdit, onMenu, row } = renderRow();
    press(row, 100);
    expect(onEdit).toHaveBeenCalledWith(nap);
    expect(onMenu).not.toHaveBeenCalled();
  });

  it('is cancelled by moving the finger more than 10 px (a scroll or a swipe)', () => {
    const { onMenu, row } = renderRow();
    press(row, HOLD_MS + 10, { dx: 0, dy: 24 });
    expect(onMenu).not.toHaveBeenCalled();
  });

  it('is cancelled by a scroll and by a second finger', () => {
    const { onMenu, row } = renderRow();
    fireEvent.pointerDown(row, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.scroll(window);
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 10);
    });
    expect(onMenu).not.toHaveBeenCalled();

    fireEvent.pointerDown(row, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerDown(row, { button: 0, clientX: 160, clientY: 100, pointerId: 2 });
    act(() => {
      vi.advanceTimersByTime(HOLD_MS + 10);
    });
    expect(onMenu).not.toHaveBeenCalled();
  });

  it('stays out of the Stop button', () => {
    const onStop = vi.fn();
    const { onMenu } = renderRow({ event: { ...nap, endedAt: null }, onStop });
    const stop = screen.getByRole('button', { name: /^Stop / });
    press(stop, HOLD_MS + 10);
    expect(onMenu).not.toHaveBeenCalled();
    expect(onStop).toHaveBeenCalled();
  });
});

describe('DayRow menu without a gesture', () => {
  it('opens on the Menu key and on Shift+F10, and says so to screen readers', () => {
    const { onMenu, row } = renderRow();
    fireEvent.keyDown(row, { key: 'ContextMenu' });
    fireEvent.keyDown(row, { key: 'F10', shiftKey: true });
    fireEvent.keyDown(row, { key: 'F10' });
    expect(onMenu).toHaveBeenCalledTimes(2);
    expect(row.getAttribute('aria-label')).toMatch(/^Edit Nap, \d\d:\d\d$/);
    expect(screen.getByRole('button', { description: /Shift\+F10/ })).toBe(row);
  });

  it('opens on a right-click without the browser menu', () => {
    const { onEdit, onMenu, row } = renderRow();
    const shown = fireEvent.contextMenu(row);
    expect(shown).toBe(false);
    expect(onMenu).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('has no menu, hint or handlers without onMenu', () => {
    renderUi(
      <ul>
        <DayRow
          event={nap}
          type={SLEEP_TYPE}
          medications={[]}
          syncState={undefined}
          hasNext={false}
          onEdit={() => undefined}
        />
      </ul>,
    );
    expect(screen.queryByText(/Shift\+F10/)).toBeNull();
    expect(fireEvent.contextMenu(screen.getByRole('button'))).toBe(true);
  });
});

describe('DayRow more button', () => {
  it('opens the menu without editing and is a focusable button', () => {
    const { onEdit, onMenu } = renderRow();
    const more = screen.getByRole('button', { name: 'More actions for Nap' });
    expect(more.tabIndex).toBe(0);
    fireEvent.click(more);
    expect(onMenu).toHaveBeenCalledWith(nap);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('is not a hold target: a long press on it does nothing more than its click', () => {
    vi.useFakeTimers();
    try {
      const { onEdit, onMenu } = renderRow();
      press(screen.getByRole('button', { name: 'More actions for Nap' }), HOLD_MS + 10);
      expect(onMenu).toHaveBeenCalledTimes(1);
      expect(onEdit).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps Stop beside it on a running row', () => {
    const onStop = vi.fn();
    const { onMenu } = renderRow({ event: { ...nap, endedAt: null }, onStop });
    fireEvent.click(screen.getByRole('button', { name: 'Stop Nap' }));
    expect(onStop).toHaveBeenCalled();
    expect(onMenu).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Nap' }));
    expect(onMenu).toHaveBeenCalledTimes(1);
  });

  it('gives a Viewer (row tap disabled) a keyboard route to the menu', () => {
    const onMenu = vi.fn();
    renderUi(
      <ul>
        <DayRow
          event={nap}
          type={SLEEP_TYPE}
          medications={[]}
          syncState={undefined}
          hasNext={false}
          onEdit={() => undefined}
          onMenu={onMenu}
          readOnly
        />
      </ul>,
    );
    const more = screen.getByRole('button', { name: 'More actions for Nap' });
    expect(more.hasAttribute('disabled')).toBe(false);
    fireEvent.click(more);
    expect(onMenu).toHaveBeenCalledWith(nap);
  });

  it('is named in Portuguese too', async () => {
    await useTestLocale('pt-BR');
    renderRow();
    expect(screen.getByRole('button', { name: /^Mais ações para / })).toBeTruthy();
  });
});
