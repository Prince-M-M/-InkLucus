/* InkLucus service worker: offline reading of chapters the reader saved. */
const STATIC = "static-v1";
const BOOKS = "offline-books";
const OFFLINE_URL = "/offline";

/** Cache the offline page and the script/style files it needs, so it renders without a connection. */
async function precacheOffline() {
  const cache = await caches.open(STATIC);
  const res = await fetch(OFFLINE_URL, { cache: "reload" });
  if (!res.ok) return;
  const html = await res.clone().text();
  await cache.put(OFFLINE_URL, res);
  const assets = [...new Set(html.match(/\/_next\/static\/[^"'\s)]+/g) || [])];
  await Promise.all(assets.map((a) => cache.match(a).then((hit) => hit || fetch(a).then((r) => (r.ok ? cache.put(a, r) : undefined)))));
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheOffline().catch(() => undefined).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== STATIC && k !== BOOKS).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Build assets are content-hashed: cache-first is safe.
  if (url.pathname.startsWith("/_next/static/") || url.pathname === "/icon.svg") {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(STATIC).then((c) => c.put(req, copy)); }
        return res;
      })),
    );
    return;
  }

  // Pages: always try the network first so readers see fresh content and access checks.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(async () => (await caches.match(req, { ignoreSearch: true })) || (await caches.match(OFFLINE_URL)) || Response.error()),
    );
  }
});
