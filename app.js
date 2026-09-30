import { STATUS_LABEL, UI_TEXT, scheduleStatus } from './src/domain/presentation.js';
import { LEAGUES, DEFAULT_ENABLED, NATIONAL_LEAGUES } from './config.js';
import { zhName } from './team-names.js';
import { CACHE_PREFIX, storage, dayKeyOf, parseDayKey, addDays, cachedDayMatches, monthsForDay, readCache, monthTtlMs, loadDay, ensureTeams, mapLimit, findNearbyMatchdays, ensureMonth } from './data.js';
import { UNKNOWN_TEAM_NAME, nameKeys, teamSideId, recordNames, recordNamed, recordMatches, mkFollowRecord, storedToRecord, unionRecord, recordNamesOverlap, mergeRecordList, migrateFollowed } from './src/domain/following.js';
import { searchKey, buildCatalog, searchScore, searchTeams } from './src/domain/catalog.js';
import { fmtTime, fmtDayLabel, fmtClock, weekdayOf, periodLabel, relativeLabel, countdownText, teamName, leagueZh } from './src/domain/format.js';

/* 页面控制器：偏好、加载、订阅、轮询。DOM 由 React 组件管理。 */
'use strict';

const LIVE_POLL_MS = 60e3;
const STRIP_LEN = 7;
const LS_ENABLED = 'fs1.enabled';
const LS_DAY = 'fs1.day';
const LS_FOLLOWED = 'fs1.followed';
const LS_VIEW = 'fs1.view';

/* 页面文案与显示时机见 docs/ui-copy.md。日/周视图共用同一套状态词。 */


function scheduleNotice(data) {
  const status = scheduleStatus(data, state.error, state.loading);
  if (status === 'updating' || status === 'ready') return '';
  if (state.error) return '暂时无法更新赛程，比赛时间和比分可能有变动。';
  if (status === 'stale') return '比赛时间和比分可能有变动，可刷新查看最新赛程。';
  const names = (data.failed || []).map(leagueZh).filter(Boolean).join('、');
  return `${names ? names + '赛程' : '部分赛程'}未能加载，可重新加载。`;
}

const state = {
  dayKey: null,
  windowStart: null,
  view: 'day',
  enabled: new Set(),
  followed: [],
  data: null,
  weekDays: null,
  nearby: null,
  preview: null,
  loading: false,
  error: null,
  followOpen: false,
  filtersOpen: Boolean(window.matchMedia?.('(min-width: 641px)').matches),
};

let liveTimer = null;
let loadSeq = 0;

/* 关注模型：fs1.followed 是“球队档案”数组，每条 { id, name, names, leagues }。
 * - names 存归一化名字（含 TEAM_ZH 别名键），是身份的权威来源；
 * - id 只是辅助：ESPN 可能复用 ID，已知名称的档案遇到同 ID 但名字不同 → 视为不同队；
 *   只有 id-only 的旧档案（还没观察到球队）才按 ID 命中；
 * - leagues 只作提示（空日预览），从不参与身份判定；
 * - isFollowed/matchHasFollowed 纯函数：渲染期间绝不写存储、不改状态，
 *   名称/ID 补全只发生在显式的 enrichFollowedFromMatches（数据加载路径）里。
 */
function loadFollowed() {
  try { return migrateFollowed(localStorage.getItem(LS_FOLLOWED)); } catch (e) { return []; }
}

/* 纯查询：无存储写入、无状态变更 */
function isFollowed(team) {
  if (!team) return false;
  if (!teamSideId(team) && !team.name) return false;
  return state.followed.some((rec) => recordMatches(rec, team));
}

function matchHasFollowed(m) {
  return !!m && (isFollowed(m.home) || isFollowed(m.away));
}

function isNationalFollow(rec) {
  return (rec.leagues || []).some((id) => NATIONAL_LEAGUES.includes(id));
}

function followedLeagues() {
  const out = new Set();
  for (const rec of state.followed) for (const lg of rec.leagues || []) out.add(lg);
  /* 从一场友谊赛关注国家队时，只知道当前赛事；同时查询其余国家队赛事，
     不依赖球队曾在其他赛事出场或名单是否包含它，避免漏掉预选赛/杯赛。
     这里只扩大查询范围，其他国家队仍遵守赛事筛选，不写入关注档案。 */
  if (NATIONAL_LEAGUES.some((id) => out.has(id))) {
    for (const id of NATIONAL_LEAGUES) out.add(id);
  }
  return [...out];
}

