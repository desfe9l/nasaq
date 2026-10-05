// NASAQ Offline — App Shell Service Worker
// Caches the application shell and required static assets so the app can launch offline.
// Versioned cache names ensure updates don't serve stale shells.

const CACHE_VERSION = "nasaq-shell-v2";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const FONT_CACHE = `${CACHE_VERSION}-fonts`;

// Shell assets to precache on install. Vite hashes assets, but we cache the
// shell URLs that are stable: document, manifest, icons, core css/js will be
// added dynamically on fetch.
const PRECACHE_URLS = [
  "/",
  "/manifest.webmanifest",
  "/nasaq-mark.svg",
  "/icons/nasaq-192.png",
  "/icons/nasaq-512.png",
  "/icons/nasaq-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      cache.addAll(PRECACHE_URLS.map((u) => new Request(u, { cache: "reload" }))).catch(() => undefined)
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

function isDocumentRequest(request) {
  return request.mode === "navigate" || (request.method === "GET" && request.headers.get("accept")?.includes("text/html"));
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/__grok/") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".woff2") ||
    url.pathname.endsWith(".woff") ||
    url.pathname.match(/\.(png|jpg|jpeg|svg|webp|avif)$/)
  );
}

function isFontRequest(url) {
  return url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
}

function isApiRequest(url) {
  return url.pathname.startsWith("/api/") || url.pathname.startsWith("/__grok/");
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Never intercept cross-origin except fonts
  if (url.origin !== self.location.origin && !isFontRequest(url)) return;

  // Fonts: cache-first, long-lived
  if (isFontRequest(url)) {
    event.respondWith(
      caches.open(FONT_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const res = await fetch(request);
          if (res.ok) cache.put(request, res.clone());
          return res;
        } catch {
          return cached || Response.error();
        }
      })
    );
    return;
  }

  // API: network-first, never cache (but fallback to offline shell for documents)
  if (isApiRequest(url)) {
    event.respondWith(
      fetch(request).catch(() => {
        // Offline: return a JSON offline sentinel so UI can detect and use cache
        return new Response(JSON.stringify({ ok: false, offline: true, error: "offline" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      })
    );
    return;
  }

  // Documents: network-first with cache fallback to shell
  if (isDocumentRequest(request)) {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request);
          const cache = await caches.open(SHELL_CACHE);
          cache.put(request, res.clone()).catch(() => undefined);
          return res;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          const cached = await cache.match(request);
          if (cached) return cached;
          // Fallback to root shell for SPA routing offline
          const root = await cache.match("/");
          if (root) return root;
          return new Response("<h1>Offline</h1><p>NASAQ requires offline cache. Reconnect to sync.</p>", {
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }
      })()
    );
    return;
  }

  // Static assets: cache-first with network update
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const networkPromise = fetch(request)
          .then((res) => {
            if (res.ok) cache.put(request, res.clone()).catch(() => undefined);
            return res;
          })
          .catch(() => null);
        return cached || (await networkPromise) || new Response("", { status: 504 });
      })
    );
    return;
  }

  // Default: stale-while-revalidate
  event.respondWith(
    caches.open(RUNTIME_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const fetchPromise = fetch(request)
        .then((res) => {
          if (res.ok) cache.put(request, res.clone()).catch(() => undefined);
          return res;
        })
        .catch(() => null);
      if (cached) {
        fetchPromise.catch(() => undefined);
        return cached;
      }
      const net = await fetchPromise;
      return net || new Response("", { status: 503 });
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "GET_VERSION") event.ports?.[0]?.postMessage({ version: CACHE_VERSION });
});
