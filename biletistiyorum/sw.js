// ZEREN SPOR KULÜBÜ — BİLET PORTALI SERVICE WORKER (PWA)
const CACHE_NAME = "zeren-bilet-pwa-v2";

const PRECACHE_ASSETS = [
  "/",
  "/index.html",
  "/bilet_istiyorum.css",
  "/bilet_istiyorum.js",
  "/zeren_logo.png",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-192.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon-64.png",
  "https://unpkg.com/@phosphor-icons/web",
  "https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
];

// Install: Pre-cache static assets
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn("PWA: Bazı varlıklar önbelleğe alınamadı:", err);
      });
    })
  );
});

// Activate: Clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: Network-first for APIs, Stale-while-revalidate for static files
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Sadece GET isteklerini önbelleğe al
  if (req.method !== "GET") {
    return;
  }

  // API istekleri: Network First (internet varsa canlı, yoksa hata)
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(req).catch(() => {
        return new Response(JSON.stringify({ error: "İnternet bağlantınızı kontrol edin." }), {
          headers: { "Content-Type": "application/json" }
        });
      })
    );
    return;
  }

  // Statik varlıklar: Stale-While-Revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const resClone = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          }
          return networkRes;
        })
        .catch(() => cached);

      return cached || fetchPromise;
    })
  );
});
