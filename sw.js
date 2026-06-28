/**
 * ==========================================
 * Attendance Scanner PWA - Service Worker
 * ==========================================
 * Provides offline functionality through precaching
 * and cache-first strategy for app shell assets.
 */

// ==========================================
// Cache Configuration
// ==========================================
const CACHE_NAME = 'attendance-scanner-v9';

// Assets to precache (app shell) – only your own files
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/scanner.html',
  '/records.html',
  '/app.js',
  '/manifest.json'   // if you have one
  // Do NOT include external CDN URLs here – they will be fetched from network
];

// ==========================================
// Install Event - Precache Assets
// ==========================================
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Precaching app shell');
        // Use addAll but catch failures so install doesn't break
        return cache.addAll(PRECACHE_ASSETS).catch((err) => {
          console.warn('[Service Worker] Some assets failed to cache:', err);
        });
      })
      .then(() => {
        console.log('[Service Worker] Precaching complete');
        return self.skipWaiting(); // Activate immediately
      })
  );
});

// ==========================================
// Activate Event - Cleanup Old Caches
// ==========================================
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');

  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        // Delete old caches
        return Promise.all(
          cacheNames
            .filter((cacheName) => cacheName !== CACHE_NAME)
            .map((cacheName) => {
              console.log('[Service Worker] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            })
        );
      })
      .then(() => {
        console.log('[Service Worker] Activation complete');
        return self.clients.claim(); // Take control immediately
      })
  );
});

// ==========================================
// Fetch Event - Serve from Cache
// ==========================================
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // ---- Skip non-GET requests ----
  if (request.method !== 'GET') return;

  // ---- Skip requests that are not from our origin (ignore CDN, extensions, etc.) ----
  if (url.origin !== self.location.origin) {
    // Let the browser handle these normally (no caching)
    return;
  }

  // ---- Handle API requests (network first, fallback) ----
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(handleApiRequest(request));
    return;
  }

  // ---- Handle app shell assets (cache first) ----
  event.respondWith(handleAppShellRequest(request));
});

// ==========================================
// Handle App Shell Requests (Cache First)
// ==========================================
async function handleAppShellRequest(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  // Not in cache – try network
  try {
    const networkResponse = await fetch(request);
    // Cache only if successful and same origin (already ensured)
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    // Offline fallback for HTML pages
    if (request.headers.get('accept')?.includes('text/html')) {
      return caches.match('/index.html');
    }
    // For other assets, return a minimal error
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

// ==========================================
// Handle API Requests (Network First)
// ==========================================
async function handleApiRequest(request) {
  try {
    const networkResponse = await fetch(request);
    // Optionally cache API responses for offline use
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    // Network failed – try cache
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    return new Response(
      JSON.stringify({ error: 'Offline and no cached data available' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ==========================================
// Push Notifications (Placeholder)
// ==========================================
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();
    console.log('[Service Worker] Push notification received:', data);
  }
});

// ==========================================
// Background Sync (Placeholder)
// ==========================================
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-attendance') {
    console.log('[Service Worker] Background sync triggered');
    // Sync logic would go here
  }
});

console.log('[Service Worker] Script loaded');