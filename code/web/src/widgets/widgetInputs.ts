/*
 * The widget snapshot (widgets/snapshot.ts) also reads two things that are not in Dexie, so a Dexie live query cannot
 * see them change: the selected baby and the cached predictions (localStorage). Their writers call
 * `widgetInputsChanged()`; `WidgetSync` listens and writes the snapshot again (docs/design/37-widgets-siri.md
 * "Freshness"). No dependencies on purpose: storage modules import it.
 */

const listeners = new Set<() => void>();

/** Something the widget snapshot reads outside Dexie changed. Never throws. */
export function widgetInputsChanged(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A widget refresh must never break the write that called it.
    }
  }
}

/** Calls `listener` on every `widgetInputsChanged()`; returns the unsubscribe. */
export function onWidgetInputsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