/* 关注球队可能在已关闭的联赛里比赛：抓取范围 = 启用联赛 ∪ 关注球队所在联赛；
 * 展示时关闭联赛只保留关注球队的比赛（进“我的关注”，不出现在联赛分组） */
function fetchLeagues() {
  return [...new Set([...state.enabled, ...followedLeagues()])];
}

function matchVisible(m) {
  return !!m && (state.enabled.has(m.league) || matchHasFollowed(m));
}

function visibleDay(r) {
  return r && r.matches ? { ...r, matches: r.matches.filter(matchVisible) } : r;
}

async function loadDayVisible(dayKey, opts = {}) {
  const { onUpdate, ...rest } = opts;
  const r = await loadDay(dayKey, {
    ...rest,
    leagues: fetchLeagues(),
    onUpdate: onUpdate ? (fresh) => onUpdate(visibleDay(fresh)) : undefined,
  });
  return visibleDay(r);
}

/* 观察到比赛时补全档案：写 ID/名字/别名/联赛，合并同 ID 重复项；只在数据路径调用 */
function enrichFollowedFromMatches(matches) {
  if (!state.followed.length || !matches || !matches.length) return false;
  let changed = false;
  for (const m of matches) {
    const league = m && m.league;
    for (const side of [m && m.home, m && m.away]) {
      if (!side) continue;
      const tid = teamSideId(side);
      const obsKnown = !!(side.name && side.name !== UNKNOWN_TEAM_NAME);
      if (!tid && !obsKnown) continue;
      const hits = state.followed.filter((rec) => recordMatches(rec, side));
      if (!hits.length) continue;
      const keys = obsKnown ? nameKeys(side) : [];
      for (const rec of hits) {
        if (tid && rec.id !== tid) { rec.id = tid; changed = true; }
        if (obsKnown && !rec.name) { rec.name = side.name; changed = true; }
        for (const k of keys) {
          if (!rec.names.includes(k)) { rec.names.push(k); changed = true; }
        }
        if (league && !rec.leagues.includes(league)) { rec.leagues.push(league); changed = true; }
      }
    }
  }
  if (changed) state.followed = mergeRecordList(state.followed);
  if (changed) {
    invalidateFollowNext();
    saveFollowed();
  }
  return changed;
}

function followChanged(opts = {}) {
  invalidateFollowNext();
  saveFollowed();
  publish();
  /* 空日关注变化要重算预览，但保留旧预览直到新结果就绪，避免键盘焦点丢失。 */
  // 国家队可来自搜索或已关闭的赛事，关注变化后立即按新范围重取当前日/周。
  if (opts.national || (state.data && !state.data.matches.length)) reload({ preservePreview: true });
}

function toggleFollow(team) {
  if (!team) return;
  const tid = teamSideId(team);
  const name = team.name && team.name !== UNKNOWN_TEAM_NAME ? team.name : null;
  if (!tid && !name) return;
  const national = [team.league, ...(team.leagues || [])].some((id) => NATIONAL_LEAGUES.includes(id))
    || state.followed.some((rec) => recordMatches(rec, team) && isNationalFollow(rec));
  const on = isFollowed(team);
  if (on) {
    /* 只移除与该队匹配的档案，不碰无关关注 */
    state.followed = state.followed.filter((rec) => !recordMatches(rec, team));
  } else {
    const leagues = team.leagues || (team.league ? [team.league] : []);
    state.followed.push(mkFollowRecord(tid, name, name ? nameKeys(team) : [], leagues));
  }
  followChanged({ national });
}

function unfollowAt(idx) {
  if (!Number.isInteger(idx) || idx < 0 || idx >= state.followed.length) return;
  const national = isNationalFollow(state.followed[idx]);
  state.followed.splice(idx, 1);
  followChanged({ national });
}

/* ---------- 球队搜索 ----------
 * 名单来自各联赛 `/teams`（data.js 缓存 7 天），按球队 ID 合并：一支球队出现在联赛与欧战里只算一条，
 * leagues 记下它所在的全部联赛——关注后 fetchLeagues 才会去抓它在已关闭联赛里的比赛。
 * 匹配面：中文名、英文全名/简称、常用简称（TEAM_SEARCH_ALIASES）。 */
