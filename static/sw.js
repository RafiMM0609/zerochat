const CACHE_NAME = 'agnostic-ai-cache-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/auth.css',
  '/app.js',
  '/favicon.svg',
  '/components/ChatDeletePopup.css',
  '/components/ChatDeletePopup.js',
  '/components/Notification.css',
  '/components/Notification.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
  'https://cdn.jsdelivr.net/npm/motion@11.11.13/dist/motion.js',
  'https://cdn.jsdelivr.net/npm/marked/marked.min.js',
  'https://cdn.jsdelivr.net/npm/graphology@0.25.1/dist/graphology.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/sigma.js/2.4.0/sigma.min.js'
];

// Install Service Worker and cache the core app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Pre-caching App Shell');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Clearing old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - handle requests
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. Bypass cache for backend API and health checks
  if (url.pathname.startsWith('/api/') || url.pathname === '/health' || event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }

  // 2. Handle navigation requests (SPA routing)
  // For pages like /overview, /chat, etc., serve the index.html from cache
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match('/index.html')
        .then(cachedResponse => {
          return cachedResponse || fetch(event.request);
        })
    );
    return;
  }

  // 3. Stale-While-Revalidate for other static assets
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        const fetchPromise = fetch(event.request)
          .then(networkResponse => {
            // Check if valid response
            if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, responseToCache);
              });
            }
            return networkResponse;
          })
          .catch(() => {
            // Offline fallback or error handling
            console.log('[Service Worker] Fetch failed, serving cached asset if available');
          });

        return cachedResponse || fetchPromise;
      })
  );
});
