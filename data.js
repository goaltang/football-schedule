/* 数据层：ESPN 公开接口 + localStorage 缓存
 *
 * 关键点：ESPN scoreboard 的 dates=YYYYMMDD 按“美东日期”分桶
 * （实测 UTC 次日 00:30 的比赛仍归入前一天的桶），与本地日期不一致。
 * 因此取“本地某天”的赛程时：先算出覆盖本地 [00:00, 24:00) 的所有美东桶，
 * 拉取后按本地日期过滤，天然处理好跨时区早场/晚场。
 */
'use strict';

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const ET_ZONE = 'America/New_York';
const FETCH_TIMEOUT_MS = 15000;

const STATUS_BY_NAME = {
  STATUS_SCHEDULED: 'SCHEDULED',
  STATUS_DELAYED: 'DELAYED',
  STATUS_POSTPONED: 'POSTPONED',
  STATUS_CANCELED: 'CANCELLED',
  STATUS_SUSPENDED: 'SUSPENDED',
  STATUS_ABANDONED: 'SUSPENDED',
};

/* ---------- 日期工具（均以本机时区为准） ---------- */

function dayKeyOf(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDayKey(dayKey) {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(dayKey, n) {
  const d = parseDayKey(dayKey);
  d.setDate(d.getDate() + n);
  return dayKeyOf(d);
}

function etBucketOf(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}${get('month')}${get('day')}`;
}

/* 覆盖本地一天 [00:00, 24:00) 所需的全部美东桶 */
function bucketsForDay(dayKey) {
  const start = parseDayKey(dayKey);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  const keys = [etBucketOf(start), etBucketOf(new Date(end.getTime() - 1))];
  return [...new Set(keys)];
}

/* ---------- 缓存 ---------- */

const CACHE_PREFIX = 'fs1|';
const CACHE_MAX_ENTRIES = 80;

const memStore = new Map();
const storage = (() => {
  try {
    const k = '__fs_probe__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return window.localStorage;
  } catch (e) {
    return {
      getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
      setItem: (k, v) => memStore.set(k, v),
      removeItem: (k) => memStore.delete(k),
      key: (i) => [...memStore.keys()][i] ?? null,
      get length() { return memStore.size; },
    };
  }
})();

function cacheKey(leagueId, bucket) {
  return `${CACHE_PREFIX}${leagueId}|${bucket}`;
}

function readCache(leagueId, bucket) {
  try {
    const raw = storage.getItem(cacheKey(leagueId, bucket));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function writeCache(leagueId, bucket, data) {
  try {
    storage.setItem(cacheKey(leagueId, bucket), JSON.stringify(data));
    pruneCache();
  } catch (e) {
    /* 配额满或不可用：放弃缓存，不影响本次展示 */
  }
}

function pruneCache() {
  const entries = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && k.startsWith(CACHE_PREFIX)) {
      let t = 0;
      try { t = JSON.parse(storage.getItem(k)).fetchedAt || 0; } catch (e) { /* 坏条目直接淘汰 */ }
      entries.push([k, t]);
    }
  }
  if (entries.length <= CACHE_MAX_ENTRIES) return;
  entries.sort((a, b) => a[1] - b[1]);
  for (const [k] of entries.slice(0, entries.length - CACHE_MAX_ENTRIES)) storage.removeItem(k);
}

/* 缓存有效期：过去的比赛 6 小时（补赛/改期仍会更新），当天 10 分钟，未来 1 小时 */
function cacheTtlMs(dayKey) {
  const today = dayKeyOf(new Date());
  if (dayKey < today) return 6 * 3600e3;
  if (dayKey === today) return 10 * 60e3;
  return 3600e3;
}

/* ---------- 抓取与归一化 ---------- */

function fetchOnce(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { signal: ctrl.signal, cache: 'no-store' })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .finally(() => clearTimeout(timer));
}

/* 代理/弱网环境下偶发 SSL 与超时失败，重试 3 次 */
async function fetchJson(url) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetchOnce(url);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr;
}

function normalizeEvent(ev, leagueId) {
  const comp = (ev.competitions && ev.competitions[0]) || {};
  const side = (c) => ({
    name: (c.team && c.team.displayName) || '未知球队',
    logo: (c.team && ((c.team.logos && c.team.logos[0] && c.team.logos[0].href) || c.team.logo)) || '',
    score: c.score == null ? null : Number(c.score),
    winner: !!c.winner,
    homeAway: c.homeAway,
  });
  const home = comp.competitors ? comp.competitors.find((c) => c.homeAway === 'home') : null;
  const away = comp.competitors ? comp.competitors.find((c) => c.homeAway === 'away') : null;
  const st = ev.status || {};
  const type = st.type || {};
  let status = STATUS_BY_NAME[type.name];
  if (!status) status = type.state === 'in' ? 'LIVE' : type.state === 'post' ? 'FT' : 'SCHEDULED';
  return {
    id: String(ev.id),
    league: leagueId,
    start: ev.date,
    status,
    detail: type.detail || '',
    minute: status === 'LIVE' ? ((st.displayClock || '').replace(/\s+/g, '') || type.detail || '') : '',
    home: home ? side(home) : null,
    away: away ? side(away) : null,
    live: status === 'LIVE',
  };
}

function normalizeLeagueMeta(json, leagueId) {
  const lg = json.leagues && json.leagues[0];
  if (!lg) return { id: leagueId, logo: '' };
  const logos = lg.logos || [];
  const pick = logos.find((l) => (l.rel || []).includes('dark')) || logos[0];
  return { id: leagueId, logo: (pick && pick.href) || '' };
}

const inflight = new Map();

function fetchBucket(leagueId, bucket) {
  const key = cacheKey(leagueId, bucket);
  if (inflight.has(key)) return inflight.get(key);
  const p = fetchJson(`${ESPN_BASE}/${leagueId}/scoreboard?dates=${bucket}`)
    .then((json) => {
      const data = {
        fetchedAt: Date.now(),
        league: normalizeLeagueMeta(json, leagueId),
        events: (json.events || []).map((ev) => normalizeEvent(ev, leagueId)),
      };
      writeCache(leagueId, bucket, data);
      return { data, fromCache: false };
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    })
  );
  return out;
}

/* ---------- 对外：取某一天的赛程 ---------- */

async function loadDay(dayKey, opts = {}) {
  const leagues = opts.leagues || DEFAULT_ENABLED;
  const ttl = cacheTtlMs(dayKey);
  const jobs = [];
  for (const leagueId of leagues) {
    for (const bucket of bucketsForDay(dayKey)) jobs.push({ leagueId, bucket });
  }

  const failed = [];
  let fromCache = false;
  let fetchedAt = 0;
  const matches = new Map();
  const leagueMeta = new Map();

  await mapLimit(jobs, 6, async ({ leagueId, bucket }) => {
    const cached = readCache(leagueId, bucket);
    const fresh = cached && Date.now() - cached.fetchedAt < ttl;
    let res = null;
    if (opts.force || !fresh) {
      try {
        res = await fetchBucket(leagueId, bucket);
      } catch (e) {
        res = null;
      }
    }
    const data = res ? res.data : cached;
    if (res && res.fromCache) fromCache = true;
    if (!data) {
      failed.push(leagueId);
      return;
    }
    if (res === null) fromCache = true;
    fetchedAt = Math.max(fetchedAt, data.fetchedAt);
    leagueMeta.set(leagueId, data.league);
    for (const m of data.events) {
      if (dayKeyOf(new Date(m.start)) === dayKey) matches.set(m.id, m);
    }
  });

  const list = [...matches.values()].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return {
    dayKey,
    matches: list,
    leagueMeta,
    failed: [...new Set(failed)],
    fromCache,
    fetchedAt: fetchedAt || null,
  };
}