const SEARCH_LIMIT = 8;
const search = { query: '', catalog: [], loading: false, loaded: false, failed: 0 };

/* 0 = 整词相同，1 = 前缀，2 = 包含；无命中返回 -1 */

let catalogPromise = null;

/* 首次聚焦/输入时才拉名单；每个联赛到达就刷新一次结果，慢联赛不挡住已到的。
   全部失败时清掉 promise，下次聚焦可重试 */
function loadCatalog() {
  if (search.loaded || catalogPromise) return catalogPromise;
  search.loading = true;
  search.failed = 0;
  const perLeague = [];
  catalogPromise = mapLimit(LEAGUES, 4, async (lg) => {
    const r = await ensureTeams(lg.id);
    if (r.failed) search.failed++;
    perLeague.push({ leagueId: lg.id, teams: r.teams, order: LEAGUES.indexOf(lg) });
    perLeague.sort((a, b) => a.order - b.order);
    search.catalog = buildCatalog(perLeague);
    publish();
  }).then(() => {
    search.loading = false;
    search.loaded = search.failed < LEAGUES.length;
    if (!search.loaded) catalogPromise = null;
    publish();
  });
  return catalogPromise;
}

function searchLeaguesText(entry) {
  return entry.leagues.map((id) => leagueZh(id) || id).join(' · ');
}

/* 未收录中文名的球队：console 提示（每个名字只提示一次），方便随时补进 team-names.js */
const reportedNames = new Set();

function reportMissingNames() {
  for (const m of (state.data ? state.data.matches : [])) {
    for (const s of [m.home, m.away]) {
      if (s && s.name && zhName(s.name) === s.name && !reportedNames.has(s.name)) {
        reportedNames.add(s.name);
        console.warn(`[赛程] 未收录中文名: ${s.name}（访问 tools/zh-coverage.html 可查全量）`);
      }
    }
  }
}

/* ---------- 状态存取 ---------- */

function loadEnabled() {
  try {
    const raw = localStorage.getItem(LS_ENABLED);
    const ids = raw ? JSON.parse(raw) : null;
    return new Set(Array.isArray(ids) && ids.length ? ids : DEFAULT_ENABLED);
  } catch (e) {
    return new Set(DEFAULT_ENABLED);
  }
}

function loadPrefs() {
  state.enabled = loadEnabled();
  state.followed = loadFollowed();
  invalidateFollowNext();
  const savedDay = (() => { try { return localStorage.getItem(LS_DAY); } catch (e) { return null; } })();
  const today = dayKeyOf(new Date());
  state.dayKey = savedDay && /^\d{4}-\d{2}-\d{2}$/.test(savedDay) ? savedDay : today;
  // 回访时若上次停留在很远的日期，回到今天
  if (Math.abs(parseDayKey(state.dayKey) - parseDayKey(today)) > 2 * 864e5) state.dayKey = today;
  state.windowStart = addDays(state.dayKey, -3);
  state.view = (() => { try { return localStorage.getItem(LS_VIEW) === 'week' ? 'week' : 'day'; } catch (e) { return 'day'; } })();
}

/* 按键写入：每次只写本次操作真正变化的那个偏好，避免另一页的 day/view 被顺手覆盖 */
function writePref(key, value) {
  try {
    if (localStorage.getItem(key) === value) return;
    localStorage.setItem(key, value);
  } catch (e) { /* 隐私模式等场景忽略 */ }
}

function saveFollowed() { writePref(LS_FOLLOWED, JSON.stringify(state.followed)); }
function saveEnabled() { writePref(LS_ENABLED, JSON.stringify([...state.enabled])); }
function saveDay() { writePref(LS_DAY, state.dayKey); }
function saveView() { writePref(LS_VIEW, state.view); }

/* 跨标签页：其他标签页写了 fs1.followed / fs1.enabled 时回读并重绘。
   只读不写、且只回读相关键——本处理函数绝不写任何偏好，避免把本标签页的旧值盖回去。 */
