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

const cacheMemo = new Map();

function readCache(leagueId, ym) {
  const key = cacheKey(leagueId, ym);
  if (cacheMemo.has(key)) return cacheMemo.get(key);
  let val = null;
  try {
    const raw = storage.getItem(key);
    val = raw ? JSON.parse(raw) : null;
  } catch (e) {
    val = null;
  }
  cacheMemo.set(key, val);
  return val;
}

function writeCache(leagueId, ym, data) {
  const key = cacheKey(leagueId, ym);
  cacheMemo.set(key, data);
  try {
    storage.setItem(key, JSON.stringify(data));
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
      const ym = k.split('|')[3] || '';
      let t = 0;
      try { t = JSON.parse(storage.getItem(k)).fetchedAt || 0; } catch (e) { /* 坏条目直接淘汰 */ }
      /* 淘汰顺序：先踢离当前月最远的（和今天关系最小），同距离再踢最旧抓取的；
         旧格式键（解析不出月份）视为最远，顺带清理 */
      entries.push([k, { t, d: /^\d{6}$/.test(ym) ? monthDistance(ym) : 9999 }]);
    }
  }
  if (entries.length <= CACHE_MAX_ENTRIES) return;
  entries.sort((a, b) => (b[1].d - a[1].d) || (a[1].t - b[1].t));
  for (const [k] of entries.slice(0, entries.length - CACHE_MAX_ENTRIES)) {
    storage.removeItem(k);
    cacheMemo.delete(k);
  }
}

