import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { TOAST_BOTTOM } from '../layout/navMetrics';

/** Gap between two stacked notices. */
export const STACK_GAP = 8;
/** Height assumed until a notice has been measured (one line of a snackbar). */
export const FALLBACK_HEIGHT = 48;
/** CSS variable each stacked notice sets on itself: how far above the base offset it sits. */
export const STACK_OFFSET_VAR = '--lotties-stack-offset';
/** The bottom of a stacked notice: the shared toast offset plus its place in the stack. */
export const STACKED_TOAST_BOTTOM = `calc(${TOAST_BOTTOM} + var(${STACK_OFFSET_VAR}, 0px))`;

export interface StackEntry {
  id: string;
  height: number;
}

/**
 * How far above the shared toast offset the notice `id` sits: the first one opened sits on it, each
 * later one above the earlier ones (their heights plus a gap), so two notices never overlap.
 */
export function stackOffset(entries: readonly StackEntry[], id: string): number {
  let offset = 0;
  for (const entry of entries) {
    if (entry.id === id) return offset;
    offset += (entry.height > 0 ? entry.height : FALLBACK_HEIGHT) + STACK_GAP;
  }
  return 0;
}

let entries: readonly StackEntry[] = [];
const listeners = new Set<() => void>();

function publish(next: readonly StackEntry[]) {
  entries = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Puts an open notice on top of the stack. */
export function openStackEntry(id: string) {
  if (entries.some((entry) => entry.id === id)) return;
  publish([...entries, { id, height: 0 }]);
}

/** Records a notice's measured height (the ones above it move). */
export function setStackHeight(id: string, height: number) {
  const current = entries.find((entry) => entry.id === id);
  if (!current || current.height === height) return;
  publish(entries.map((entry) => (entry.id === id ? { id, height } : entry)));
}

/** Takes a closed notice off the stack (the ones above it move down). */
export function closeStackEntry(id: string) {
  if (!entries.some((entry) => entry.id === id)) return;
  publish(entries.filter((entry) => entry.id !== id));
}

/** The open notices, oldest first (tests). */
export function stackEntries(): readonly StackEntry[] {
  return entries;
}

function useMeasuredHeight(id: string, node: HTMLElement | null, open: boolean) {
  useEffect(() => {
    if (!open || !node) return;
    const measure = () => setStackHeight(id, node.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [id, node, open]);
}

/**
 * Joins the shared stack of bottom notices while `open`. Returns `[attach, offset]`: the callback
 * ref of the element to measure, and how many pixels above the shared toast offset it must sit.
 */
export function useSnackbarStack(open: boolean) {
  const id = useId();
  const [node, setNode] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    openStackEntry(id);
    return () => closeStackEntry(id);
  }, [id, open]);
  useMeasuredHeight(id, node, open);
  const offset = useSyncExternalStore(subscribe, () => (open ? stackOffset(entries, id) : 0));
  return [setNode, offset] as const;
}