function onStorageEvent(e) {
  if (!e) return;
  const key = e.key;
  if (key !== null && key !== LS_FOLLOWED && key !== LS_ENABLED) return;
  const followedChanged = key === null || key === LS_FOLLOWED;
  const enabledChanged = key === null || key === LS_ENABLED;
  const nationalBefore = JSON.stringify(state.followed.filter(isNationalFollow));
  if (followedChanged) state.followed = loadFollowed();
  if (enabledChanged) state.enabled = loadEnabled();
  invalidateFollowNext();
  publish();
  if (enabledChanged) {
    state.data = null;
    state.weekDays = null;
    reload();
    return;
  }
  if (followedChanged && nationalBefore !== JSON.stringify(state.followed.filter(isNationalFollow))) {
    reload({ preservePreview: true });
    return;
  }
  /* 关注变化：空日预览可能要重算；有比赛的日期发布已覆盖 */
  if (state.data && !state.data.matches.length && !state.loading) enrichEmptyDay(loadSeq);
}

/* ---------- 日期与比赛状态 ---------- */

/* 日期条打点：缓存覆盖决定“确认无赛（off）”还是“未知（unk）”。
   fill/hollow：缓存里有比赛（无论覆盖是否完整）；off：启用联赛×覆盖月份全部有缓存且无比赛；
   unk：覆盖不足（含完全无缓存），不能声称当天没比赛。 */
/* 四种打点状态都给出明确文字，屏幕阅读器不必靠颜色/形状猜测（视觉不变） */
const DAY_DOT_TEXT = {
  fill: '有关注球队比赛',
  hollow: '有其他比赛',
  off: '无所选赛事比赛',
  unk: '赛程未知',
};

function dayDotState(dayKey) {
  const ms = cachedDayMatches(dayKey, fetchLeagues()).filter(matchVisible);
  if (ms.some(matchHasFollowed)) return 'fill';
  if (ms.length) return 'hollow';
  const months = monthsForDay(dayKey);
  const now = Date.now();
  let total = 0;
  let fresh = 0;
  for (const id of state.enabled) {
    for (const ym of months) {
      total += 1;
      const entry = readCache(id, ym);
      /* 过期缓存里的赛程可能已变更（补赛/改期），不能据此确认“无赛” */
      if (entry && now - (entry.fetchedAt || 0) < monthTtlMs(ym, entry)) fresh += 1;
    }
  }
  return total > 0 && fresh === total ? 'off' : 'unk';
}

/* 每分钟发布时钟更新，React 保留比赛行和焦点；仅在开赛或直播时刷新数据。 */
/* 已过开赛时间却仍是“未开赛”的比赛（页面在赛前打开并放置）：需要强制刷新才能进入直播。
   只看开赛后 3 小时内，延期/未更新的比赛不会永远轮询。 */
const KICKOFF_GRACE_MS = 3 * 3600e3;

function kickoffPassed() {
  const now = Date.now();
  return currentMatches().some((m) => {
    if (!m || m.status !== 'SCHEDULED') return false;
    const t = new Date(m.start).getTime();
    return Number.isFinite(t) && t <= now && now - t < KICKOFF_GRACE_MS;
  });
}

function refreshIfKickoffPassed() {
  if (document.hidden || state.loading || !kickoffPassed()) return;
  reload({ force: true });
}

function minuteTick() {
  invalidateFollowNext();
  publish();
  refreshIfKickoffPassed();
}

function scheduleCountdownTick() {
  countdownTimer = setTimeout(() => {
    if (!active) return;
    minuteTick();
    scheduleCountdownTick();
  }, 60000);
}

/* 面板赛程预览：只扫本地月缓存（零联网），仅在面板打开时计算，
   关注/数据/缓存变化后由 invalidateFollowNext() 失效重算 */
let followNextMemo = null;

function invalidateFollowNext() {
  followNextMemo = null;
}

/* 全部联赛的本地月缓存里未来的比赛（过去的一律排除，按开赛时间排序，按比赛 ID 去重） */
function cachedUpcomingMatches() {
  const now = Date.now();
  const byId = new Map();
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i) || '';
    if (!key.startsWith(`${CACHE_PREFIX}m|`)) continue;
    const parts = key.split('|');
    const entry = readCache(parts[2], parts[3]);
    if (!entry || !Array.isArray(entry.events)) continue;
    for (const m of entry.events) {
      if (m && new Date(m.start).getTime() > now && !byId.has(m.id)) byId.set(m.id, m);
    }
  }
  return [...byId.values()].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

function computeFollowNext() {
  const upcoming = cachedUpcomingMatches();
  return state.followed.map((rec) => upcoming.find((m) => recordMatches(rec, m.home) || recordMatches(rec, m.away)) || null);
}

