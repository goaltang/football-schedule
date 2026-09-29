/* 界面层：日期切换、联赛筛选、赛程渲染、直播自动刷新 */
'use strict';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const STATUS_LABEL = {
  SCHEDULED: '未开赛',
  LIVE: '直播',
  FT: '完场',
  POSTPONED: '延期',
  CANCELLED: '取消',
  SUSPENDED: '中断',
  DELAYED: '延迟',
};
const LIVE_POLL_MS = 60e3;
const STRIP_LEN = 7;
const LS_ENABLED = 'fs1.enabled';
const LS_DAY = 'fs1.day';
const LS_FOLLOWED = 'fs1.followed';
const LS_VIEW = 'fs1.view';

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
};

let liveTimer = null;
let loadSeq = 0;

/* ---------- 工具 ---------- */

const $ = (sel) => document.querySelector(sel);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function teamName(t) {
  return (t && zhName(t.name)) || (t && t.name) || '';
}

function leagueZh(leagueId) {
  return (LEAGUES.find((l) => l.id === leagueId) || {}).zh || '';
}

/* 队徽/联赛标走 ESPN 缩略图服务：500px 原图 130KB 且缓存仅 ~2h，
   64px 缩略图约 6KB 且缓存 24h，显示尺寸只有 28px，没必要下原图 */
function smallLogo(url) {
  const m = /^https?:\/\/a\.espncdn\.com(\/.+)$/.exec(url || '');
  return m ? `https://a.espncdn.com/combiner/i?img=${m[1]}&w=64&h=64` : url;
}

/* 图标加载链：本地 logos/（随项目分发，0 网络）→ 缩略图 → 原图 → 隐藏 */
function imgFallback(img) {
  const rest = (img.dataset.fb || '').split('|').filter(Boolean);
  if (rest.length) {
    img.dataset.fb = rest.slice(1).join('|');
    img.src = rest[0];
  } else {
    img.classList.add('broken');
  }
}

function logoImg(t, size) {
  const px = size || 28;
  if (!t || (!t.logo && !t.teamId)) return `<span class="logo ghost" style="width:${px}px;height:${px}px"></span>`;
  const chain = [];
  if (t.teamId) chain.push(`logos/${t.teamId}.png`);
  if (t.logo) chain.push(smallLogo(t.logo), t.logo);
  return (
    `<img class="logo" src="${esc(chain[0])}" data-fb="${esc(chain.slice(1).join('|'))}" ` +
    `width="${px}" height="${px}" decoding="async" loading="lazy" alt="" onerror="imgFallback(this)">`
  );
}

function crestImg(lgId, url) {
  const chain = [`logos/lg-${lgId}.png`, smallLogo(url), url].filter(Boolean);
  return (
    `<img class="crest" src="${esc(chain[0])}" data-fb="${esc(chain.slice(1).join('|'))}" ` +
    `width="18" height="18" decoding="async" loading="lazy" alt="" onerror="imgFallback(this)">`
  );
}

/* 关注模型：fs1.followed 是“球队档案”数组，每条 { id, name, names, leagues }。
 * - names 存归一化名字（含 TEAM_ZH 别名键），是身份的权威来源；
 * - id 只是辅助：ESPN 可能复用 ID，已知名称的档案遇到同 ID 但名字不同 → 视为不同队；
 *   只有 id-only 的旧档案（还没观察到球队）才按 ID 命中；
 * - leagues 只作提示（导出/空日预览），从不参与身份判定；
 * - isFollowed/matchHasFollowed 纯函数：渲染期间绝不写存储、不改状态，
 *   名称/ID 补全只发生在显式的 enrichFollowedFromMatches（数据加载路径）里。
 */
const UNKNOWN_TEAM_NAME = '未知球队'; /* 数据层 normalizeEvent 的占位名，不算有效身份 */

const aliasesByName = new Map();
for (const [name, zh] of Object.entries(TEAM_ZH)) {
  if (!aliasesByName.has(zh)) aliasesByName.set(zh, new Set());
  aliasesByName.get(zh).add(normalizeTeamName(name));
}

function nameKeys(team) {
  const key = normalizeTeamName(team.name);
  const zh = zhName(team.name);
  return zh === team.name ? [key] : [...(aliasesByName.get(zh) || []), key];
}

function teamSideId(team) {
  return team && team.teamId != null && team.teamId !== '' ? String(team.teamId) : null;
}

function recordNames(rec) {
  const set = new Set(rec.names || []);
  if (rec.name && rec.name !== UNKNOWN_TEAM_NAME) set.add(normalizeTeamName(rec.name));
  return set;
}

function recordNamed(rec) {
  return !!((rec.name && rec.name !== UNKNOWN_TEAM_NAME) || (rec.names && rec.names.length));
}

function recordMatches(rec, team) {
  const tid = teamSideId(team);
  if (recordNamed(rec)) {
    /* 观察到真实队名：名字说了算——同名不同 ID 也跟随（ID 变更），
       同 ID 但队名明显不同则不跟随（ESPN 复用 ID） */
    const obsKnown = !!(team.name && team.name !== UNKNOWN_TEAM_NAME);
    if (obsKnown) {
      const keys = nameKeys(team);
      const recKeys = recordNames(rec);
      return keys.some((k) => recKeys.has(k));
    }
    /* 观察不到有效名字（占位/缺失）：无冲突证据，退回 ID */
    return !!tid && !!rec.id && rec.id === tid;
  }
  /* 旧 id-only 档案：名称未知，只能按 ID */
  return !!tid && !!rec.id && rec.id === tid;
}

function mkFollowRecord(id, name, names, leagues) {
  return {
    id: id != null && id !== '' ? String(id) : null,
    name: name || null,
    names: [...new Set((names || []).filter(Boolean))],
    leagues: [...new Set((leagues || []).filter(Boolean))],
  };
}

function storedToRecord(item) {
  if (typeof item === 'string') {
    if (!item) return null;
    if (item.startsWith('id:')) return mkFollowRecord(item.slice(3), null, [], []);
    const name = item.startsWith('name:') ? item.slice(5) : item;
    return name ? mkFollowRecord(null, null, [name], []) : null;
  }
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const names = Array.isArray(item.names) ? item.names : [];
    const leagues = Array.isArray(item.leagues) ? item.leagues : [];
    const rec = mkFollowRecord(item.id, item.name, names, leagues);
    return rec.id || rec.name || rec.names.length ? rec : null;
  }
  return null;
}

