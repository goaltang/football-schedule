export function registerServiceWorker() {
  const manifest = document.createElement('link');
  manifest.rel = 'manifest';
  manifest.href = `${import.meta.env.BASE_URL}manifest.webmanifest`;
  document.head.appendChild(manifest);
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;
  const controlled = Boolean(navigator.serviceWorker.controller);
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!controlled || reloaded) return;
    reloaded = true;
    location.reload();
  });
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
    scope: import.meta.env.BASE_URL,
    updateViaCache: 'none',
  }).catch(() => {});
}
