/* 数据层：ESPN 公开接口 + localStorage 缓存
 *
 * 拉取粒度是“月”：`?dates=YYYYMM` 一次返回整月赛程（按日/按月都按美东口径分桶）。
 * 本地某天可能横跨两个美东日，故先算覆盖本地 [00:00, 24:00) 的美东桶，再取对应月份，
 * 拉取后按本地日期过滤，天然处理好跨时区早场/晚场。
 * 按月拉还有个好处：整月比赛日一次全知，空日期的“最近的比赛”、日期条打点都不用逐天探测。
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
  return [...new Set([etBucketOf(start), etBucketOf(new Date(end.getTime() - 1))])];
}

/* 这些美东桶对应的月份（即需要拉取的月度数据） */
function monthsForDay(dayKey) {
  return [...new Set(bucketsForDay(dayKey).map((b) => b.slice(0, 6)))];
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

function cacheKey(leagueId, ym) {
  return `${CACHE_PREFIX}m|${leagueId}|${ym}`;
}

function readCache(leagueId, ym) {
  try {
    const raw = storage.getItem(cacheKey(leagueId, ym));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function writeCache(leagueId, ym, data) {
  try {
    storage.setItem(cacheKey(leagueId, ym), JSON.stringify(data));
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

/* 缓存有效期：过去的月份 24 小时（补赛/改期仍会更新），当月与未来 30 分钟 */
function monthTtlMs(ym) {
  const now = new Date();
  const cur = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  return ym < cur ? 24 * 3600e3 : 30 * 60e3;
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
    teamId: (c.team && c.team.id) ? String(c.team.id) : '',
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

function fetchMonth(leagueId, ym) {
  const key = cacheKey(leagueId, ym);
  if (inflight.has(key)) return inflight.get(key);
  const p = fetchJson(`${ESPN_BASE}/${leagueId}/scoreboard?dates=${ym}`)
    .then((json) => {
      const data = {
        fetchedAt: Date.now(),
        league: normalizeLeagueMeta(json, leagueId),
        events: (json.events || []).map((ev) => normalizeEvent(ev, leagueId)),
      };
      writeCache(leagueId, ym, data);
      return { data, fromCache: false };
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/* 取某联赛某月的数据：缓存新鲜则直接用，否则抓取（失败回落旧缓存） */
async function ensureMonth(leagueId, ym, allowFetch = true) {
  const cached = readCache(leagueId, ym);
  if (cached && Date.now() - cached.fetchedAt < monthTtlMs(ym)) return { data: cached, fromCache: true };
  if (!allowFetch) return { data: cached, fromCache: !!cached, failed: !cached };
  try {
    return await fetchMonth(leagueId, ym);
  } catch (e) {
    return { data: cached, fromCache: !!cached, failed: !cached };
  }
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

function mergeByLocalDay(eventsByLeague, dayKey) {
  const matches = new Map();
  for (const events of eventsByLeague) {
    for (const m of events) {
      if (dayKeyOf(new Date(m.start)) === dayKey) matches.set(m.id, m);
    }
  }
  return [...matches.values()].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

/* ---------- 对外：取某一天的赛程 ---------- */

async function loadDay(dayKey, opts = {}) {
  const leagues = opts.leagues || DEFAULT_ENABLED;
  const jobs = [];
  for (const leagueId of leagues) {
    for (const ym of monthsForDay(dayKey)) jobs.push({ leagueId, ym });
  }

  const failed = [];
  let fromCache = false;
  let fetchedAt = 0;
  const leagueEvents = [];
  const leagueMeta = new Map();

  await mapLimit(jobs, 6, async ({ leagueId, ym }) => {
    const r = await ensureMonth(leagueId, ym);
    if (!r.data) {
      failed.push(leagueId);
      return;
    }
    if (r.fromCache) fromCache = true;
    fetchedAt = Math.max(fetchedAt, r.data.fetchedAt);
    leagueMeta.set(leagueId, r.data.league);
    leagueEvents.push(r.data.events);
  });

  return {
    dayKey,
    matches: mergeByLocalDay(leagueEvents, dayKey),
    leagueMeta,
    failed: [...new Set(failed)],
    fromCache,
    fetchedAt: fetchedAt || null,
  };
}

/* ---------- 对外：只读缓存，不发请求 ---------- */

function cachedDayMatches(dayKey, leagueIds) {
  const leagueEvents = [];
  for (const leagueId of leagueIds) {
    for (const ym of monthsForDay(dayKey)) {
      const d = readCache(leagueId, ym);
      if (d) leagueEvents.push(d.events);
    }
  }
  return mergeByLocalDay(leagueEvents, dayKey);
}

/* ---------- 对外：空日期时找最近的比赛日 ----------
 * 由近及远双向探测；每个月首次会真正抓取（受 maxMonths 预算约束），之后全走缓存。
 * opts.matchFilter：只认满足条件的比赛（如“含关注球队”），用于优先跳到关注球队的比赛日
 */
async function findNearbyMatchdays(dayKey, opts = {}) {
  const leagues = opts.leagues || DEFAULT_ENABLED;
  const matchFilter = opts.matchFilter || null;
  const maxMonths = opts.maxMonths ?? 4;
  const maxDays = opts.maxDays ?? 200;
  const result = { prev: null, next: null };

  for (const dir of [-1, 1]) {
    let budget = maxMonths;
    for (let step = 1; step <= maxDays; step++) {
      const cand = addDays(dayKey, dir * step);
      const months = monthsForDay(cand);
      let fetched = false;
      for (const ym of months) {
        const hasAll = leagues.every((id) => readCache(id, ym));
        if (!hasAll && budget > 0) {
          await mapLimit(leagues.map((leagueId) => ({ leagueId, ym })), 6, ({ leagueId }) => ensureMonth(leagueId, ym));
          fetched = true;
        }
      }
      if (fetched) budget--;
      const all = cachedDayMatches(cand, leagues);
      const count = matchFilter ? all.filter(matchFilter).length : all.length;
      if (count > 0) {
        result[dir === 1 ? 'next' : 'prev'] = { dayKey: cand, count };
        break;
      }
    }
  }
  return result;
}
