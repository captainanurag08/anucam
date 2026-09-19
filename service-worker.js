/**
 * service-worker.js — app-shell caching only (spec section 37).
 *
 * This cache holds nothing but the static files needed to boot the UI
 * offline: HTML/CSS/JS and icons. It never touches IndexedDB and never
 * caches a captured photo or video — those live only in IndexedDB via
 * storage.js, which this file does not import or reference. The camera
 * itself still requires a live, secure connection (getUserMedia has no
 * offline mode); what offline support buys here is that the app's UI
 * opens and renders instead of showing a browser error page.
 *
 * Deliberately a classic (non-module) script for the widest browser
 * compatibility (spec section 40).
 */

const CACHE_NAME = 'anurag-camera-shell-v1';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/main.css',
  './css/camera.css',
  './css/controls.css',
  './css/gallery.css',
  './css/editor.css',
  './css/settings.css',
  './js/app.js',
  './js/camera.js',
  './js/capabilities.js',
  './js/capture.js',
  './js/controls.js',
  './js/editor.js',
  './js/gallery.js',
  './js/permissions.js',
  './js/settings.js',
  './js/storage.js',
  './js/ui.js',
  './js/workers/image-worker.js',
  './processing/align.js',
  './processing/analyzer.js',
  './processing/color.js',
  './processing/contrast.js',
  './processing/denoise.js',
  './processing/document.js',
  './processing/exposure.js',
  './processing/faceProtect.js',
  './processing/hdr.js',
  './processing/night.js',
  './processing/pipeline.js',
  './processing/portrait.js',
  './processing/resize.js',
  './processing/sharpen.js',
  './processing/toneMap.js',
  './processing/whiteBalance.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch((err) => {
        // If any single asset 404s, don't fail the whole install — a
        // partially-cached shell that falls back to network is better
        // than an app that never installs (spec section 52).
        console.warn('Service worker: some app-shell assets failed to precache', err);
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin GET requests for app-shell-type assets.
  // Everything else (camera streams are not fetch()-based, but any other
  // cross-origin or non-GET request) passes straight through to the
  // network untouched.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response && response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => {
          if (event.request.mode === 'navigate') return caches.match('./index.html');
          return new Response('Offline and not cached.', { status: 503, statusText: 'Offline' });
        });
    })
  );
});