/* 面板关着不计算；开着时用缓存好的结果 */
function followNextList() {
  if (!state.followOpen) return null;
  if (!followNextMemo) followNextMemo = computeFollowNext();
  return followNextMemo;
}

function followNextText(m) {
  if (!m) return '暂未查到赛程';
  const d = new Date(m.start);
  const when = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `赛程预览：${[when, leagueZh(m.league), `${teamName(m.home)} vs ${teamName(m.away)}`].filter(Boolean).join(' · ')}`;
}

/* 名称未知的旧 id-only 档案：诚实占位，不编造队名；观察到比赛后由补全逻辑填上 */
function followDisplayName(rec) {
  if (rec.name) return teamName(rec);
  if (rec.id) return '球队名称待补全';
  if (rec.names && rec.names.length) return `${rec.names[0]}（名称待确认）`;
  return '球队名称待补全';
}

function followMetaText(rec) {
  return (rec.leagues || []).map(leagueZh).filter(Boolean).join(' · ');
}

function toggleFollowPanel() {
  state.followOpen = !state.followOpen;
  invalidateFollowNext();
  publish();
}

/* ---------- 加载与轮询 ---------- */

/* 空日期的补全：找上/下一个比赛日与关注球队预览（网络慢时独立于首屏渲染）。
 * 关注球队可能来自被筛掉的联赛，故抓取/缓存用「启用 ∪ 已知关注联赛」并集只扫一遍；
 * 但 generic 的 prev/next 只按启用联赛计数（其他比赛遵守筛选语义），
 * 关注的 favPrev/favNext 按并集计数；预览加载：关注场次用并集，普通场次用启用联赛。 */
async function enrichEmptyDay(seq) {
  const enabled = [...state.enabled];
  const union = [...new Set([...enabled, ...followedLeagues()])];
  const nearby = await findNearbyMatchdays(state.dayKey, {
    leagues: union,
    genericLeagues: enabled,
    favLeagues: union,
    isFav: state.followed.length ? matchHasFollowed : null,
  });
  if (seq !== loadSeq) return;
  state.nearby = nearby;
  const f = nearby.favNext || nearby.favPrev;
  const g = nearby.next || nearby.prev;
  const target = f || g;
  const kind = f ? 'followed' : 'any';
  let preview = null;
  if (target) {
    const pv = await loadDay(target.dayKey, { leagues: kind === 'followed' ? union : enabled });
    if (seq !== loadSeq) return;
    enrichFollowedFromMatches(pv.matches);
    const rows = kind === 'followed' ? pv.matches.filter(matchHasFollowed) : pv.matches;
    preview = {
      dayKey: target.dayKey, kind, count: rows.length, total: pv.matches.length, matches: rows,
      partial: !!target.partial || !!pv.failed.length || !!pv.stale || !!pv.pending,
    };
  }
  state.preview = preview;
  invalidateFollowNext();
  publish();
}

async function reload(opts = {}) {
  if (state.view === 'week') return reloadWeek(opts);
  const seq = ++loadSeq;
  let earlyUpdate = null;
  let committed = false;
  state.loading = true;
  state.error = null;
  publish();
  try {
    const data = await loadDayVisible(state.dayKey, {
      force: opts.force,
      onUpdate: (fresh) => {
        /* 后台重验完成：静默替换为新数据 */
        if (seq !== loadSeq || state.dayKey !== fresh.dayKey) return;
        if (!committed) { earlyUpdate = fresh; return; }
        state.data = fresh;
        enrichFollowedFromMatches(fresh.matches);
        invalidateFollowNext();
        publish();
        if (!fresh.matches.length && !fresh.pending && (!state.nearby || opts.preservePreview)) enrichEmptyDay(seq);
        scheduleLivePoll();
      },
    });
    if (seq !== loadSeq) return;
    state.data = earlyUpdate && !earlyUpdate.pending && data.pending ? earlyUpdate : data;
    committed = true;
    enrichFollowedFromMatches(state.data.matches);
    invalidateFollowNext();
    if (!opts.preservePreview) {
      state.nearby = null;
      state.preview = null;
    }
    state.loading = false;
    publish(); /* 先出当日视图：空场面板不等就近搜索 */
    if (!state.data.pending && !state.data.matches.length) await enrichEmptyDay(seq);
  } catch (e) {
    if (seq !== loadSeq) return;
    state.error = (e && e.message) || '未知错误';
    state.loading = false;
    publish();
    return;
  }
  scheduleLivePoll();
  schedulePrefetch();
}

