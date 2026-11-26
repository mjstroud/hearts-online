// Shoot the Sun's service worker. It shows turn alerts (Android Chrome won't let a page construct
// a Notification itself), and every page registers it so browsers that want one before offering
// to install the site get one (src/layouts/Layout.astro). There is deliberately no fetch handler and no
// caching, so every request still goes to the server and a deploy is never stuck behind old files.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Tapping an alert brings back the game's tab if one is open, or opens the game.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(openGame(event.notification.data && event.notification.data.url));
});

async function openGame(raw) {
  let url = new URL('/games', self.location.origin);
  try {
    const wanted = new URL(raw, self.location.origin);
    // Only ever this site.
    if (wanted.origin === self.location.origin) url = wanted;
  } catch {
    /* no or bad url: fall back to the games list */
  }
  const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const tab = tabs.find((c) => new URL(c.url).pathname === url.pathname);
  if (tab) {
    try {
      return await tab.focus();
    } catch {
      /* the browser refused focus: open a fresh tab instead */
    }
  }
  return self.clients.openWindow(url.href);
}
