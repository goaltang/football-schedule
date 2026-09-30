/* PWA 应用壳缓存：只缓存同源页面/静态资源；远程赛程交给 data.js 判断离线与过期
 * file:// 打开时不会注册（无 Service Worker），功能不受影响
 */
'use strict';

const CACHE = 'football-schedule-shell-v13';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './config.js?v=20260930-teams',
  './team-names.js?v=20260930-teams',
  './data.js?v=20260930-teams',
  './app.js?v=20260930-teams',
  './manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) =>
        k !== CACHE && (k === 'fs-shell-v1' || k.startsWith('football-schedule-shell-v'))
      ).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const sameOrigin = new URL(req.url).origin === self.location.origin;

  if (sameOrigin && /\/snapshot\/(?:schedule|teams)\.json$/.test(new URL(req.url).pathname)) {
    /* 赛程快照：网络优先（要的就是新数据），离线才回落上次的副本；不进 SHELL，避免装载时白拉 600KB */
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res.ok ? res : caches.match(req).then((hit) => hit || res);
        })
        .catch(() => caches.match(req).then((hit) => hit || Response.error()))
    );
    return;
  }

  if (sameOrigin) {
    /* 页面和脚本网络优先，避免手机长期运行旧数据逻辑；队徽等资源缓存优先。 */
    const url = new URL(req.url);
    const code = req.mode === 'navigate' || /\.(?:html|js|css)$/.test(url.pathname);
    e.respondWith(
      caches.match(req).then((hit) => {
        let timer;
        const net = fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)));
            }
            return res.ok ? res : hit || res;
          })
          .catch(() => hit || Response.error())
          .finally(() => clearTimeout(timer));
        e.waitUntil(net.then(() => {}));
        if (!code) return hit || net;
        if (!hit) return net;
        // 弱网下至多等 5 秒即回落已缓存应用，网络请求继续更新缓存。
        return Promise.race([net, new Promise((resolve) => {
          timer = setTimeout(() => resolve(hit), 5000);
        })]);
      })
    );
    return;
  }
});