function monthDistance(ym) {
  const now = new Date();
  const cur = now.getFullYear() * 12 + now.getMonth();
  return Math.abs(Number(ym.slice(0, 4)) * 12 + Number(ym.slice(4, 6)) - 1 - cur);
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

/* 网络熔断：短时间连败后进入冷却期，抓取快速失败回落缓存，避免弱网下长时间空转 */
let netFailStreak = 0;
let netCooldownUntil = 0;

function noteNetResult(ok) {
  if (ok) {
    netFailStreak = 0;
    return;
  }
  netFailStreak++;
  if (netFailStreak >= 4) {
    netCooldownUntil = Date.now() + 30e3;
    netFailStreak = 0;
  }
}

function networkCoolingDown() {
  return Date.now() < netCooldownUntil;
}

function fetchMonth(leagueId, ym) {
  const key = cacheKey(leagueId, ym);
  if (inflight.has(key)) return inflight.get(key);
  const p = fetchJson(`${ESPN_BASE}/${leagueId}/scoreboard?dates=${ym}`)
    .then((json) => {
      noteNetResult(true);
      const data = {
        fetchedAt: Date.now(),
        league: normalizeLeagueMeta(json, leagueId),
        events: (json.events || []).map((ev) => normalizeEvent(ev, leagueId)),
      };
      writeCache(leagueId, ym, data);
      return { data, fromCache: false };
    })
    .catch((err) => {
      noteNetResult(false);
      throw err;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/* 取某联赛某月的数据：缓存新鲜则直接用，否则抓取（失败回落旧缓存）
 * opts.force：无视缓存新鲜度强制抓取（刷新按钮 / 直播轮询）
 * opts.cacheOnly：只读缓存不发网络（stale-while-revalidate 的第一步）
 */
async function ensureMonth(leagueId, ym, opts = {}) {
  const cached = readCache(leagueId, ym);
  const fresh = !!cached && Date.now() - cached.fetchedAt < monthTtlMs(ym);
  if (fresh && !opts.force) return { data: cached, fromCache: true, stale: false };
  /* 冷却期或只读模式：不发网络（force 可穿透冷却） */
  if (opts.cacheOnly || (networkCoolingDown() && !opts.force)) {
    return { data: cached, fromCache: !!cached, stale: true, missing: !cached };
  }
  try {
    return await fetchMonth(leagueId, ym);
  } catch (e) {
    return { data: cached, fromCache: !!cached, stale: !!cached, failed: !cached };
  }
}

/* ---------- 球队名单（仅供“搜索球队”使用） ----------
 * 每联赛一份 `/teams`，与赛程月缓存分开存（前缀 fs1t|），不参与赛程缓存的淘汰；
 * 名单一个赛季内几乎不变，缓存 7 天，抓取失败回落旧缓存。 */

const TEAMS_PREFIX = 'fs1t|';
const TEAMS_TTL_MS = 7 * 24 * 3600e3;

const teamsMemo = new Map();

function normalizeTeamEntry(t) {
  if (!t || t.id == null || !t.displayName) return null;
  return {
    id: String(t.id),
    name: t.displayName,
    short: t.shortDisplayName && t.shortDisplayName !== t.displayName ? t.shortDisplayName : '',
    logo: (t.logos && t.logos[0] && t.logos[0].href) || t.logo || '',
  };
}

function readTeamsCache(leagueId) {
  if (teamsMemo.has(leagueId)) return teamsMemo.get(leagueId);
  let val = null;
  try {
    const raw = storage.getItem(TEAMS_PREFIX + leagueId);
    val = raw ? JSON.parse(raw) : null;
    if (!val || !Array.isArray(val.teams)) val = null;
  } catch (e) {
    val = null;
  }
  teamsMemo.set(leagueId, val);
  return val;
}

function writeTeamsCache(leagueId, data) {
  teamsMemo.set(leagueId, data);
  try {
    storage.setItem(TEAMS_PREFIX + leagueId, JSON.stringify(data));
  } catch (e) {
    /* 配额满或不可用：只保留内存副本 */
  }
}

function fetchTeams(leagueId) {
  const key = `teams|${leagueId}`;
  if (inflight.has(key)) return inflight.get(key);
  const p = fetchJson(`${ESPN_BASE}/${leagueId}/teams`)
    .then((json) => {
      noteNetResult(true);
      const lg = json.sports && json.sports[0] && json.sports[0].leagues && json.sports[0].leagues[0];
      const teams = ((lg && lg.teams) || []).map((x) => normalizeTeamEntry(x && x.team)).filter(Boolean);
      const data = { fetchedAt: Date.now(), teams };
      /* 空名单不覆盖旧缓存（接口偶发返回空壳） */
      if (teams.length) writeTeamsCache(leagueId, data);
      return teams.length ? data : null;
    })
    .catch((err) => {
      noteNetResult(false);
      throw err;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/* 取某联赛球队名单 → { teams, stale, failed }；缓存新鲜直接用，冷却期不发网络 */
async function ensureTeams(leagueId, opts = {}) {
  const cached = readTeamsCache(leagueId);
  const fresh = !!cached && Date.now() - cached.fetchedAt < TEAMS_TTL_MS;
  if (fresh && !opts.force) return { teams: cached.teams, stale: false, failed: false };
  const fallback = () => ({ teams: cached ? cached.teams : [], stale: !!cached, failed: !cached });
  if (networkCoolingDown() && !opts.force) return fallback();
  try {
    const data = await fetchTeams(leagueId);
    return data ? { teams: data.teams, stale: false, failed: false } : fallback();
  } catch (e) {
    return fallback();
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

/* ---------- 对外：取某一天的赛程 ----------
 * stale-while-revalidate：本地有缓存就立刻返回（哪怕过期），网络重验放后台，
 * 刷新完成后通过 opts.onUpdate 回调新数据；完全无缓存时才等待网络。
 * opts.force：强制联网取新（刷新按钮 / 直播轮询），此时同步等待结果
 */
async function collectView(dayKey, jobs, policy) {
  const matches = new Map();
  const leagueMeta = new Map();
  const missing = new Set();
  let fromCache = false;
  let fetchedAt = 0;
  let stale = false;

  await mapLimit(jobs, 6, async ({ leagueId, ym }) => {
    const r = await ensureMonth(leagueId, ym, policy);
    if (r.stale) stale = true;
    if (!r.data) {
      missing.add(leagueId);
      return;
    }
    if (r.fromCache) fromCache = true;
    fetchedAt = Math.max(fetchedAt, r.data.fetchedAt);
    leagueMeta.set(leagueId, r.data.league);
    for (const m of r.data.events) {
      if (dayKeyOf(new Date(m.start)) === dayKey) matches.set(m.id, m);
    }
  });

  return {
    dayKey,
    matches: [...matches.values()].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0)),
    leagueMeta,
    failed: [...missing],
    fromCache,
    fetchedAt: fetchedAt || null,
    stale,
  };
}

async function loadDay(dayKey, opts = {}) {
  const leagues = opts.leagues || DEFAULT_ENABLED;
  const jobs = [];
  for (const leagueId of leagues) {
    for (const ym of monthsForDay(dayKey)) jobs.push({ leagueId, ym });
  }

  const instant = await collectView(dayKey, jobs, { cacheOnly: true, force: opts.force });
  const needsNetwork = opts.force || instant.stale || !instant.fetchedAt;
  if (!needsNetwork) return instant;

  const refresh = () => collectView(dayKey, jobs, { force: opts.force });
  if (instant.fetchedAt && !opts.force) {
    refresh()
      .then((fresh) => { if (opts.onUpdate) opts.onUpdate(fresh); })
      .catch(() => { /* 后台刷新失败：保留缓存视图 */ });
    return { ...instant, failed: [], pending: true };
  }
  /* 无缓存：限时等待网络，超时先返回“尚无数据”视图，抓取继续在后台完成 */
  const deadline = opts.deadline ?? 25e3;
  const pending = refresh();
  const bounded = await Promise.race([
    pending,
    new Promise((resolve) => setTimeout(() => resolve(null), deadline)),
  ]);
  if (bounded) return bounded;
  pending
    .then((fresh) => { if (opts.onUpdate) opts.onUpdate(fresh); })
    .catch(() => { /* 后台刷新失败：保持当前视图 */ });
  return { ...instant, failed: [], pending: true };
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
 * 一次由近及远双向扫描，同时给出全量与“关注球队”的最近比赛日；
 * 缺失月份各只尝试一次抓取（受 maxMonths 与熔断约束），失败后仍扫描已有缓存；
 * 跨过数据不完整的月份所找到的候选仅代表缓存范围内最近。
 *
 * 联赛分层（可选，均默认 opts.leagues 以兼容旧调用）：
 * - opts.leagues        ：扫描+抓取的联赛集合（缓存读取与网络请求只走这一遍，不重复抓）
 * - opts.genericLeagues  ：prev/next 的计数联赛（如“其他比赛只按启用联赛”语义）
 * - opts.favLeagues      ：favPrev/favNext 的计数联赛（关注球队可来自并集/被关闭联赛）
 */
async function findNearbyMatchdays(dayKey, opts = {}) {
  const scanLeagues = opts.leagues || DEFAULT_ENABLED;
  const genericLeagues = opts.genericLeagues || opts.leagues || DEFAULT_ENABLED;
  const favLeagues = opts.favLeagues || opts.leagues || DEFAULT_ENABLED;
  const isFav = opts.isFav || null;
  const favMaxDays = opts.favMaxDays ?? 60;
  const maxMonths = opts.maxMonths ?? 4;
  const maxDays = opts.maxDays ?? 90;
  const result = { prev: null, next: null, favPrev: null, favNext: null };

  const attemptedMonths = new Set();
  for (const dir of [-1, 1]) {
    const k = dir === 1 ? 'next' : 'prev';
    const fk = dir === 1 ? 'favNext' : 'favPrev';
    let budget = maxMonths;
    let failedWaves = 0;
    let genericPartial = false;
    let favPartial = false;
    for (let step = 1; step <= maxDays; step++) {
      const cand = addDays(dayKey, dir * step);
      for (const ym of monthsForDay(cand)) {
        const missingLeagues = scanLeagues.filter((id) => !readCache(id, ym));
        if (missingLeagues.length && budget > 0 && failedWaves < 2 && !attemptedMonths.has(ym)) {
          attemptedMonths.add(ym);
          budget--;
          await mapLimit(missingLeagues, 6, (leagueId) => ensureMonth(leagueId, ym));
          failedWaves = missingLeagues.some((id) => readCache(id, ym)) ? 0 : failedWaves + 1;
        }
        if (genericLeagues.some((id) => !readCache(id, ym))) genericPartial = true;
        if (favLeagues.some((id) => !readCache(id, ym))) favPartial = true;
      }
      /* 网络失败只停止后续抓取；仍须扫描已缓存的远处月份 */
      const generic = cachedDayMatches(cand, genericLeagues);
      if (!result[k] && generic.length) result[k] = { dayKey: cand, count: generic.length, ...(genericPartial ? { partial: true } : {}) };
      if (isFav && !result[fk] && step <= favMaxDays) {
        const favSrc = genericLeagues === favLeagues ? generic : cachedDayMatches(cand, favLeagues);
        const favN = favSrc.reduce((n, m) => n + (isFav(m) ? 1 : 0), 0);
        if (favN) result[fk] = { dayKey: cand, count: favN, ...(favPartial ? { partial: true } : {}) };
      }
      /* 全量已找到，且（无需找关注 / 关注已找到 / 关注搜索超界）即收工 */
      if (result[k] && (!isFav || result[fk] || step > favMaxDays)) break;
    }
  }
  return result;
}
