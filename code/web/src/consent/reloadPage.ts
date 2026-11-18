/** Reloads the page (its own module, so the stale-client tests can stand in for it: jsdom cannot reload). */
export function reloadPage(): void {
  window.location.reload();
}
