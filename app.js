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

const state = {
  dayKey: null,
  windowStart: null,
  enabled: new Set(),
  data: null,
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

/* 未收录中文名的球队：console 提示一次，方便随时补进 team-names.js */
function reportMissingNames() {
  const missing = new Set();
  for (const m of (state.data ? state.data.matches : [])) {
    for (const s of [m.home, m.away]) {
      if (s && s.name && zhName(s.name) === s.name) missing.add(s.name);
    }
  }
  if (missing.size) {
    console.warn(`[赛程] 未收录中文名（共 ${missing.size} 个，双击 tools/zh-coverage.html 可查全量）:`, [...missing].join(', '));
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

function loadPrefs() {
  try {
    const raw = localStorage.getItem(LS_ENABLED);
    const ids = raw ? JSON.parse(raw) : null;
    state.enabled = new Set(Array.isArray(ids) && ids.length ? ids : DEFAULT_ENABLED);
  } catch (e) {
    state.enabled = new Set(DEFAULT_ENABLED);
  }
  const savedDay = (() => { try { return localStorage.getItem(LS_DAY); } catch (e) { return null; } })();
  const today = dayKeyOf(new Date());
  state.dayKey = savedDay && /^\d{4}-\d{2}-\d{2}$/.test(savedDay) ? savedDay : today;
  // 回访时若上次停留在很远的日期，回到今天
  if (Math.abs(parseDayKey(state.dayKey) - parseDayKey(today)) > 2 * 864e5) state.dayKey = today;
  state.windowStart = addDays(state.dayKey, -3);
}

function savePrefs() {
  try {
    localStorage.setItem(LS_ENABLED, JSON.stringify([...state.enabled]));
    localStorage.setItem(LS_DAY, state.dayKey);
  } catch (e) { /* 隐私模式等场景忽略 */ }
}

/* ---------- 渲染 ---------- */

function renderDays() {
  const today = dayKeyOf(new Date());
  const cells = [];
  for (let i = 0; i < STRIP_LEN; i++) {
    const key = addDays(state.windowStart, i);
    const d = parseDayKey(key);
    const rel = relativeLabel(key);
    const sel = key === state.dayKey ? ' sel' : '';
    const isToday = key === today ? ' today' : '';
    cells.push(
      `<button class="day${sel}${isToday}" data-day="${key}">` +
      `<span class="day-rel">${esc(rel)}</span>` +
      `<span class="day-date">${d.getMonth() + 1}/${d.getDate()}</span>` +
      `</button>`
    );
  }
  $('#days').innerHTML = cells.join('');
}

function renderChips() {
  $('#chips').innerHTML = LEAGUES.map((lg) => {
    const on = state.enabled.has(lg.id);
    return `<button class="chip${on ? ' on' : ''}" data-league="${lg.id}" title="${esc(lg.en)}">${esc(lg.zh)}</button>`;
  }).join('');
}

function matchRow(m) {
  const zh = (t) => esc(teamName(t));
  const en = (t) => esc((t && t.name) || '');
  const logo = (t) => (t && t.logo ? `<img class="logo" src="${esc(t.logo)}" alt="" loading="lazy" onerror="this.classList.add('broken')">` : '<span class="logo ghost"></span>');
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
    return STATUS_LABEL[m.status] || m.status;
  })();
  return (
    `<div class="match st-${m.status}">` +
    `<div class="rail"><time>${fmtTime(m.start)}</time><span class="wd">${periodLabel(m.start)}</span></div>` +
    `<div class="side home"><span class="tname" title="${en(m.home)}">${zh(m.home)}</span>${logo(m.home)}</div>` +
    `<div class="score">${scorePart}</div>` +
    `<div class="side away">${logo(m.away)}<span class="tname" title="${en(m.away)}">${zh(m.away)}</span></div>` +
    `<div class="status">${statusPart}</div>` +
    `</div>`
  );
}

function skeleton() {
  return `<div class="skel">${Array.from({ length: 5 }, () => '<div class="skel-row"></div>').join('')}</div>`;
}

function renderList() {
  const root = $('#list');
  const d = state.data;

  if (state.loading && !d) {
    root.innerHTML = skeleton();
    return;
  }
  const parts = [];

  if (state.error && (!d || !d.matches.length)) {
    parts.push(
      `<div class="panel err"><p>赛程加载失败</p><p class="sub">${esc(state.error)}</p>` +
      `<button class="btn" id="retry">重试</button></div>`
    );
  }

  if (d && d.failed.length) {
    const names = d.failed.map((id) => (LEAGUES.find((l) => l.id === id) || { zh: id }).zh).join('、');
    const tail = d.fromCache ? '，以下为本地缓存数据' : '，可能未显示全部赛程';
    parts.push(`<div class="warn">${esc(names)} 数据获取失败${esc(tail)}</div>`);
  }

  if (d && d.matches.length) {
    const byLeague = new Map();
    for (const m of d.matches) {
      if (!byLeague.has(m.league)) byLeague.set(m.league, []);
      byLeague.get(m.league).push(m);
    }
    for (const lg of LEAGUES) {
      const ms = byLeague.get(lg.id);
      if (!ms || !ms.length) continue;
      const meta = d.leagueMeta.get(lg.id) || {};
      const crest = meta.logo ? `<img class="crest" src="${esc(meta.logo)}" alt="" loading="lazy" onerror="this.remove()">` : '';
      parts.push(
        `<section class="league">` +
        `<header class="lg-head">${crest}<h2>${esc(lg.zh)}</h2><span class="lg-en">${esc(lg.en)}</span><span class="lg-count">${ms.length}场</span></header>` +
        ms.map(matchRow).join('') +
        `</section>`
      );
    }
  } else if (d && !state.error) {
    parts.push(
      `<div class="panel empty"><p>${esc(fmtDayLabel(state.dayKey))} · ${esc(weekdayOf(state.dayKey))} 没有所选联赛的比赛</p>` +
      `<p class="sub">可能是国际比赛日间歇，或当天该联赛休赛；可在上方调整联赛筛选。</p></div>`
    );
  }

  root.innerHTML = parts.join('');
  $('#refresh') && $('#refresh').classList.toggle('busy', state.loading);
  $('#updated').textContent = d && d.fetchedAt
    ? `更新于 ${fmtClock(d.fetchedAt)}${d.fromCache ? ' · 缓存' : ''}`
    : '';
}

function render() {
  renderDays();
  renderChips();
  renderList();
}

/* ---------- 加载与轮询 ---------- */

async function reload(opts = {}) {
  const seq = ++loadSeq;
  state.loading = true;
  state.error = null;
  renderList();
  try {
    const data = await loadDay(state.dayKey, { leagues: [...state.enabled], force: opts.force });
    if (seq !== loadSeq) return;
    state.data = data;
  } catch (e) {
    if (seq !== loadSeq) return;
    state.error = (e && e.message) || '未知错误';
  }
  state.loading = false;
  render();
  scheduleLivePoll();
}

function scheduleLivePoll() {
  clearTimeout(liveTimer);
  const hasLive = state.data && state.data.matches.some((m) => m.live);
  if (hasLive) liveTimer = setTimeout(() => reload({ force: true }), LIVE_POLL_MS);
}

function gotoDay(dayKey) {
  state.dayKey = dayKey;
  const end = addDays(state.windowStart, STRIP_LEN - 1);
  if (dayKey < state.windowStart) state.windowStart = addDays(dayKey, -3);
  if (dayKey > end) state.windowStart = addDays(dayKey, 3 - STRIP_LEN + 1);
  savePrefs();
  state.data = null;
  render();
  reload();
}

/* ---------- 事件绑定 ---------- */

function bind() {
  $('#days').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-day]');
    if (btn) gotoDay(btn.dataset.day);
  });
  $('#prevDay').addEventListener('click', () => gotoDay(addDays(state.dayKey, -1)));
  $('#nextDay').addEventListener('click', () => gotoDay(addDays(state.dayKey, 1)));
  $('#chips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-league]');
    if (!btn) return;
    const id = btn.dataset.league;
    if (state.enabled.has(id)) state.enabled.delete(id);
    else state.enabled.add(id);
    if (!state.enabled.size) state.enabled.add(id);
    savePrefs();
    renderChips();
    reload();
  });
  $('#list').addEventListener('click', (e) => {
    if (e.target.id === 'retry') reload({ force: true });
  });
  $('#refresh').addEventListener('click', () => reload({ force: true }));
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && t.matches && t.matches('input, textarea')) return;
    if (e.key === 'ArrowLeft') gotoDay(addDays(state.dayKey, -1));
    if (e.key === 'ArrowRight') gotoDay(addDays(state.dayKey, 1));
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
