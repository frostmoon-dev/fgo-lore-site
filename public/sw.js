// Makes the installed app open instantly and work without a connection for
// everything except talking to the model. Network first, so an update is
// picked up on the next visit; the cache is only the fallback when offline.
// API calls and other sites are never cached.
const CACHE = "moonpaper-v1";
const SHELL = [
  "/", "/index.html", "/style.css", "/favicon.svg", "/manifest.webmanifest", "/icon-192.png", "/library.json",
  "/js/app.js", "/js/theme-init.js", "/js/store.js", "/js/db.js", "/js/ui.js", "/js/api.js", "/js/prompt.js",
  "/js/markdown.js", "/js/card.js", "/js/ai.js", "/js/chart.js", "/js/install.js", "/js/palette.js", "/js/help.js",
  "/js/views/home.js", "/js/views/chat.js", "/js/views/bot-edit.js", "/js/views/personas.js", "/js/views/prompt.js",
  "/js/views/lore.js", "/js/views/connection.js", "/js/views/settings.js", "/js/views/search.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((url) => c.add(url).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request);
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    } catch {
      const hit = await caches.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      if (e.request.mode === "navigate") return (await caches.match("/")) ?? Response.error();
      return Response.error();
    }
  })());
});