/* 周视图加载：并行取窗口内 7 天（数据层“联赛×月”缓存共享），单天失败不影响整周 */
async function reloadWeek(opts = {}) {
  const seq = ++loadSeq;
  const earlyUpdates = new Map();
  let committed = false;
  state.loading = true;
  state.error = null;
  publish();
  const keys = Array.from({ length: STRIP_LEN }, (_, i) => addDays(state.windowStart, i));
  try {
    const days = await mapLimit(keys, 3, async (key) => {
      try {
        const d = await loadDayVisible(key, {
          force: opts.force,
          onUpdate: (fresh) => {
            /* 后台重验完成：把该天替换为新数据 */
            if (seq !== loadSeq || state.view !== 'week') return;
            const updated = { dayKey: key, matches: fresh.matches, failed: fresh.failed, stale: fresh.stale, pending: fresh.pending, fetchedAt: fresh.fetchedAt };
            if (!committed) {
              earlyUpdates.set(key, updated);
              return;
            }
            const i = state.weekDays.findIndex((x) => x.dayKey === key);
            if (i < 0) return;
            state.weekDays[i] = updated;
            enrichFollowedFromMatches(fresh.matches);
            invalidateFollowNext();
            publish();
          },
        });
        return { dayKey: key, matches: d.matches, failed: d.failed, stale: d.stale, pending: d.pending, fetchedAt: d.fetchedAt };
      } catch (e) {
        return { dayKey: key, matches: [], failed: ['*'], error: true };
      }
    });
    if (seq !== loadSeq) return;
    state.weekDays = days.map((day) => {
      const early = earlyUpdates.get(day.dayKey);
      return early && !early.pending && day.pending ? early : day;
    });
    committed = true;
    enrichFollowedFromMatches(days.flatMap((d) => d.matches));
    invalidateFollowNext();
    state.loading = false;
    publish();
  } catch (e) {
    if (seq !== loadSeq) return;
    state.error = (e && e.message) || '未知错误';
    state.loading = false;
    publish();
    return;
  }
  scheduleLivePoll();
  schedulePrefetch();
}

function currentMatches() {
  return state.view === 'week'
    ? (state.weekDays || []).flatMap((d) => d.matches)
    : (state.data && state.data.matches) || [];
}

function scheduleLivePoll() {
  clearTimeout(liveTimer);
  if (!active || document.hidden) return;
  const hasLive = currentMatches().some((m) => m.live);
  if (hasLive) liveTimer = setTimeout(() => reload({ force: true }), LIVE_POLL_MS);
}

/* 预取日期条：把窗口 7 天涉及的「联赛×月份」全部暖机（数据层按月缓存，天然去重）。
   本次会话已失败的组合不再重复请求，避免导航时反复打失败接口。 */
let prefetchTimer = null;
const stripWarmFailed = new Set();

function warmStripMonths() {
  const pairs = new Set();
  for (let i = 0; i < STRIP_LEN; i++) {
    const key = addDays(state.windowStart, i);
    for (const ym of monthsForDay(key)) {
      for (const lg of fetchLeagues()) pairs.add(`${lg}|${ym}`);
    }
  }
  const list = [...pairs].filter((pair) => !stripWarmFailed.has(pair));
  /* mapLimit 限并发：跨月日期条最多 22+ 组合，不能一次性全部压向网络 */
  mapLimit(list, 6, async (pair) => {
    const idx = pair.indexOf('|');
    try {
      const r = await ensureMonth(pair.slice(0, idx), pair.slice(idx + 1));
      if (r && r.failed) { stripWarmFailed.add(pair); return false; } /* 真实抓取失败才记账；冷却期未尝试的下次再试 */
      return !!(r && r.data);
    } catch (e) {
      stripWarmFailed.add(pair);
      return false;
    }
  }).then((got) => {
    /* 暖机到手后统一刷新一次打点与面板缓存赛程，避免每个组合各绘一遍 */
    if (!got.some(Boolean)) return;
    invalidateFollowNext();
    publish();
  });
}

function schedulePrefetch() {
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(() => {
    if (!active || document.hidden) return;
    warmStripMonths();
  }, 1500);
}

