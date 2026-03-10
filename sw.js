// ═══════════════════════════════════════════════════════════════
// HARBOUR PILOT — Service Worker PWA
// Stratégie : Cache-First pour assets locaux, Network-First pour tuiles
// ═══════════════════════════════════════════════════════════════

const CACHE_NAME = 'harbour-pilot-v1';
const TILE_CACHE = 'harbour-pilot-tiles-v1';

// Assets à mettre en cache au démarrage
const CORE_ASSETS = [
  './pilote-maritime.html',
  './manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

// ── Installation : pré-cache des assets core ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS).catch(e => {
        // Certains assets peuvent échouer (réseau limité) — on continue quand même
        console.warn('[SW] Pré-cache partiel:', e.message);
      }))
      .then(() => self.skipWaiting())
  );
});

// ── Activation : nettoyage des anciens caches ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(k => k !== CACHE_NAME && k !== TILE_CACHE)
        .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch : stratégie adaptée par type de ressource ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. Tuiles de carte (OSM + OpenSeaMap) → Cache-First avec expiration
  if (url.hostname.includes('tile.openstreetmap.org') ||
      url.hostname.includes('tiles.openseamap.org')) {
    event.respondWith(
      caches.open(TILE_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(response => {
            if (response.ok) {
              cache.put(event.request, response.clone());
            }
            return response;
          }).catch(() => {
            // Tuile non disponible hors-ligne : retourner une tuile vide
            return new Response('', { status: 204 });
          });
        })
      )
    );
    return;
  }

  // 2. Leaflet CDN → Cache-First (version fixe)
  if (url.hostname.includes('unpkg.com')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          caches.open(CACHE_NAME).then(c => c.put(event.request, response.clone()));
          return response;
        });
      })
    );
    return;
  }

  // 3. API Anthropic (rapport IA) → Network-Only, pas de cache
  if (url.hostname.includes('anthropic.com')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 4. App HTML principale → Cache-First avec refresh en background (stale-while-revalidate)
  if (url.pathname.includes('pilote-maritime.html') || url.pathname === '/') {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(event.request).then(cached => {
          const fetchPromise = fetch(event.request).then(response => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          });
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // 5. Autres requêtes → Network-First
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// ── Message : force update depuis l'app ──
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
