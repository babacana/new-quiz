const CACHE_NAME = 'new-quiz-shell-v1';
const BUILD_ASSETS = [];
const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.ico',
  '/assets/logo.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  ...BUILD_ASSETS,
];

function cacheResponse(cacheKey, response) {
  const copy = response.clone();
  void caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, copy));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_URLS)),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Permite que o cliente aplique a nova versão do Service Worker assim que estiver ocioso.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            cacheResponse('/index.html', response);
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match('/index.html');
          return cached || (await caches.match('/')) || Response.error();
        }),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            cacheResponse(request, response);
          }
          return response;
        })
        .catch(() => Response.error());
    }),
  );
});