function unionRecord(target, src) {
  if (!target.name && src.name) target.name = src.name;
  if (!target.id && src.id) target.id = src.id;
  for (const k of src.names) if (!target.names.includes(k)) target.names.push(k);
  for (const l of src.leagues) if (!target.leagues.includes(l)) target.leagues.push(l);
}

/* 同名判定按已知别名放宽：zhName 相同即同队（Inter Milan / Internazionale） */
function recordNamesOverlap(a, b) {
  const ka = recordNames(a);
  const kb = recordNames(b);
  if (!ka.size || !kb.size) return false;
  const zhA = new Set([...ka].map((k) => zhName(k)));
  for (const k of kb) if (zhA.has(zhName(k))) return true;
  return false;
}

function mergeRecordList(list) {
  const out = [];
  for (const rec of list) {
    const recIsNamed = recordNamed(rec);
    /* 按 ID 合并仅限至少一侧未具名：两条已知名字却同 ID 是 ESPN 复用 ID 的不同球队，
       与 recordMatches 的 ID-reuse guard 保持一致，绝不并成一条 */
    let target = rec.id ? out.find((r) => r.id === rec.id && (!recIsNamed || !recordNamed(r))) : null;
    if (!target) target = out.find((r) => recordNamesOverlap(r, rec));
    if (target) unionRecord(target, rec);
    else out.push(rec);
  }
  return out;
}

/* 旧 fs1.followed：JSON 字符串数组（`id:X` / `name:X` / 裸名字），
   也兼容当前对象数组；未知的 id-only 关注原样保留，等观察到比赛再补全 */
function migrateFollowed(raw) {
  let val = null;
  try { val = JSON.parse(raw || '[]'); } catch (e) { return []; }
  const list = Array.isArray(val)
    ? val
    : (val && typeof val === 'object' && Array.isArray(val.teams) ? val.teams : []);
  return mergeRecordList(list.map(storedToRecord).filter(Boolean));
}

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

function followedLeagues() {
  const out = new Set();
  for (const rec of state.followed) for (const lg of rec.leagues || []) out.add(lg);
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

function followChanged() {
  invalidateFollowNext();
  saveFollowed();
  render();
  /* 空日关注变化要重算预览，但保留旧预览直到新结果就绪，避免键盘焦点丢失。 */
  if (state.data && !state.data.matches.length) reload({ preservePreview: true });
}

function toggleFollow(team) {
  if (!team) return;
  const tid = teamSideId(team);
  const name = team.name && team.name !== UNKNOWN_TEAM_NAME ? team.name : null;
  if (!tid && !name) return;
  const on = isFollowed(team);
  if (on) {
    /* 只移除与该队匹配的档案，不碰无关关注 */
    state.followed = state.followed.filter((rec) => !recordMatches(rec, team));
  } else {
    const leagues = team.leagues || (team.league ? [team.league] : []);
    state.followed.push(mkFollowRecord(tid, name, name ? nameKeys(team) : [], leagues));
  }
  followChanged();
}

/* 被删行正持有焦点时记住下标，重绘后把焦点交给下一条/上一条或面板开关 */
let pendingFollowFocus = null;

function unfollowAt(idx) {
  if (!Number.isInteger(idx) || idx < 0 || idx >= state.followed.length) return;
  const active = document.activeElement;
  if (active && active.dataset && active.dataset.followIdx === String(idx)) pendingFollowFocus = idx;
  state.followed.splice(idx, 1);
  followChanged();
}

/* ---------- 球队搜索 ----------
 * 名单来自各联赛 `/teams`（data.js 缓存 7 天），按球队 ID 合并：一支球队出现在联赛与欧战里只算一条，
 * leagues 记下它所在的全部联赛——关注后 fetchLeagues 才会去抓它在已关闭联赛里的比赛。
 * 匹配面：中文名、英文全名/简称、常用简称（TEAM_SEARCH_ALIASES）。 */
const SEARCH_LIMIT = 8;
const search = { query: '', catalog: [], loading: false, loaded: false, failed: 0 };

function searchKey(s) {
  return String(s == null ? '' : s)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
}

function buildCatalog(perLeague) {
  const byId = new Map();
  for (const { leagueId, teams } of perLeague) {
    for (const t of teams) {
      let e = byId.get(t.id);
      if (!e) {
        const zh = zhName(t.name);
        e = {
          id: t.id, name: t.name, zh, logo: t.logo, leagues: [],
          keys: [zh, t.name, t.short, ...(TEAM_SEARCH_ALIASES[zh] || [])].map(searchKey).filter(Boolean),
        };
        byId.set(t.id, e);
      }
      if (!e.leagues.includes(leagueId)) e.leagues.push(leagueId);
    }
  }
  return [...byId.values()];
}

/* 0 = 整词相同，1 = 前缀，2 = 包含；无命中返回 -1 */
function searchScore(entry, q) {
  let best = -1;
  for (const k of entry.keys) {
    const at = k.indexOf(q);
    if (at < 0) continue;
    const sc = at === 0 ? (k.length === q.length ? 0 : 1) : 2;
    if (best < 0 || sc < best) best = sc;
  }
  return best;
}

function searchTeams(catalog, query) {
  const q = searchKey(query);
  if (!q) return [];
  return catalog
    .map((e) => ({ e, sc: searchScore(e, q) }))
    .filter((r) => r.sc >= 0)
    .sort((a, b) => (a.sc - b.sc) || a.e.zh.localeCompare(b.e.zh, 'zh'))
    .map((r) => r.e);
}

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
    renderSearch();
  }).then(() => {
    search.loading = false;
    search.loaded = search.failed < LEAGUES.length;
    if (!search.loaded) catalogPromise = null;
    renderSearch();
  });
  return catalogPromise;
}

function searchLeaguesText(entry) {
  return entry.leagues.map((id) => leagueZh(id) || id).join(' · ');
}

