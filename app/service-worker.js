// Retired service worker. The site used to precache itself with Workbox and serve those copies
// first, so visitors kept seeing old versions after a deploy until every tab was closed.
// Browsers that still have it installed fetch this file when they check for updates. It takes
// over right away, deletes the old caches, unregisters itself and reloads open tabs so they
// load the latest version from the network. Nothing is cached anymore.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
    event.waitUntil(
        (async () => {
            // other GitHub Pages sites share this origin, so only delete this site's caches
            const cacheNames = await caches.keys();
            await Promise.all(
                cacheNames
                    .filter((cacheName) => cacheName.includes(self.registration.scope))
                    .map((cacheName) => caches.delete(cacheName))
            );
            await self.registration.unregister();
            const windowClients = await self.clients.matchAll({ type: "window" });
            windowClients.forEach((client) => client.navigate(client.url));
        })()
    );
});
