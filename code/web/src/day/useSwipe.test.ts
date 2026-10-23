import { renderHook } from '@testing-library/react';
import type { TouchEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSwipe } from './useSwipe';

const point = (x: number, y = 100) => ({ clientX: x, clientY: y });
const touchStart = (...touches: { clientX: number; clientY: number }[]) =>
  ({ touches }) as unknown as TouchEvent;
const touchEnd = (touch: { clientX: number; clientY: number }) =>
  ({ changedTouches: [touch], touches: [] }) as unknown as TouchEvent;

describe('useSwipe', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('turns a sideways one-finger drag into a swipe', () => {
    const onLeft = vi.fn();
    const onRight = vi.fn();
    const { result } = renderHook(() => useSwipe(onLeft, onRight));
    result.current.onTouchStart(touchStart(point(200)));
    result.current.onTouchEnd(touchEnd(point(100)));
    expect(onLeft).toHaveBeenCalledOnce();
    result.current.onTouchStart(touchStart(point(100)));
    result.current.onTouchEnd(touchEnd(point(200)));
    expect(onRight).toHaveBeenCalledOnce();
  });

  it('leaves a pinch alone (a second finger)', () => {
    const onLeft = vi.fn();
    const { result } = renderHook(() => useSwipe(onLeft, vi.fn()));
    result.current.onTouchStart(touchStart(point(200), point(260)));
    result.current.onTouchEnd(touchEnd(point(100)));
    expect(onLeft).not.toHaveBeenCalled();
  });

  it('leaves panning a zoomed-in page alone', () => {
    vi.stubGlobal('visualViewport', { scale: 2 });
    const onLeft = vi.fn();
    const { result } = renderHook(() => useSwipe(onLeft, vi.fn()));
    result.current.onTouchStart(touchStart(point(200)));
    result.current.onTouchEnd(touchEnd(point(100)));
    expect(onLeft).not.toHaveBeenCalled();
  });
});
