/* LongWalk service worker — offline app shell + on-demand map tile cache. */

const VERSION = "longwalk-v4";
const SHELL = `${VERSION}-shell`;
const TILES = `${VERSION}-tiles`;
const MAX_TILES = 600; // ~15–25 MB of OSM tiles

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./js/app.js",
  "./js/data.js",
  "./js/store.js",
  "./vendor/leaflet.js",
  "./vendor/leaflet.css",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

async function trimTiles() {
  const cache = await caches.open(TILES);
  const keys = await cache.keys();
  if (keys.length <= MAX_TILES) return;
  for (const req of keys.slice(0, keys.length - MAX_TILES)) await cache.delete(req);
}

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // OSM map tiles: cache-first, fill in as you browse the map.
  if (/tile\.openstreetmap\.org$/.test(url.hostname)) {
    e.respondWith(
      caches.open(TILES).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        try {
          const res = await fetch(request);
          if (res.ok) {
            cache.put(request, res.clone());
            trimTiles();
          }
          return res;
        } catch {
          return hit || Response.error();
        }
      }),
    );
    return;
  }

  // Same-origin app shell: cache-first, fall back to network.
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request)
            .then((res) => {
              if (res.ok && (request.destination === "" || request.destination === "document" || request.destination === "script" || request.destination === "style")) {
                caches.open(SHELL).then((c) => c.put(request, res.clone()));
              }
              return res;
            })
            .catch(() => caches.match("./index.html")),
      ),
    );
  }
});