function renderSearch() {
  const host = $('#followResults');
  if (!host) return;
  const q = searchKey(search.query);
  if (!q) {
    host.innerHTML = '';
    return;
  }
  const active = document.activeElement;
  const restoreId = active && active.closest && active.closest('#followResults') && active.dataset
    ? active.dataset.searchId : null;
  const hits = searchTeams(search.catalog, search.query);
  const rows = hits.slice(0, SEARCH_LIMIT).map((e) => {
    const on = isFollowed({ name: e.name, teamId: e.id });
    const en = e.zh !== e.name ? `<span class="search-en">${esc(e.name)}</span>` : '';
    return (
      `<div class="search-row">` +
      logoImg({ teamId: e.id, logo: e.logo }, 24) +
      `<span class="search-name">${esc(e.zh)}${en}</span>` +
      `<span class="search-meta">${esc(searchLeaguesText(e))}</span>` +
      `<button type="button" class="search-add" data-search-id="${esc(e.id)}" aria-pressed="${on}" ` +
      `aria-label="${esc((on ? '取消关注 ' : '关注 ') + e.zh)}">${on ? '已关注' : '关注'}</button>` +
      `</div>`
    );
  });
  let note = '';
  if (!hits.length) {
    if (search.loading) note = '正在加载球队名单…';
    else if (!search.catalog.length) note = '球队名单暂时无法加载，请检查网络后再试。';
    else note = `没有找到「${esc(search.query.trim())}」；只收录已配置联赛的球队。`;
  } else if (hits.length > SEARCH_LIMIT) {
    note = `还有 ${hits.length - SEARCH_LIMIT} 支，请输入更多字缩小范围`;
  } else if (search.loading) {
    note = '名单仍在加载，结果可能不全…';
  } else if (search.failed) {
    note = '部分联赛名单未能加载，结果可能不全。';
  }
  host.innerHTML = rows.join('') + (note ? `<div class="search-note">${note}</div>` : '');
  if (restoreId != null) {
    const back = [...host.querySelectorAll('[data-search-id]')].find((b) => b.dataset.searchId === restoreId);
    if (back) back.focus({ preventScroll: true });
  }
}

function onSearchInput(e) {
  search.query = (e.target && e.target.value) || '';
  if (searchKey(search.query)) loadCatalog();
  renderSearch();
}

function onSearchClick(e) {
  const btn = e.target.closest('[data-search-id]');
  if (!btn) return;
  const entry = search.catalog.find((c) => c.id === btn.dataset.searchId);
  if (entry) toggleFollow({ name: entry.name, teamId: entry.id, leagues: entry.leagues });
}

/* 未收录中文名的球队：console 提示（每个名字只提示一次），方便随时补进 team-names.js */
const reportedNames = new Set();

function reportMissingNames() {
  for (const m of (state.data ? state.data.matches : [])) {
    for (const s of [m.home, m.away]) {
      if (s && s.name && zhName(s.name) === s.name && !reportedNames.has(s.name)) {
        reportedNames.add(s.name);
        console.warn(`[赛程] 未收录中文名: ${s.name}（双击 tools/zh-coverage.html 可查全量）`);
      }
    }
  }
}

