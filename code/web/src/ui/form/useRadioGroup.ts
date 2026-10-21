import { useRef, type KeyboardEvent } from 'react';

interface Item<T extends string> {
  value: T;
  disabled?: boolean;
}

/**
 * Roving tabindex and arrow-key navigation of a radio group (WAI-ARIA radio group pattern): one
 * tab stop (the selected option, else the first enabled one); arrows, Home and End move focus and
 * select; disabled options are skipped. Left/Right follow the writing direction.
 */
export function useRadioGroup<T extends string>(
  items: readonly Item<T>[],
  selected: T | null,
  select: (value: T) => void,
) {
  const refs = useRef(new Map<T, HTMLElement>());
  const enabled = items.filter((item) => !item.disabled);
  const tabbable = enabled.find((item) => item.value === selected) ?? enabled[0];

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const current = enabled.findIndex((item) => refs.current.get(item.value) === event.target);
    if (current < 0) return;
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const backward = rtl ? 'ArrowRight' : 'ArrowLeft';
    const count = enabled.length;
    let index = -1;
    if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = count - 1;
    else if (event.key === forward || event.key === 'ArrowDown') index = (current + 1) % count;
    else if (event.key === backward || event.key === 'ArrowUp') {
      index = (current - 1 + count) % count;
    }
    const target = enabled[index];
    if (!target) return;
    event.preventDefault();
    refs.current.get(target.value)?.focus();
    select(target.value);
  };

  return {
    onKeyDown,
    tabIndexFor: (value: T) => (value === tabbable?.value ? 0 : -1),
    register: (value: T) => (element: HTMLElement | null) => {
      if (element) refs.current.set(value, element);
      else refs.current.delete(value);
    },
  };
}