function gotoDay(dayKey) {
  const prevStart = state.windowStart;
  state.dayKey = dayKey;
  const end = addDays(state.windowStart, STRIP_LEN - 1);
  if (dayKey < state.windowStart) state.windowStart = addDays(dayKey, -3);
  if (dayKey > end) state.windowStart = addDays(dayKey, 3 - STRIP_LEN + 1);
  saveDay();
  if (state.view === 'week') {
    publish();
    if (!state.weekDays || state.windowStart !== prevStart) reload();
    return;
  }
  state.data = null;
  publish();
  reload();
}

function setView(view) {
  if (state.view === view) return;
  state.view = view;
  saveView();
  if (view === 'week') {
    state.nearby = null;
    state.preview = null;
    state.weekDays = null;
  } else {
    state.data = null;
  }
  publish();
  reload();
}

// The controller owns data and user preferences. React subscribes to cached snapshots;
// reading a snapshot never mutates preferences or starts a request.
const listeners = new Set();
let snapshot;
let active = false;
let countdownTimer = null;
function publish() {
  snapshot = {
    ...state,
    enabled: new Set(state.enabled),
    followed: state.followed.map((rec) => ({ ...rec, names: [...rec.names], leagues: [...rec.leagues] })),
    weekDays: state.weekDays ? [...state.weekDays] : null,
    search: { ...search },
    followNext: followNextList(),
    now: Date.now(),
  };
  for (const listener of listeners) listener();
}
function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function getSnapshot() { return snapshot; }
function toggleLeague(id) {
  if (!LEAGUES.some((lg) => lg.id === id)) return;
  if (state.enabled.has(id)) state.enabled.delete(id);
  else state.enabled.add(id);
  if (!state.enabled.size) state.enabled.add(id);
  saveEnabled();
  publish();
  reload();
}
function toggleFilters() { state.filtersOpen = !state.filtersOpen; publish(); }
function setSearchQuery(query) {
  search.query = query;
  if (searchKey(query)) loadCatalog();
  publish();
}
function followSearchResult(id) {
  const entry = search.catalog.find((c) => c.id === id);
  if (entry) toggleFollow({ name: entry.name, teamId: entry.id, leagues: entry.leagues });
}
function onVisibilityChange() {
  if (document.hidden) clearTimeout(liveTimer);
  else if (currentMatches().some((m) => m.live) || kickoffPassed()) reload({ force: true });
}
function onOnline() {
  const d = state.data;
  if (!state.loading && (state.error || !d || !d.fetchedAt || d.pending || d.failed.length)) reload({ force: true });
}
function onKeyDown(e) {
  const t = e.target;
  if (e.altKey || e.ctrlKey || e.metaKey || (t && t.matches && !t.matches('body, [data-day]'))) return;
  let next = null;
  if (e.key === 'ArrowLeft') next = addDays(state.dayKey, -1);
  if (e.key === 'ArrowRight') next = addDays(state.dayKey, 1);
  if (e.key === 'Home' || e.key === 't' || e.key === 'T') next = dayKeyOf(new Date());
  if (!next) return;
  e.preventDefault();
  gotoDay(next);
  if (t?.matches?.('[data-day]')) requestAnimationFrame(() => {
    document.querySelector(`[data-day="${next}"]`)?.focus();
  });
}
function start() {
  if (active) return stop;
  active = true;
  window.addEventListener('storage', onStorageEvent);
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisibilityChange);
  document.addEventListener('keydown', onKeyDown);
  scheduleCountdownTick();
  reload();
  return stop;
}
function stop() {
  active = false;
  ++loadSeq;
  clearTimeout(liveTimer);
  clearTimeout(prefetchTimer);
  clearTimeout(countdownTimer);
  window.removeEventListener('storage', onStorageEvent);
  window.removeEventListener('online', onOnline);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  document.removeEventListener('keydown', onKeyDown);
}
loadPrefs();
publish();
export { subscribe, getSnapshot, start, stop, gotoDay, setView, reload, toggleLeague, toggleFilters,
  toggleFollow, unfollowAt, toggleFollowPanel, setSearchQuery, loadCatalog, followSearchResult,
  isFollowed, matchHasFollowed, dayDotState, followDisplayName, followMetaText, followNextText,
  scheduleStatus, scheduleNotice, UI_TEXT, STATUS_LABEL, DAY_DOT_TEXT, STRIP_LEN };
