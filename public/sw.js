const CACHE = 'void-studio-v3';
const cameraPage = '/cam/';
const shellUrls = ['/', cameraPage, '/launch.css', '/launch.js', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png',
  '/art/performer.webp', '/art/aperture.webp', '/art/dock.webp', '/art/wordmark.webp', '/art/portal-energy.webp'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(shellUrls);
    const html = await (await cache.match(cameraPage)).text();
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(match => match[1]);
    await cache.addAll(assets);
    const styles = await Promise.all(assets.filter(path => path.endsWith('.css')).map(async path => (await cache.match(path)).text()));
    const fonts = styles.flatMap(css => [...css.matchAll(/url\(["']?(\/assets\/[^)"']+\.woff2)["']?\)/g)].map(match => match[1]));
    await cache.addAll([...new Set(fonts)]);
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const versions = await caches.keys();
    await Promise.all(versions.filter(key => key.startsWith('void-studio-') && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/d/')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (request.mode !== 'navigate') {
      const cached = await cache.match(request, { ignoreVary: true });
      if (cached) return cached;
    }
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    } catch (error) {
      const page = url.pathname === '/cam' || url.pathname === '/cam/' ? cameraPage : '/';
      const fallback = await cache.match(request, { ignoreVary: true }) || (request.mode === 'navigate' && await cache.match(page));
      if (fallback) return fallback;
      throw error;
    }
  })());
});
