/* Loop service worker: Web Push + offline navigation fallback. */

const PAGE_CACHE = "loop-pages-v1";
const ASSET_CACHE = "loop-assets-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(ASSET_CACHE).then((c) => c.addAll(["/icons/icon-512.png"]))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/* ---- Push: fires even when every Loop tab/window is closed. ---- */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* non-JSON payload */
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Loop", {
      body: data.body || "",
      tag: data.tag || "loop",
      icon: "/icons/icon-512.png",
      badge: "/icons/icon-512.png",
      data: { url: data.url || "/app" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/app";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        for (const client of windows) {
          if ("focus" in client) return client.focus();
        }
        return self.clients.openWindow(url);
      })
  );
});

/* ---- Offline shell: network-first navigations with cache fallback. ---- */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(PAGE_CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() =>
          caches
            .match(req)
            .then((hit) => hit || caches.match("/app"))
            .then(
              (hit) =>
                hit ||
                new Response(
                  "<h1>Offline</h1><p>Loop will reconnect automatically.</p>",
                  { headers: { "Content-Type": "text/html" } }
                )
            )
        )
    );
    return;
  }

  // Static assets: cache-first.
  if (req.url.includes("/_next/static/") || req.url.includes("/icons/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(ASSET_CACHE).then((c) => c.put(req, copy));
            return res;
          })
      )
    );
  }
});
