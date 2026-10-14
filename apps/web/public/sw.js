// Retire the earlier offline prototype's worker when browsers check for updates.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  const owned = (await caches.keys()).filter((key) => key.startsWith('workbox-precache-') && key.endsWith(self.registration.scope));
  await Promise.all(owned.map((key) => caches.delete(key)));
  await self.registration.unregister();
  const pages = await self.clients.matchAll({ type: 'window' });
  await Promise.all(pages.map((page) => page.navigate(page.url)));
})()));
