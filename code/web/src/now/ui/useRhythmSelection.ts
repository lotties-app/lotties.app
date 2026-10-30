import { useRef, useState, type KeyboardEvent } from 'react';
import { nextFocusIndex } from '../../day/ribbonGeometry';

/**
 * Selection and keyboard model shared by the day ring and the ruler: every mark is one button in
 * a roving tab order (one Tab stop for the chart, on "now" until another mark is focused); the
 * arrow keys, Home and End move between the marks in time order, Enter or Space selects (again to
 * clear), Esc clears. A tap or click toggles the same selection. A selected mark that disappears
 * (the window passed, a sleep was deleted) is simply no longer selected.
 */
export function useRhythmSelection(keys: readonly string[]) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const elements = useRef(new Map<string, HTMLElement | SVGElement>());
  const selected = selectedKey !== null && keys.includes(selectedKey) ? selectedKey : null;
  const fallback = keys.includes('now') ? 'now' : keys[0];
  const tabKey =
    activeKey !== null && keys.includes(activeKey) ? activeKey : (selected ?? fallback);

  const focus = (key: string) => {
    setActiveKey(key);
    elements.current.get(key)?.focus();
  };
  const toggle = (key: string) => {
    setActiveKey(key);
    setSelectedKey((current) => (current === key ? null : key));
  };
  /** Clears the selection; `refocus` gives the focus back to the mark (the strip's close button). */
  const clear = (refocus = false) => {
    if (refocus && selected) focus(selected);
    setSelectedKey(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement | SVGElement>) => {
    const index = keys.findIndex((key) => elements.current.get(key) === event.target);
    if (index < 0) return;
    if (event.key === 'Escape') {
      if (selected === null) return;
      event.preventDefault();
      clear();
      return;
    }
    // An SVG mark is no native button: Enter and Space select it here (HTML buttons click).
    if ((event.key === 'Enter' || event.key === ' ') && !(event.target instanceof HTMLElement)) {
      event.preventDefault();
      toggle(keys[index]);
      return;
    }
    const next = nextFocusIndex(index, keys.length, event.key);
    if (next === null) return;
    event.preventDefault();
    focus(keys[next]);
  };

  /** Props of one mark: its ref, tab stop, name, pressed state and handlers. */
  const markProps = (key: string, label: string) => ({
    ref: (element: HTMLElement | SVGElement | null) => {
      if (element) elements.current.set(key, element);
      else elements.current.delete(key);
    },
    tabIndex: key === tabKey ? 0 : -1,
    'aria-label': label,
    'aria-pressed': selected === key,
    onFocus: () => setActiveKey(key),
    onClick: () => toggle(key),
  });

  /** Selects `key` from outside the chart (a "Next up" row), or clears it when it is selected. */
  const select = (key: string) => {
    if (!keys.includes(key)) return;
    setSelectedKey((current) => (current === key ? null : key));
  };

  return { selected, onKeyDown, markProps, clear, select };
}