function fmtTime(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtDayLabel(dayKey) {
  const d = parseDayKey(dayKey);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function fmtClock(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function weekdayOf(dayKey) {
  return WEEKDAYS[parseDayKey(dayKey).getDay()];
}

function periodLabel(iso) {
  const h = new Date(iso).getHours();
  if (h < 6) return '凌晨';
  if (h < 12) return '上午';
  if (h < 14) return '中午';
  if (h < 18) return '下午';
  if (h < 23) return '晚上';
  return '深夜';
}

function relativeLabel(dayKey) {
  const today = dayKeyOf(new Date());
  if (dayKey === today) return '今天';
  if (dayKey === addDays(today, -1)) return '昨天';
  if (dayKey === addDays(today, 1)) return '明天';
  return weekdayOf(dayKey);
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
  if (followedChanged) state.followed = loadFollowed();
  if (enabledChanged) state.enabled = loadEnabled();
  invalidateFollowNext();
  render();
  if (enabledChanged) {
    state.data = null;
    state.weekDays = null;
    reload();
    return;
  }
  /* 关注变化：空日预览可能要重算；有比赛的日期 render 已覆盖 */
  if (state.data && !state.data.matches.length && !state.loading) enrichEmptyDay(loadSeq);
}

/* ---------- 渲染 ---------- */

/* 日期条打点：缓存覆盖决定“确认无赛（off）”还是“未知（unk）”。
   fill/hollow：缓存里有比赛（无论覆盖是否完整）；off：启用联赛×覆盖月份全部有缓存且无比赛；
   unk：覆盖不足（含完全无缓存），不能声称当天没比赛。 */
/* 四种打点状态都给出明确文字，屏幕阅读器不必靠颜色/形状猜测（视觉不变） */
const DAY_DOT_TEXT = {
  fill: '有关注球队比赛',
  hollow: '有其他比赛',
  off: '无所选联赛比赛',
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
      if (entry && now - (entry.fetchedAt || 0) < monthTtlMs(ym)) fresh += 1;
    }
  }
  return total > 0 && fresh === total ? 'off' : 'unk';
}

function renderDays() {
  const focused = $('#days').contains(document.activeElement) ? document.activeElement.dataset.day : null;
  const today = dayKeyOf(new Date());
  const cells = [];
  for (let i = 0; i < STRIP_LEN; i++) {
    const key = addDays(state.windowStart, i);
    const d = parseDayKey(key);
    const rel = relativeLabel(key);
    const sel = key === state.dayKey ? ' sel' : '';
    const isToday = key === today ? ' today' : '';
    const dotCls = dayDotState(key);
    cells.push(
      `<button class="day${sel}${isToday}" data-day="${key}" aria-label="${key} ${esc(rel)} ${esc(DAY_DOT_TEXT[dotCls] || '')}" aria-pressed="${key === state.dayKey}"${key === today ? ' aria-current="date"' : ''}>` +
      `<span class="day-rel">${esc(rel)}</span>` +
      `<span class="day-date">${d.getMonth() + 1}/${d.getDate()}</span>` +
      `<span class="day-dot ${dotCls}"></span>` +
      `</button>`
    );
  }
  $('#days').innerHTML = cells.join('');
  if (focused) {
    const button = [...$('#days').children].find((day) => day.dataset.day === focused);
    if (button) button.focus({ preventScroll: true });
  }
  $('#goToday') && $('#goToday').classList.toggle('off', state.dayKey !== today);
  const inWeek = state.view === 'week';
  $('#viewDay') && $('#viewDay').classList.toggle('on', !inWeek);
  $('#viewWeek') && $('#viewWeek').classList.toggle('on', inWeek);
  $('#viewDay') && $('#viewDay').setAttribute('aria-pressed', String(!inWeek));
  $('#viewWeek') && $('#viewWeek').setAttribute('aria-pressed', String(inWeek));
  $('#prevDay') && $('#prevDay').setAttribute('aria-label', inWeek ? '前一周' : '前一天');
  $('#nextDay') && $('#nextDay').setAttribute('aria-label', inWeek ? '后一周' : '后一天');
}

function renderChips() {
  const focused = $('#chips').contains(document.activeElement) ? document.activeElement.dataset.league : null;
  $('#chips').innerHTML = LEAGUES.map((lg) => {
    const on = state.enabled.has(lg.id);
    return `<button class="chip${on ? ' on' : ''}" data-league="${lg.id}" aria-pressed="${on}" title="${esc(lg.en)}">${esc(lg.zh)}</button>`;
  }).join('');
  $('#filterCount').textContent = `${state.enabled.size}/${LEAGUES.length}`;
  if (focused) {
    const button = [...$('#chips').children].find((chip) => chip.dataset.league === focused);
    if (button) button.focus({ preventScroll: true });
  }
}

/* 开赛倒计时：未开赛的比赛显示“N 分钟后 / N 小时后 / N 天后”，7 天以上不显示 */
function countdownText(startIso, nowMs) {
  const diff = new Date(startIso).getTime() - nowMs;
  if (!Number.isFinite(diff) || diff <= 0) return '';
  if (diff < 3600000) return `${Math.max(1, Math.floor(diff / 60000))} 分钟后`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时后`;
  if (diff < 7 * 86400000) return `${Math.floor(diff / 86400000)} 天后`;
  return '';
}

/* 每分钟一次：原地刷新倒计时（不重绘列表）；面板展开时同步推进“已缓存下一场”
   ——越过开赛点后重算该提示，只重绘 #followTeams，不碰列表、不联网 */
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
  updateCountdowns();
  refreshIfKickoffPassed();
  const panel = $('#followManager');
  if (panel && !panel.hasAttribute('hidden')) {
    invalidateFollowNext();
    renderFollow();
  }
}

function scheduleCountdownTick() {
  setTimeout(() => {
    minuteTick();
    scheduleCountdownTick();
  }, 60000);
}

function updateCountdowns(root) {
  const nodes = (root || document).querySelectorAll('.cd');
  for (const node of nodes) {
    node.textContent = countdownText(node.dataset.kick, Date.now()) || node.dataset.fallback || '';
  }
}

function matchRow(m, opts = {}) {
  const zh = (t) => esc(teamName(t));
  const en = (t) => esc((t && t.name) || '');
  const logo = (t) => logoImg(t);
  const star = (t, side) => {
    if (!t || !t.name) return '';
    const on = isFollowed(t);
    return `<button class="star${on ? ' on' : ''}" data-star="${en(t)}" data-team-id="${esc(t && t.teamId || '')}" ` +
      `data-match="${esc(m.id)}" data-side="${side}" data-league="${esc(m.league || '')}" data-copy="${opts.copy || 'league'}" ` +
      `aria-label="${on ? '取消关注' : '关注'}${zh(t)}" aria-pressed="${on}" title="${on ? '取消关注' : '关注'}">${on ? '★' : '☆'}</button>`;
  };
  const scorePart = (() => {
    if (m.status === 'SCHEDULED' || m.status === 'DELAYED' || m.status === 'POSTPONED') return '<span class="vs">vs</span>';
    const hs = m.home && m.home.score != null ? m.home.score : '–';
    const as = m.away && m.away.score != null ? m.away.score : '–';
    const hw = m.home && m.home.winner ? ' win' : '';
    const aw = m.away && m.away.winner ? ' win' : '';
    return `<b class="sc${hw}">${hs}</b><i class="dash">–</i><b class="sc${aw}">${as}</b>`;
  })();
  const statusPart = (() => {
    if (m.status === 'LIVE') return `<span class="dot"></span>${esc(m.minute || '直播')}`;
    if (m.status === 'FT') return `完场${m.detail && m.detail !== 'FT' ? ' ' + esc(m.detail) : ''}`;
    const fallback = STATUS_LABEL[m.status] || m.status;
    if (m.status === 'SCHEDULED') {
      const cd = countdownText(m.start, Date.now());
      return `<span class="cd" data-kick="${esc(m.start)}" data-fallback="${esc(fallback)}">${esc(cd || fallback)}</span>`;
    }
    return fallback;
  })();
  return (
    `<div class="match st-${m.status}${opts.compact ? ' compact' : ''}">` +
    `<div class="rail"><time>${fmtTime(m.start)}</time><span class="wd">${opts.compact ? esc(leagueZh(m.league)) : (opts.tag ? esc(leagueZh(m.league)) + ' · ' : '') + periodLabel(m.start)}</span></div>` +
    `<div class="side home"><span class="tname" title="${en(m.home)}">${zh(m.home)}</span>${star(m.home, 'home')}${logo(m.home)}</div>` +
    `<div class="score">${scorePart}</div>` +
    `<div class="side away">${logo(m.away)}${star(m.away, 'away')}<span class="tname" title="${en(m.away)}">${zh(m.away)}</span></div>` +
    `<div class="status">${statusPart}</div>` +
    `</div>`
  );
}

/* 周视图：日期条窗口的 7 天一屏呈现，按天分组、紧凑单行行 */
function renderWeek() {
  const root = $('#list');
  const days = state.weekDays;
  const active = document.activeElement;
  const focused = root.contains(active) && active.matches('button') && active.dataset.star
    ? { match: active.dataset.match, side: active.dataset.side } : null;
  const start = parseDayKey(state.windowStart);
  const end = parseDayKey(addDays(state.windowStart, STRIP_LEN - 1));
  const md = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  const all = days ? days.flatMap((d) => d.matches) : [];
  const fav = all.filter(matchHasFollowed).length;
  const incomplete = !!days && days.some((d) => d.error || (d.failed && d.failed.length) || d.stale || d.pending);
  $('#heroDate').textContent = md(start);
  $('#heroWd').textContent = '整周';
  $('#heroRel').textContent = '';
  $('#heroCount').textContent = days
    ? `${md(start)}–${md(end)} · ${all.length} 场${fav ? ` · 关注 ${fav} 场` : ''}${incomplete ? ' · 信息不完整' : ''}`
    : state.error ? '数据不可用' : state.loading ? '加载中…' : '赛程待确认';

  if (state.loading && !days) {
    root.innerHTML = skeleton();
    return;
  }
  if (state.error && (!days || !all.length)) {
    root.innerHTML = `<div class="empty-day"><p>数据暂时拿不到</p><button class="btn" id="retry">重试</button></div>`;
    return;
  }
  if (!days) {
    root.innerHTML = '';
    return;
  }
  const parts = [];
  const dayIncomplete = (d) => !!(d.error || (d.failed && d.failed.length) || d.stale || d.pending);
  for (const d of days) {
    if (!d.matches.length) {
      if (dayIncomplete(d)) {
        parts.push(
          `<section class="wday" id="wday-${d.dayKey}">` +
          `<h3 class="wday-head"><b>${md(parseDayKey(d.dayKey))}</b> ${esc(weekdayOf(d.dayKey))} · 数据不完整，无法确认是否有比赛</h3>` +
          `</section>`
        );
      }
      continue;
    }
    const dt = parseDayKey(d.dayKey);
    const rel = relativeLabel(d.dayKey);
    const f = d.matches.filter(matchHasFollowed).length;
    parts.push(
      `<section class="wday" id="wday-${d.dayKey}">` +
      `<h3 class="wday-head"><b>${md(dt)}</b> ${esc(weekdayOf(d.dayKey))}` +
      `${rel && rel !== weekdayOf(d.dayKey) ? ' · ' + esc(rel) : ''}` +
      ` · ${d.matches.length} 场${f ? ` · <i class="fav">关注 ${f}</i>` : ''}${d.error ? ' · 不可用' : ''}</h3>` +
      d.matches.map((m) => matchRow(m, { compact: true })).join('') +
      `</section>`
    );
  }
  if (incomplete) {
    parts.push(`<div class="empty-day"><p>${all.length ? '部分日期数据不完整' : '本周赛程数据不可用或不完整'}</p><p class="sub">暂时无法确认这一周是否有比赛，可重试。</p><button class="btn" id="retry">重试</button></div>`);
  } else if (!all.length) {
    parts.push(`<div class="empty-day"><p>这一周没有赛程</p><p class="sub">日期条上的圆点表示哪天有球</p></div>`);
  }
  root.innerHTML = parts.join('');
  if (focused) {
    const back = [...root.querySelectorAll('[data-star]')].find((b) => b.dataset.match === focused.match && b.dataset.side === focused.side);
    if (back) back.focus({ preventScroll: true });
  }
}

function skeleton() {
  return `<div class="skel">${Array.from({ length: 5 }, () => '<div class="skel-row"></div>').join('')}</div>`;
}

/* 海报头：巨型日期 + 当天赛程量，随选中日/数据更新 */
function renderHero() {
  const d = parseDayKey(state.dayKey);
  $('#heroDate').textContent = `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  $('#heroWd').textContent = weekdayOf(state.dayKey);
  const rel = relativeLabel(state.dayKey);
  $('#heroRel').textContent = rel === weekdayOf(state.dayKey) ? '' : rel;
  const data = state.data;
  const n = data ? data.matches.length : 0;
  const fav = data ? data.matches.filter(matchHasFollowed).length : 0;
  const incomplete = data && (state.error || data.failed.length || data.stale || data.pending || !data.fetchedAt);
  $('#heroCount').textContent = n
    ? `${n} 场${fav ? ` · 关注 ${fav} 场` : ''}${incomplete ? ' · 信息不完整' : ''}`
    : state.error ? '数据不可用'
      : !data ? (state.loading ? '加载中…' : '赛程待确认')
        : incomplete ? '赛程待确认' : '无赛程';
}

function renderList() {
  if (state.view === 'week') {
    renderWeek();
    return;
  }
  renderHero();
  const root = $('#list');
  const active = document.activeElement;
  const focused = root.contains(active) && active.matches('button')
    ? { match: active.dataset.match, side: active.dataset.side, copy: active.dataset.copy,
      id: active.id, goto: active.dataset.goto } : null;
  const d = state.data;

  if (state.loading && !d) {
    root.innerHTML = skeleton();
    return;
  }
  const parts = [];

  if (state.error && (!d || !d.matches.length)) {
    parts.push(
      `<div class="panel err"><p>赛程加载失败，数据暂不可用</p><p class="sub">${esc(state.error)}</p>` +
      `<button class="btn" id="retry">重试</button></div>`
    );
  }

  if (d && d.matches.length && (state.error || d.failed.length || d.stale || d.pending)) {
    const names = d.failed.map((id) => (LEAGUES.find((l) => l.id === id) || { zh: id }).zh).join('、');
    const reason = state.error ? '赛程刷新失败；' : names ? `${names} 数据不可用；` : '';
    parts.push(`<div class="warn" role="status">${esc(reason)}当前信息不完整${d.fromCache ? '，正在展示已缓存的比赛' : ''}。可继续查看其他联赛比赛。</div>`);
  }

  if (d && d.matches.length) {
    const fav = d.matches.filter(matchHasFollowed);
    if (fav.length) {
      parts.push(
        `<section class="league"><header class="lg-head"><h2>★ 我的关注</h2>` +
        `<span class="lg-en">Followed</span><span class="lg-count">${fav.length}场</span></header>` +
        fav.map((m) => matchRow(m, { tag: true, copy: 'followed' })).join('') +
        `</section>`
      );
    }
    const byLeague = new Map();
    for (const m of d.matches) {
      if (!state.enabled.has(m.league)) continue; /* 关闭联赛里的关注比赛只出现在“我的关注” */
      if (!byLeague.has(m.league)) byLeague.set(m.league, []);
      byLeague.get(m.league).push(m);
    }
    let lgNo = 0;
    for (const lg of LEAGUES) {
      const ms = byLeague.get(lg.id);
      if (!ms || !ms.length) continue;
      lgNo += 1;
      const meta = d.leagueMeta.get(lg.id) || {};
      const crest = meta.logo ? crestImg(lg.id, meta.logo) : '';
      parts.push(
        `<section class="league">` +
        `<header class="lg-head">${crest}<span class="lg-no">${String(lgNo).padStart(2, '0')}</span><h2>${esc(lg.zh)}</h2><span class="lg-en">${esc(lg.en)}</span><span class="lg-count">${ms.length}场</span></header>` +
        ms.map(matchRow).join('') +
        `</section>`
      );
    }
  } else if (d && !state.error) {
    const nb = state.nearby || {};
    const nearBtn = (t, label) => (t
      ? `<button class="btn near" data-goto="${t.dayKey}">${label} · ${esc(fmtDayLabel(t.dayKey))} ${esc(weekdayOf(t.dayKey))} · ${t.count}场${t.partial ? '（仅基于已缓存数据）' : ''}</button>`
      : '');
    if (!d.fetchedAt && d.pending) {
      parts.push(
        `<div class="panel"><p>正在加载赛程…</p>` +
        `<p class="sub">数据尚未取得，无法判断当天是否有比赛；也可以稍后点重试。</p>` +
        `<button class="btn" id="retry">重试</button></div>`
      );
    } else if (d.failed.length || d.stale || d.pending || !d.fetchedAt) {
      parts.push(
        `<div class="panel err"><p>当前赛程数据不可用或不完整</p>` +
        `<p class="sub">暂时无法确认当天是否有比赛；可重试、调整联赛，或查看已缓存的就近比赛。</p>` +
        `<button class="btn" id="retry">重试</button>` +
        `<div class="nearby">${nearBtn(nb.prev, '← 上一个已缓存比赛日')}${nearBtn(nb.next, '下一个已缓存比赛日 →')}</div></div>`
      );
    } else {
      parts.push(
        `<div class="panel empty"><p>${esc(fmtDayLabel(state.dayKey))} · ${esc(weekdayOf(state.dayKey))} 没有所选联赛的比赛</p>` +
        `<p class="sub">可能是国际比赛日间歇，或当天该联赛休赛；可在上方调整联赛筛选。</p>` +
        `<div class="nearby">${nearBtn(nb.prev, '← 上一个比赛日')}${nearBtn(nb.next, '下一个比赛日 →')}</div></div>`
      );
    }
    const pv = state.preview;
    if (pv) {
      const title = pv.kind === 'followed' ? '你关注的球队 · 已缓存比赛' : '已缓存的比赛';
      parts.push(
        `<section class="league"><header class="lg-head"><h2>${title}</h2>` +
        `<span class="lg-en">${esc(fmtDayLabel(pv.dayKey))} ${esc(weekdayOf(pv.dayKey))}</span>` +
        `<span class="lg-count">${pv.count}场</span></header>` +
        `${pv.partial ? '<div class="warn">仅基于已缓存数据，不保证是最近的比赛。</div>' : ''}` +
        pv.matches.slice(0, 8).map((m) => matchRow(m, { tag: pv.kind === 'followed', copy: 'preview' })).join('') +
        `<div class="more"><button class="btn" data-goto="${pv.dayKey}">查看当天已缓存的 ${pv.total} 场 →</button></div>` +
        `</section>`
      );
    }
  }

  root.innerHTML = parts.join('');
  if (focused) {
    const same = focused.match ? [...root.querySelectorAll('[data-star]')].filter((button) =>
      button.dataset.match === focused.match && button.dataset.side === focused.side) : [];
    const button = same.find((item) => item.dataset.copy === focused.copy) || same[0]
      || (focused.id && root.querySelector(`#${focused.id}`))
      || (focused.goto && [...root.querySelectorAll('[data-goto]')].find((item) => item.dataset.goto === focused.goto))
      || root.querySelector('button');
    button?.focus({ preventScroll: true });
  }
  $('#refresh') && $('#refresh').classList.toggle('busy', state.loading);
  reportMissingNames();
  $('#updated').textContent = d && d.fetchedAt
    ? `更新于 ${fmtClock(d.fetchedAt)}${d.pending ? ' · 更新中…' : d.fromCache ? ' · 缓存' : ''}`
    : '';
}

/* 面板“已缓存下一场赛程”：只扫本地月缓存（零联网），仅在面板打开时计算，
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
  const panel = $('#followManager');
  if (panel && panel.hasAttribute('hidden')) return null;
  if (!followNextMemo) followNextMemo = computeFollowNext();
  return followNextMemo;
}

function followNextText(m) {
  if (!m) return '暂无已缓存赛程';
  const d = new Date(m.start);
  const when = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `已缓存下一场赛程：${when} · ${leagueZh(m.league) || m.league} · ${teamName(m.home)} vs ${teamName(m.away)}`;
}

function focusFollowToggle() {
  const toggle = $('#followToggle');
  if (toggle && toggle.focus) toggle.focus({ preventScroll: true });
}

function renderFollow() {
  renderSearch();
  const count = state.followed.length;
  const countEl = $('#followCount');
  if (countEl) countEl.textContent = count ? String(count) : '';
  const host = $('#followTeams');
  if (!host) return;
  const active = document.activeElement;
  let restoreIdx = active && active.closest && active.closest('#followTeams') && active.dataset && active.dataset.followIdx != null
    ? Number(active.dataset.followIdx) : null;
  if (pendingFollowFocus != null) {
    restoreIdx = pendingFollowFocus;
    pendingFollowFocus = null;
  }
  if (!count) {
    host.innerHTML = `<div class="follow-empty">还没有关注球队；搜索球队名，或点赛程里的 ☆ 即可关注。</div>`;
    if (restoreIdx != null) focusFollowToggle(); /* 删空了：焦点回到面板开关，不落到 body */
    return;
  }
  const nextList = followNextList();
  host.innerHTML = state.followed.map((rec, idx) => {
    const name = followDisplayName(rec);
    const meta = followMetaText(rec);
    const next = nextList ? nextList[idx] : undefined;
    return (
      `<div class="follow-team">` +
      `<span class="follow-team-name">${esc(name)}</span>` +
      (meta ? `<span class="follow-team-meta">${esc(meta)}</span>` : '') +
      (next === undefined ? '' : `<span class="follow-team-next">${esc(followNextText(next))}</span>`) +
      `<button type="button" class="follow-remove" data-follow-idx="${idx}" aria-label="${esc('取消关注 ' + name)}">移除</button>` +
      `</div>`
    );
  }).join('');
  if (restoreIdx != null) {
    /* 原行已销毁：接住焦点放到下一条（同下标），删的是最后一条则退到上一条 */
    const want = Math.min(restoreIdx, state.followed.length - 1);
    const back = [...host.querySelectorAll('[data-follow-idx]')].find((b) => Number(b.dataset.followIdx) === want);
    if (back) back.focus({ preventScroll: true });
    else focusFollowToggle();
  }
}

