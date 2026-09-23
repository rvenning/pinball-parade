// Pinball Parade service worker — network-first, cache fallback.
// Bump with `node lib/tools/stamp-version.js . --bump`, never by hand.
const CACHE = "pinball-parade-v3";
const SHELL = [
  ".",
  "index.html",
  "manifest.json",
  "css/style.css",
  "lib/gk-base.css",
  "lib/gk-util.js",
  "lib/gk-audio.js",
  "lib/gk-ui.js",
  "lib/gk-storage.js",
  "lib/gk-profiles.js",
  "lib/gk-pwa.js",
  "lib/gk-fx.js",
  "lib/gk-debug.js",
  "js/firebase-config.js",
  "js/physics.js",
  "js/tables.js",
  "js/chapters.js",
  "js/game.js",
  "js/storage.js",
  "js/audio.js",
  "js/assets.js",
  "js/render.js",
  "js/input.js",
  "js/main.js",
  "assets/available.json",
  "assets/logo/logo.png",
  "assets/world-cards/castle.png",
  "assets/world-cards/temple.png",
  "assets/world-cards/sea.png",
  "assets/world-cards/workshop.png",
  "assets/world-cards/clouds.png",
  "assets/characters/mascot.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Same-origin GETs only; fonts and Firebase pass straight through.
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then((hit) => hit || (req.mode === "navigate" ? caches.match("index.html") : Response.error())))
  );
});
