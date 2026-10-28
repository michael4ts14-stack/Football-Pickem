// Service worker for the installed app. Small on purpose:
// - Same-origin app files only (index.html, css/, js/, icons, manifest, offline page).
// - Network first, always: online users get the newest deploy; the cache is only
//   used when the network fails (offline), and a page with no connection gets
//   /offline.html.
// - Cross-origin requests (Firestore, Firebase Auth, googleapis, ESPN, fonts, CDNs)
//   and Firebase's reserved /__/ paths are never intercepted or cached.
// - A new version waits until the page says "reload" (the Update bar), so nobody
//   is reloaded in the middle of making picks.
var CACHE = "sat-shell-2026-10-28n";
var SHELL = [
  "/index.html",
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon-32.png"
];

self.addEventListener("install", function(event) {
  event.waitUntil(caches.open(CACHE).then(function(cache) {
    return cache.addAll(SHELL.map(function(u) { return new Request(u, { cache: "reload" }); }));
  }));
});

self.addEventListener("activate", function(event) {
  event.waitUntil(caches.keys().then(function(keys) {
    return Promise.all(keys.filter(function(k) { return k.indexOf("sat-shell-") === 0 && k !== CACHE; })
      .map(function(k) { return caches.delete(k); }));
  }).then(function() { return self.clients.claim(); }));
});

// The page's "Reload" button.
self.addEventListener("message", function(event) {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function isAppFile(url) {
  return url.origin === self.location.origin && url.pathname.indexOf("/__/") !== 0 && url.pathname !== "/sw.js";
}

self.addEventListener("fetch", function(event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (!isAppFile(url)) return; // straight to the network, untouched

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).then(function(res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function(c) { c.put("/index.html", copy); });
      }
      return res;
    }).catch(function() {
      return caches.match("/offline.html");
    }));
    return;
  }

  event.respondWith(fetch(req).then(function(res) {
    if (res && res.ok && res.type === "basic") {
      var copy = res.clone();
      caches.open(CACHE).then(function(c) { c.put(req, copy); });
    }
    return res;
  }).catch(function() {
    return caches.match(req).then(function(hit) { return hit || caches.match(req, { ignoreSearch: true }); });
  }));
});
