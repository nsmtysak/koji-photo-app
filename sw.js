/* ===========================================================
   工事写真台帳 — Service Worker
   最小オフラインキャッシュ（App Shell）
   キャッシュ名のバージョンを上げると古いキャッシュを破棄する。
   =========================================================== */

const CACHE_NAME = "koji-photo-app-v1";

const APP_SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

// インストール: App Shell を事前キャッシュ
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// 有効化: 古いキャッシュを削除
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// 取得: キャッシュ優先、無ければネットワーク（取得分は追記キャッシュ）
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // GET 以外はそのまま通す
  if (request.method !== "GET") return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          // 同一オリジンの正常応答のみキャッシュ
          if (
            response &&
            response.status === 200 &&
            response.type === "basic"
          ) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
