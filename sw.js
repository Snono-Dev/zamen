/* Zamen service worker: offline-first app shell */
const CACHE = "zamen-v1";
const ASSETS = [
  "./", "./index.html", "./style.css", "./manifest.json",
  "./js/i18n.js", "./js/dsp.js", "./js/sync.js", "./js/exporters.js", "./js/app.js",
  "./assets/icon-32.png", "./assets/icon-64.png", "./assets/icon-180.png",
  "./assets/icon-192.png", "./assets/icon-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then(hit =>
      hit ||
      fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match("./index.html"))
    )
  );
});
