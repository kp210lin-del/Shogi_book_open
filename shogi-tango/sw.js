/* 将棋単語帳 Service Worker — アプリシェルを cache-first でオフライン化 */
const CACHE = "shogi-tango-v5";

const PIECE_KEYS = ["p", "l", "n", "s", "g", "b", "r", "k", "+p", "+l", "+n", "+s", "+b", "+r"];
const PIECE_ASSETS = [];
for (const side of ["sente", "gote"]) {
  for (const k of PIECE_KEYS) PIECE_ASSETS.push(`assets/pieces/${side}/${k}.png`);
}

const APP_SHELL = [
  ".",
  "index.html",
  "style.css",
  "app.js",
  "lib/shogi-board.js",
  "lib/shogi-board.css",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "assets/board/board_full.png",
  ...PIECE_ASSETS,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // 1件失敗で全体を落とさないよう個別に追加
      Promise.all(APP_SHELL.map((url) => cache.add(url).catch((e) => console.warn("cache add 失敗", url, e))))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        // 同一オリジンの GET 成功レスポンスのみキャッシュ追加
        if (res && res.ok && new URL(req.url).origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => {
        // オフラインかつ未キャッシュのナビゲーションは index.html を返す
        if (req.mode === "navigate") return caches.match("index.html", { ignoreSearch: true });
        return Response.error();
      });
    })
  );
});