/* 名称未知的旧 id-only 档案：诚实占位，不编造队名；观察到比赛后由补全逻辑填上 */
function followDisplayName(rec) {
  if (rec.name) return teamName(rec);
  if (rec.id) return `ID ${rec.id} · 名称未知`;
  if (rec.names && rec.names.length) return `${rec.names[0]}（名称待确认）`;
  return '未知球队';
}

function followMetaText(rec) {
  const lg = (rec.leagues || []).map((id) => leagueZh(id) || id);
  const parts = [lg.length ? lg.join(' · ') : '联赛未知'];
  if (rec.name && rec.id) parts.push(`ID ${rec.id}`);
  return parts.join(' · ');
}

function toggleFollowPanel() {
  const panel = $('#followManager');
  const toggle = $('#followToggle');
  if (!panel || !toggle) return;
  const open = panel.hasAttribute('hidden');
  if (open) panel.removeAttribute('hidden');
  else panel.setAttribute('hidden', '');
  toggle.setAttribute('aria-expanded', String(open));
  /* 开/关都重绘：打开时计算“已缓存下一场赛程”，关闭时清掉行内提示（关闭态不再计算） */
  invalidateFollowNext();
  renderFollow();
}

function render() {
  renderDays();
  renderChips();
  renderFollow();
  renderList();
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
  render();
}

