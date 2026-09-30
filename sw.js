/* PWA 应用壳缓存：只缓存同源页面/静态资源；远程赛程交给 data.js 判断离线与过期
 * file:// 打开时不会注册（无 Service Worker），功能不受影响
 */
'use strict';

const CACHE = 'football-schedule-shell-v11';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './config.js',
  './team-names.js',
  './data.js',
  './app.js',
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

  if (sameOrigin && new URL(req.url).pathname.endsWith('/snapshot/schedule.json')) {
    /* 赛程快照：网络优先（要的就是新数据），离线才回落上次的副本；不进 SHELL，避免装载时白拉 600KB */
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || Response.error()))
    );
    return;
  }

  if (sameOrigin) {
    /* 本地资源（页面/脚本/队徽）：缓存优先，后台更新 */
    e.respondWith(
      caches.match(req).then((hit) => {
        const net = fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          })
          .catch(() => hit);
        return hit || net;
      })
    );
    return;
  }
});
