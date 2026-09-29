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

const state = {
  dayKey: null,
  windowStart: null,
  enabled: new Set(),
  followed: new Set(),
  data: null,
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

/* ID 是首选身份；旧偏好仍是归一化名字，等球队出现时再升级。 */
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

function followKey(team) {
  return team.teamId != null && team.teamId !== '' ? `id:${team.teamId}` : `name:${normalizeTeamName(team.name)}`;
}

function isFollowed(team) {
  if (!team || !team.name) return false;
  const key = followKey(team);
  if (state.followed.has(key)) return true;
  const legacy = nameKeys(team).filter((name) => state.followed.has(name) || state.followed.has(`name:${name}`));
  if (!legacy.length) return false;
  if (team.teamId != null && team.teamId !== '') {
    for (const name of legacy) {
      state.followed.delete(name);
      state.followed.delete(`name:${name}`);
    }
    state.followed.add(key);
    savePrefs();
  }
  return true;
}

function matchHasFollowed(m) {
  return isFollowed(m.home) || isFollowed(m.away);
}

function toggleFollow(team) {
  const on = isFollowed(team);
  const key = followKey(team);
  if (on) {
    state.followed.delete(key);
    for (const name of nameKeys(team)) {
      state.followed.delete(name);
      state.followed.delete(`name:${name}`);
    }
  } else {
    state.followed.add(key);
  }
  savePrefs();
  render();
  /* 空日关注变化要重算预览，但保留旧预览直到新结果就绪，避免键盘焦点丢失。 */
  if (state.data && !state.data.matches.length) reload({ preservePreview: true });
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

function loadPrefs() {
  try {
    const raw = localStorage.getItem(LS_ENABLED);
    const ids = raw ? JSON.parse(raw) : null;
    state.enabled = new Set(Array.isArray(ids) && ids.length ? ids : DEFAULT_ENABLED);
  } catch (e) {
    state.enabled = new Set(DEFAULT_ENABLED);
  }
  try {
    const fav = JSON.parse(localStorage.getItem(LS_FOLLOWED) || '[]');
    state.followed = new Set(Array.isArray(fav) ? fav.filter((key) => typeof key === 'string' && key) : []);
  } catch (e) {
    state.followed = new Set();
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
    localStorage.setItem(LS_FOLLOWED, JSON.stringify([...state.followed]));
    localStorage.setItem(LS_DAY, state.dayKey);
  } catch (e) { /* 隐私模式等场景忽略 */ }
}

/* ---------- 渲染 ---------- */

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
    const ms = cachedDayMatches(key, [...state.enabled]);
    const dotCls = ms.some(matchHasFollowed) ? 'fill' : ms.length ? 'hollow' : 'off';
    cells.push(
      `<button class="day${sel}${isToday}" data-day="${key}" aria-label="${key} ${esc(rel)}" aria-pressed="${key === state.dayKey}"${key === today ? ' aria-current="date"' : ''}>` +
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

function matchRow(m, opts = {}) {
  const zh = (t) => esc(teamName(t));
  const en = (t) => esc((t && t.name) || '');
  const logo = (t) => logoImg(t);
  const star = (t, side) => {
    if (!t || !t.name) return '';
    const on = isFollowed(t);
    return `<button class="star${on ? ' on' : ''}" data-star="${en(t)}" data-team-id="${esc(t && t.teamId || '')}" ` +
      `data-match="${esc(m.id)}" data-side="${side}" data-copy="${opts.copy || 'league'}" ` +
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
    return STATUS_LABEL[m.status] || m.status;
  })();
  return (
    `<div class="match st-${m.status}">` +
    `<div class="rail"><time>${fmtTime(m.start)}</time><span class="wd">${opts.tag ? esc(leagueZh(m.league)) + ' · ' : ''}${periodLabel(m.start)}</span></div>` +
    `<div class="side home"><span class="tname" title="${en(m.home)}">${zh(m.home)}</span>${star(m.home, 'home')}${logo(m.home)}</div>` +
    `<div class="score">${scorePart}</div>` +
    `<div class="side away">${logo(m.away)}${star(m.away, 'away')}<span class="tname" title="${en(m.away)}">${zh(m.away)}</span></div>` +
    `<div class="status">${statusPart}</div>` +
    `</div>`
  );
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

function render() {
  renderDays();
  renderChips();
  renderList();
}

/* ---------- 加载与轮询 ---------- */

/* 空日期的补全：找上/下一个比赛日与关注球队预览（网络慢时独立于首屏渲染） */
async function enrichEmptyDay(seq) {
  const nearby = await findNearbyMatchdays(state.dayKey, {
    leagues: [...state.enabled],
    isFav: state.followed.size ? matchHasFollowed : null,
  });
  if (seq !== loadSeq) return;
  state.nearby = nearby;
  const f = nearby.favNext || nearby.favPrev;
  const g = nearby.next || nearby.prev;
  const target = f || g;
  const kind = f ? 'followed' : 'any';
  let preview = null;
  if (target) {
    const pv = await loadDay(target.dayKey, { leagues: [...state.enabled] });
    if (seq !== loadSeq) return;
    const rows = kind === 'followed' ? pv.matches.filter(matchHasFollowed) : pv.matches;
    preview = {
      dayKey: target.dayKey, kind, count: rows.length, total: pv.matches.length, matches: rows,
      partial: !!target.partial || !!pv.failed.length || !!pv.stale || !!pv.pending,
    };
  }
  state.preview = preview;
  render();
}

async function reload(opts = {}) {
  const seq = ++loadSeq;
  state.loading = true;
  state.error = null;
  renderList();
  try {
    const data = await loadDay(state.dayKey, {
      leagues: [...state.enabled],
      force: opts.force,
      onUpdate: (fresh) => {
        /* 后台重验完成：静默替换为新数据 */
        if (seq !== loadSeq || state.dayKey !== fresh.dayKey) return;
        state.data = fresh;
        render();
        if (!fresh.matches.length && !fresh.pending && (!state.nearby || opts.preservePreview)) enrichEmptyDay(seq);
        scheduleLivePoll();
      },
    });
    if (seq !== loadSeq) return;
    state.data = data;
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
}

function scheduleLivePoll() {
  clearTimeout(liveTimer);
  if (document.hidden) return;
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
  $('#goToday').addEventListener('click', () => gotoDay(dayKeyOf(new Date())));
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
    savePrefs();
    render();
    reload();
  });
  $('#list').addEventListener('click', (e) => {
    const star = e.target.closest('[data-star]');
    if (star) {
      toggleFollow({ name: star.dataset.star, teamId: star.dataset.teamId });
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
  /* 标签页隐藏时停掉直播轮询，切回前台立即补一次 */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearTimeout(liveTimer);
    } else if (state.data && state.data.matches.some((m) => m.live)) {
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