async function reload(opts = {}) {
  if (state.view === 'week') return reloadWeek(opts);
  const seq = ++loadSeq;
  state.loading = true;
  state.error = null;
  renderList();
  try {
    const data = await loadDayVisible(state.dayKey, {
      force: opts.force,
      onUpdate: (fresh) => {
        /* 后台重验完成：静默替换为新数据 */
        if (seq !== loadSeq || state.dayKey !== fresh.dayKey) return;
        state.data = fresh;
        enrichFollowedFromMatches(fresh.matches);
        invalidateFollowNext();
        render();
        if (!fresh.matches.length && !fresh.pending && (!state.nearby || opts.preservePreview)) enrichEmptyDay(seq);
        scheduleLivePoll();
      },
    });
    if (seq !== loadSeq) return;
    state.data = data;
    enrichFollowedFromMatches(data.matches);
    invalidateFollowNext();
    if (!opts.preservePreview) {
      state.nearby = null;
      state.preview = null;
    }
    state.loading = false;
    render(); /* 先出当日视图：空场面板不等就近搜索 */
    if (!data.pending && !data.matches.length) await enrichEmptyDay(seq);
  } catch (e) {
    if (seq !== loadSeq) return;
    state.error = (e && e.message) || '未知错误';
    state.loading = false;
    render();
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
  render();
  const keys = Array.from({ length: STRIP_LEN }, (_, i) => addDays(state.windowStart, i));
  try {
    const days = await mapLimit(keys, 3, async (key) => {
      try {
        const d = await loadDayVisible(key, {
          force: opts.force,
          onUpdate: (fresh) => {
            /* 后台重验完成：把该天替换为新数据 */
            if (seq !== loadSeq || state.view !== 'week') return;
            const updated = { dayKey: key, matches: fresh.matches, failed: fresh.failed, stale: fresh.stale, pending: fresh.pending };
            if (!committed) {
              earlyUpdates.set(key, updated);
              return;
            }
            const i = state.weekDays.findIndex((x) => x.dayKey === key);
            if (i < 0) return;
            state.weekDays[i] = updated;
            enrichFollowedFromMatches(fresh.matches);
            invalidateFollowNext();
            render();
          },
        });
        return { dayKey: key, matches: d.matches, failed: d.failed, stale: d.stale, pending: d.pending };
      } catch (e) {
        return { dayKey: key, matches: [], failed: ['*'], error: true };
      }
    });
    if (seq !== loadSeq) return;
    state.weekDays = days.map((day) => earlyUpdates.get(day.dayKey) || day);
    committed = true;
    enrichFollowedFromMatches(days.flatMap((d) => d.matches));
    invalidateFollowNext();
    state.loading = false;
    render();
  } catch (e) {
    if (seq !== loadSeq) return;
    state.error = (e && e.message) || '未知错误';
    state.loading = false;
    render();
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
  if (document.hidden) return;
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
    renderDays();
    renderFollow();
  });
}

