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
const CACHE_NAME = 'attendance-scanner-v8';

// Assets to precache (app shell)
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/scanner.html',
  '/styles.css',
  '/app.js',
  'https://unpkg.com/dexie@latest/dist/dexie.js',
  'https://unpkg.com/html5-qrcode',
  '/manifest.json'
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
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => {
        console.log('[Service Worker] Precaching complete');
        return self.skipWaiting(); // Activate immediately
      })
      .catch((error) => {
        console.error('[Service Worker] Precaching failed:', error);
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
  const requestUrl = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Handle API requests (network first, fallback to cache for roster)
  if (requestUrl.pathname.startsWith('/api/')) {
    event.respondWith(handleApiRequest(event.request));
    return;
  }

  // Handle app shell assets (cache first)
  event.respondWith(handleAppShellRequest(event.request));
});

// ==========================================
// Handle App Shell Requests (Cache First)
// ==========================================
async function handleAppShellRequest(request) {
  const cachedResponse = await caches.match(request);

  if (cachedResponse) {
    return cachedResponse;
  }

  // If not in cache, try network
  try {
    const networkResponse = await fetch(request);

    // Cache the new response
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    // Return offline fallback for HTML pages
    if (request.headers.get('accept')?.includes('text/html')) {
      return caches.match('/index.html');
    }

    // Return error for other requests
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

// ==========================================
// Handle API Requests (Network First)
// ==========================================
async function handleApiRequest(request) {
  try {
    const networkResponse = await fetch(request);
    return networkResponse;
  } catch (error) {
    // Network failed, try to return cached data for roster endpoint
    const requestUrl = new URL(request.url);

    if (requestUrl.pathname === '/api/roster') {
      // Return cached roster if available
      const cachedRoster = await caches.match('/api/roster');
      if (cachedRoster) {
        return cachedRoster;
      }
    }

    // No cache available, return error
    return new Response(
      JSON.stringify({ error: 'Offline and no cached data available' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ==========================================
// Push Notifications (Placeholder for future use)
// ==========================================
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();
    console.log('[Service Worker] Push notification received:', data);
  }
});

// ==========================================
// Background Sync (Placeholder for future use)
// ==========================================
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-attendance') {
    console.log('[Service Worker] Background sync triggered');
    // Sync logic would go here
  }
});

console.log('[Service Worker] Script loaded');