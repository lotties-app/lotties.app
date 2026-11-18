/**
 * Shows a fallback reload UI if React fails to mount within 8 seconds.
 * This runs as an external module (not inline) to comply with the strict CSP
 * that blocks inline scripts. The fallback div is defined in index.html and
 * hidden by default; this script reveals it only when the app hasn't rendered.
 */
setTimeout(() => {
  const root = document.getElementById('root');
  const fallback = document.getElementById('app-fallback');
  const reloadBtn = document.getElementById('app-reload-btn');

  if (root && fallback && root.children.length <= 1) {
    fallback.style.display = 'flex';
  }

  if (reloadBtn) {
    reloadBtn.addEventListener('click', () => {
      // Force a hard reload bypassing the service worker cache
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          for (const registration of registrations) {
            registration.unregister();
          }
          window.location.reload();
        });
      } else {
        window.location.reload();
      }
    });
  }
}, 8000);