function schedulePrefetch() {
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(() => {
    if (document.hidden) return;
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
    render();
    const el = $(`#wday-${dayKey}`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
    if (!state.weekDays || state.windowStart !== prevStart) reload();
    return;
  }
  state.data = null;
  render();
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
  render();
  reload();
}

/* ---------- 日历导出（.ics） ----------
 * 把关注球队的未来赛程生成 iCalendar 文件供手机日历导入，事件自带开赛前 15 分钟提醒。
 * 纯前端生成，不上传任何数据；扫描全部已配置联赛（含已停用的）× 未来两个月的月度数据，
 * 与日期视图共享本地缓存；缺失或过期回退的组合都计入“不完整”并在提示里如实标注，
 * 绝不谎称“没有赛程”。
 */
const ICS_DAYS = 60;
const ICS_MATCH_SPAN_MS = 2 * 3600 * 1000;
let exportingIcs = false;

function icsEsc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function icsTime(date) {
  return new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/* RFC 5545 行折叠：每行 ≤75 字节（UTF-8），续行以空格开头，不切断多字节字符 */
function foldIcsLine(line) {
  const enc = new TextEncoder();
  const out = [];
  let cur = '';
  let curBytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (curBytes + b > 75) {
      out.push(cur);
      cur = ' ';
      curBytes = 1;
    }
    cur += ch;
    curBytes += b;
  }
  out.push(cur);
  return out.join('\r\n');
}

function buildIcs(matches, opts = {}) {
  const now = icsTime(new Date());
  const title = opts.title || '足球赛程';
  const tz = (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'PRODID:-//football-schedule//fixtures//ZH',
    `X-WR-CALNAME:${icsEsc(title)}`,
    `X-WR-TIMEZONE:${icsEsc(tz)}`,
  ];
  for (const m of matches) {
    const summary = `⚽ ${teamName(m.home)} vs ${teamName(m.away)}（${leagueZh(m.league)}）`;
    const desc = `${leagueZh(m.league)} · ${teamName(m.home)} vs ${teamName(m.away)}`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${icsEsc(m.id)}@football-schedule`,
      `DTSTAMP:${now}`,
      `DTSTART:${icsTime(m.start)}`,
      `DTEND:${icsTime(new Date(new Date(m.start).getTime() + ICS_MATCH_SPAN_MS))}`,
      `SUMMARY:${icsEsc(summary)}`,
      `DESCRIPTION:${icsEsc(desc)}`,
      'BEGIN:VALARM',
      'TRIGGER:-PT15M',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsEsc(summary)}`,
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

async function exportCalendar() {
  if (exportingIcs) return;
  const btn = $('#exportIcs');
  const note = $('#icsNote');
  if (!state.followed.length) {
    if (note) note.textContent = '先点 ☆ 关注球队，再来导出';
    return;
  }
  exportingIcs = true;
  if (btn) btn.disabled = true;
  try {
    if (note) note.textContent = '正在收集赛程…';
    /* 覆盖全部已配置联赛（含已停用的）：关注球队可能来自被筛掉的联赛 */
    const leagues = LEAGUES.map((l) => l.id);
    const todayKey = dayKeyOf(new Date());
    const yms = new Set();
    for (let i = 0; i < ICS_DAYS; i++) {
      for (const ym of monthsForDay(addDays(todayKey, i))) yms.add(ym);
    }
    /* 区间 [今天, 今天+ICS_DAYS 天)（本机时区）：yms 覆盖末月整月，
       只按 start>now 过滤会把第 61 天到月末的比赛也导出，必须按天截断 */
    const rangeEnd = parseDayKey(addDays(todayKey, ICS_DAYS)).getTime();
    const jobs = [];
    for (const leagueId of leagues) for (const ym of yms) jobs.push({ leagueId, ym });
    const now = Date.now();
    const picked = new Map();
    /* 不完整 = 拿不到数据（!data）或失败回退旧缓存（r.stale，能导出缓存赛事但可能缺改期/新赛程）。
       两种都计入，结果里明确标注“不完整/可能遗漏”，绝不据此宣称“没有赛程”。 */
    let incomplete = 0;
    await mapLimit(jobs, 6, async ({ leagueId, ym }) => {
      let r = null;
      try { r = await ensureMonth(leagueId, ym); } catch (e) { r = null; }
      if (!r || !r.data) {
        incomplete += 1;
        return;
      }
      if (r.stale) incomplete += 1;
      for (const m of (r.data.events || [])) {
        const ts = new Date(m.start).getTime();
        if (ts > now && ts < rangeEnd && matchHasFollowed(m)) picked.set(m.id, m);
      }
    });
    const rows = [...picked.values()].sort((a, b) => (a.start < b.start ? -1 : 1));
    if (!rows.length) {
      /* 数据不全时绝不谎称“没有赛程”，如实说明无法确认 */
      if (note) {
        note.textContent = incomplete
          ? `数据不完整（部分联赛数据过期或不可用），未能确认未来 ${ICS_DAYS} 天的赛程；请稍后重试`
          : `未来 ${ICS_DAYS} 天没有关注球队的赛程`;
      }
      return;
    }
    const blob = new Blob([buildIcs(rows, { title: '足球赛程 · 我的关注' })], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fixtures-followed.ics';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    if (note) {
      note.textContent = `已导出 ${rows.length} 场（开赛前 15 分钟提醒）` +
        (incomplete ? '；部分联赛数据过期或不可用，可能有遗漏' : '');
    }
  } catch (e) {
    if (note) note.textContent = '导出失败：' + ((e && e.message) || '未知错误');
  } finally {
    exportingIcs = false;
    if (btn) btn.disabled = false;
  }
}

/* ---------- 事件绑定 ---------- */

function bind() {
  $('#days').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-day]');
    if (btn) gotoDay(btn.dataset.day);
  });
  $('#prevDay').addEventListener('click', () => gotoDay(addDays(state.dayKey, state.view === 'week' ? -STRIP_LEN : -1)));
  $('#nextDay').addEventListener('click', () => gotoDay(addDays(state.dayKey, state.view === 'week' ? STRIP_LEN : 1)));
  $('#goToday').addEventListener('click', () => gotoDay(dayKeyOf(new Date())));
  $('#viewDay') && $('#viewDay').addEventListener('click', () => setView('day'));
  $('#viewWeek') && $('#viewWeek').addEventListener('click', () => setView('week'));
  $('#filterToggle').addEventListener('click', () => {
    const open = $('.filters').classList.toggle('is-open');
    $('#filterToggle').setAttribute('aria-expanded', String(open));
  });
  $('#chips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-league]');
    if (!btn) return;
    const id = btn.dataset.league;
    if (state.enabled.has(id)) state.enabled.delete(id);
    else state.enabled.add(id);
    if (!state.enabled.size) state.enabled.add(id);
    saveEnabled();
    render();
    reload();
  });
  $('#list').addEventListener('click', (e) => {
    const star = e.target.closest('[data-star]');
    if (star) {
      toggleFollow({ name: star.dataset.star, teamId: star.dataset.teamId, league: star.dataset.league || null });
      return;
    }
    const goto = e.target.closest('[data-goto]');
    if (goto) {
      gotoDay(goto.dataset.goto);
      return;
    }
    if (e.target.id === 'retry') reload({ force: true });
  });
  $('#refresh').addEventListener('click', () => reload({ force: true }));
  $('#exportIcs') && $('#exportIcs').addEventListener('click', exportCalendar);
  $('#followToggle') && $('#followToggle').addEventListener('click', toggleFollowPanel);
  $('#followSearch') && $('#followSearch').addEventListener('input', onSearchInput);
  $('#followSearch') && $('#followSearch').addEventListener('focus', loadCatalog);
  $('#followResults') && $('#followResults').addEventListener('click', onSearchClick);
  $('#followTeams') && $('#followTeams').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-follow-idx]');
    if (rm) unfollowAt(Number(rm.dataset.followIdx));
  });
  /* 跨标签页同步：只回读相关键并重绘；本处理不写任何偏好，按键保存也保证关注/翻日操作不互相覆盖 */
  window.addEventListener('storage', onStorageEvent);
  scheduleCountdownTick();
  /* 标签页隐藏时停掉直播轮询，切回前台立即补一次 */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearTimeout(liveTimer);
    } else if (currentMatches().some((m) => m.live) || kickoffPassed()) {
      reload({ force: true });
    }
  });
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (e.altKey || e.ctrlKey || e.metaKey || (t && t.matches && !t.matches('body, [data-day]'))) return;
    let next = null;
    if (e.key === 'ArrowLeft') next = addDays(state.dayKey, -1);
    if (e.key === 'ArrowRight') next = addDays(state.dayKey, 1);
    if (e.key === 'Home' || e.key === 't') next = dayKeyOf(new Date());
    if (!next) return;
    e.preventDefault();
    gotoDay(next);
    if (t && t.matches && t.matches('[data-day]')) {
      const day = [...$('#days').children].find((button) => button.dataset.day === next);
      if (day) day.focus();
    }
  });
}

function timezoneNote() {
  const off = -new Date().getTimezoneOffset() / 60;
  const sign = off >= 0 ? '+' : '−';
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  $('#tz').textContent = `时间：本机时区 UTC${sign}${Math.abs(off)}${zone ? ' · ' + zone : ''}`;
}

bind();
loadPrefs();
render();
reload();
timezoneNote();

/* PWA：仅 http(s) 托管时注册 Service Worker 与 manifest
 * （file:// 打开静默降级，功能不受影响，也避免控制台报 manifest 404）
 */
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = 'manifest.webmanifest';
  document.head.appendChild(link);
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
