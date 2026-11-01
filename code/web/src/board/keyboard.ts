/** Whether a key press belongs to a field (shortcuts never fire while the person types). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** Moves focus to the next (`1`) or previous (`-1`) item row of the list. */
export function focusRow(step: 1 | -1, root: ParentNode = document): void {
  const rows = [...root.querySelectorAll<HTMLElement>('[data-board-row]')];
  if (rows.length === 0) return;
  const current = rows.indexOf(document.activeElement as HTMLElement);
  const next =
    current < 0
      ? step === 1
        ? 0
        : rows.length - 1
      : Math.min(rows.length - 1, Math.max(0, current + step));
  rows[next].focus();
}
