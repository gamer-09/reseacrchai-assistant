// Service Worker - Minimal implementation to prevent 404 errors
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Let the network handle all requests
  event.respondWith(fetch(event.request));
});
