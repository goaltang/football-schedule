'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const dataSource = fs.readFileSync(path.join(root, 'data.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function harness(entries = [], withApp = false) {
  const values = new Map(entries);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
  const elements = {};
  const el = (name = '') => {
    const classes = new Set();
    const listeners = new Map();
    const attrs = new Map();
    return {
      name,
      innerHTML: '', textContent: '', children: [],
      hidden: false, disabled: false, dataset: {},
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
        toggle: (c, force) => {
          const on = force === undefined ? !classes.has(c) : !!force;
          if (on) classes.add(c); else classes.delete(c);
          return on;
        },
      },
      setAttribute: (key, value) => attrs.set(key, String(value)),
      getAttribute: (key) => (attrs.has(key) ? attrs.get(key) : null),
      hasAttribute: (key) => attrs.has(key),
      removeAttribute: (key) => attrs.delete(key),
      addEventListener: (type, fn) => {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      removeEventListener(type, fn) {
        const list = listeners.get(type) || [];
        const at = list.indexOf(fn);
        if (at >= 0) list.splice(at, 1);
      },
      dispatch: (type, event) => {
        for (const fn of [...(listeners.get(type) || [])]) fn(event);
      },
      contains: () => false,
      querySelectorAll: () => [],
      querySelector: () => null,
      focus() {},
      scrollIntoView() {},
      appendChild() {},
      click() {},
      remove() {},
    };
  };
  if (withApp) {
    for (const selector of ['#days', '#chips', '#filterToggle', '#filterCount', '.filters',
      '#list', '#refresh', '#updated', '#goToday', '#prevDay', '#nextDay', '#tz',
      '#heroDate', '#heroWd', '#heroRel', '#heroCount',
      '#followToggle', '#followCount', '#followManager', '#followTeams',
      '#icsNote', '#exportIcs', '#viewDay', '#viewWeek']) elements[selector] = el(selector);
    elements['#followManager'].setAttribute('hidden', ''); // 与 index.html 初始一致：面板默认收起
    elements['#followToggle'].setAttribute('aria-expanded', 'false');
  }
  const winListeners = new Map();
  const blobs = [];
  const downloads = [];
  let attempts = 0;
  let fetchImpl = async () => { throw new Error('offline'); };
  /* 可控时钟（仅 withApp 注入）：默认与真实时间逐毫秒一致；h.advance(ms) 前移，
     用于“跨过开赛点”这类必须推进时间的行为断言 */
  const RealDate = Date;
  let nowOffset = 0;
  class ControlledDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + nowOffset);
      else super(...args);
    }
    static now() { return RealDate.now() + nowOffset; }
  }
  const globals = {
    window: {
      localStorage: storage,
      addEventListener: (type, fn) => {
        if (!winListeners.has(type)) winListeners.set(type, []);
        winListeners.get(type).push(fn);
      },
      removeEventListener: (type, fn) => {
        const list = winListeners.get(type) || [];
        const at = list.indexOf(fn);
        if (at >= 0) list.splice(at, 1);
      },
    },
    localStorage: storage,
    AbortController,
    TextEncoder,
    fetch: (...args) => {
      attempts++;
      try {
        return Promise.resolve(fetchImpl(...args));
      } catch (e) {
        return Promise.reject(e);
      }
    },
    setTimeout: (fn, ms) => ms >= 15000 ? null : setImmediate(fn),
    clearTimeout: (id) => clearImmediate(id),
  };
  if (withApp) {
    /* 导出链路的最小替身：捕获 Blob 内容与下载动作，便于断言生成的日历文本 */
    globals.Blob = class Blob {
      constructor(parts, opts) {
        this.parts = parts;
        this.type = (opts && opts.type) || '';
        blobs.push(this);
      }
      get text() { return this.parts.join(''); }
    };
    globals.URL = { createObjectURL: () => 'blob:test', revokeObjectURL() {} };
    globals.document = {
      activeElement: { matches: () => false, dataset: {} },
      hidden: false,
      querySelector: (selector) => elements[selector] || null,
      querySelectorAll: () => [],
      listeners: new Map(),
      addEventListener(type, fn) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(fn);
      },
      dispatch(type, event) {
        for (const fn of [...(this.listeners.get(type) || [])]) fn(event);
      },
      createElement: (tag) => {
        const node = el(tag);
        node.click = () => downloads.push(node);
        return node;
      },
      body: { appendChild() {} },
    };
    globals.navigator = {};
    globals.location = { protocol: 'file:' };
    globals.Date = ControlledDate;
  } else {
    globals.DEFAULT_ENABLED = ['eng.1'];
  }
  const context = vm.createContext(globals);
  if (withApp) {
    vm.runInContext(fs.readFileSync(path.join(root, 'config.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(root, 'team-names.js'), 'utf8'), context);
  }
  vm.runInContext(dataSource, context, { filename: 'data.js' });
  if (withApp) {
    vm.runInContext(appSource, context, { filename: 'app.js' });
    vm.runInContext('++loadSeq', context); // invalidate the asynchronous boot load
  }
  return {
    context,
    storage,
    elements,
    attempts: () => attempts,
    setFetch: (fn) => { fetchImpl = fn; },
    call: (expression) => vm.runInContext(expression, context),
    advance: (ms) => { nowOffset += ms; },
    entries: () => [...values.entries()],
    fireWindow: (type, event) => {
      for (const fn of [...(winListeners.get(type) || [])]) fn(event);
    },
    blobs,
    downloads,
  };
}

function monthCache(league, events, fetchedAt = Date.now(), ym = '202609') {
  return [`fs1|m|${league}|${ym}`, JSON.stringify({
    fetchedAt,
    league: { id: league, logo: '' },
    events,
  })];
}

/* 事后写入月缓存并清掉数据层读缓存（boot 已按今天的窗口 memo 过这些键） */
function seedMonth(h, league, ym, events, fetchedAt = Date.now()) {
  h.storage.setItem(`fs1|m|${league}|${ym}`, JSON.stringify({
    fetchedAt,
    league: { id: league, logo: '' },
    events,
  }));
  h.call('cacheMemo.clear()');
}

function match(id, league, day, teamId = '42', month = 8) {
  return {
    id,
    league,
    start: new Date(2026, month, day, 12).toISOString(),
    status: 'SCHEDULED',
    home: { name: 'Home', teamId },
    away: { name: 'Away', teamId: '99' },
  };
}

/* 关注行为相关的显式日期锚点（相对运行日构造，避免硬编码日期随时间过期） */
function futureDayKey(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test('partially unavailable leagues do not hide nearby cached matchdays', async () => {
  const h = harness([
    monthCache('eng.1', [match('known', 'eng.1', 22)]),
    monthCache('esp.1', []),
  ]);
  h.context.options = {
    leagues: ['eng.1', 'esp.1', 'chn.1'],
    maxDays: 4,
    maxMonths: 1,
    isFav: (m) => m.home.teamId === '42',
  };
  const nearby = await h.call("findNearbyMatchdays('2026-09-26', options)");
  assert.equal(nearby.prev?.dayKey, '2026-09-22');
  assert.equal(nearby.prev?.count, 1);
  assert.equal(nearby.prev?.partial, true);
  assert.equal(nearby.favPrev?.dayKey, '2026-09-22');
  assert.equal(nearby.favPrev?.partial, true);
  assert.ok(h.attempts() > 0);
});

test('failed refresh with old data explicitly reports stale cache', async () => {
  const old = Date.now() - 3600_000;
  const h = harness([monthCache('eng.1', [match('cached', 'eng.1', 26)], old)]);
  const day = await h.call("loadDay('2026-09-26', { leagues: ['eng.1'], force: true })");
  assert.equal(day.matches.length, 1);
  assert.equal(day.matches[0].id, 'cached');
  assert.equal(day.fromCache, true);
  assert.equal(day.stale, true);
  assert.equal(day.failed.length, 0);
});

test('no cache plus failed fetch remains unavailable, not a confirmed empty day', async () => {
  const h = harness();
  const day = await h.call("loadDay('2026-09-26', { leagues: ['eng.1'] })");
  assert.equal(day.matches.length, 0);
  assert.equal(day.fetchedAt, null);
  assert.equal(day.pending, undefined);
  assert.equal(day.failed[0], 'eng.1');
});

test('a league with only one of two required months remains incomplete', async () => {
  const h = harness([monthCache('eng.1', [])]);
  h.context.jobs = [
    { leagueId: 'eng.1', ym: '202609' },
    { leagueId: 'eng.1', ym: '202610' },
  ];
  const day = await h.call("collectView('2026-10-01', jobs, {})");
  assert.equal(day.matches.length, 0);
  assert.ok(day.fetchedAt);
  assert.equal(day.failed[0], 'eng.1');
});

test('an unavailable day renders retry instead of an empty-fixture claim', () => {
  const h = harness([['fs1.enabled', '["eng.1"]']], true);
  h.call(`state.data = {
    matches: [], failed: ['eng.1'], fetchedAt: null, fromCache: false,
    stale: true, leagueMeta: new Map(),
  }; state.loading = false; renderList()`);
  assert.match(h.elements['#list'].innerHTML, /当前赛程数据不可用或不完整/);
  assert.match(h.elements['#list'].innerHTML, /id="retry"/);
  assert.doesNotMatch(h.elements['#list'].innerHTML, /没有所选联赛的比赛/);
  assert.notEqual(h.elements['#heroCount'].textContent, '无赛程');

  h.call('state.data.failed = []; state.data.stale = false; state.data.fetchedAt = Date.now(); renderList()');
  assert.match(h.elements['#list'].innerHTML, /没有所选联赛的比赛/);
  assert.equal(h.elements['#heroCount'].textContent, '无赛程');
});

test('legacy followed name resolves by team, survives ID drift, and reads never write', () => {
  const h = harness([['fs1.followed', '["intermilan"]']], true);
  h.context.fixture = {
    id: 'fixture', league: 'ita.1', start: new Date(2026, 8, 26, 12).toISOString(), status: 'SCHEDULED',
    home: { name: 'Internazionale', teamId: '115' },
    away: { name: 'Roma', teamId: '112' },
  };
  /* 纯读：迁移在 loadPrefs 完成，查询本身绝不改写存储或状态 */
  const snap = h.entries();
  assert.equal(h.call('isFollowed(fixture.home)'), true);
  assert.equal(h.call('isFollowed({ name: "Inter Milan", teamId: "115" })'), true);
  assert.equal(h.call('isFollowed({ name: "Inter Milan", teamId: "999" })'), true); // ID 变更后按名字命中
  assert.equal(h.call('isFollowed({ name: "Roma", teamId: "112" })'), false);
  assert.equal(h.call('matchHasFollowed(fixture)'), true);
  assert.deepEqual(h.entries(), snap);
  h.call('render()'); // 渲染期间也不得写关注偏好
  assert.deepEqual(h.entries(), snap);

  /* 消费端可见：行内星标状态 */
  const starOn = (h.call('matchRow(fixture)').match(/<button class="star[^>]*>/g) || [])
    .find((tag) => tag.includes('取消关注国际米兰'));
  assert.ok(starOn);
  assert.match(starOn, /aria-pressed="true"/);

  /* 观察比赛补全档案：写入观察到的 ID，此后按占位名可见“ID 已更新”的行为证据 */
  const obs = (tid) => JSON.stringify([{
    id: 'm1', league: 'ita.1',
    home: { name: 'Inter Milan', teamId: tid },
    away: { name: 'Roma', teamId: '112' },
  }]);
  assert.equal(h.call(`enrichFollowedFromMatches(${obs('999')})`), true);
  assert.equal(h.call('isFollowed({ name: "未知球队", teamId: "999" })'), true);
  assert.equal(h.call('isFollowed({ name: "未知球队", teamId: "115" })'), false); // 旧 ID 不再保留
  assert.equal(h.call('isFollowed({ name: "Inter Milan", teamId: "110" })'), true); // 两次观察之间 ID 又变了
  /* ESPN 复用 ID：已知名称的档案遇到同 ID 但明显不同的队名 → 不算已关注 */
  assert.equal(h.call('isFollowed({ name: "Roma", teamId: "110" })'), false);
  assert.equal(h.call(`enrichFollowedFromMatches(${obs('110')})`), true);
  assert.equal(h.call('isFollowed({ name: "未知球队", teamId: "110" })'), true);
  assert.equal(h.call('isFollowed({ name: "未知球队", teamId: "999" })'), false);

  /* 取消关注只作用于这一支球队，不碰无关关注 */
  h.call("toggleFollow({ name: 'Roma', teamId: '112', league: 'ita.1' })");
  assert.equal(h.call('state.followed.length'), 2);
  h.call('toggleFollow(fixture.home)');
  assert.equal(h.call('isFollowed(fixture.home)'), false);
  assert.equal(h.call('isFollowed(fixture.away)'), true);
  assert.equal(h.call('state.followed.length'), 1);
  const starOff = (h.call('matchRow(fixture)').match(/<button class="star[^>]*>/g) || [])
    .find((tag) => tag.includes('关注国际米兰') && !tag.includes('取消关注'));
  assert.match(starOff, /aria-pressed="false"/);
});

test('legacy id-only follow survives upgrade with an honest placeholder', () => {
  const h = harness([['fs1.followed', '["id:7777"]'], ['fs1.enabled', '["eng.1"]']], true);
  h.call('render()');
  assert.equal(h.elements['#followCount'].textContent, '1');
  assert.match(h.elements['#followTeams'].innerHTML, /ID 7777 · 名称未知/);
  /* 未观察过名称的档案只能按 ID 命中 */
  assert.equal(h.call('isFollowed({ teamId: "7777" })'), true);
  assert.equal(h.call('isFollowed({ name: "未知球队", teamId: "7777" })'), true);
  assert.equal(h.call('isFollowed({ teamId: "8888" })'), false);
  assert.equal(h.call('isFollowed({ name: "Any FC" })'), false);
  /* 追加新关注并跨“重启”验证：id-only 档案无损保留 */
  h.call("toggleFollow({ name: 'Manchester City', teamId: '42', league: 'eng.1' })");
  assert.equal(h.elements['#followCount'].textContent, '2');
  const h2 = harness(h.entries(), true);
  assert.equal(h2.elements['#followCount'].textContent, '2');
  assert.match(h2.elements['#followTeams'].innerHTML, /ID 7777 · 名称未知/);
  assert.ok(h2.elements['#followTeams'].innerHTML.includes('曼城'));
  assert.equal(h2.call('isFollowed({ teamId: "7777" })'), true);
  assert.equal(h2.call("isFollowed({ name: 'Manchester City', teamId: '42' })"), true);
});

test('follow manager panel toggles, adds and removes teams across reload', () => {
  const h = harness([
    ['fs1.enabled', '["eng.1"]'],
    ['fs1.followed', '[]'],
    ['fs1.day', '2026-09-22'],
    ['fs1.view', 'day'],
  ], true);
  /* index.html 初始：面板带 hidden，按钮 aria-expanded=false */
  h.elements['#followManager'].setAttribute('hidden', '');
  h.elements['#followToggle'].setAttribute('aria-expanded', 'false');
  h.call('toggleFollowPanel()');
  assert.equal(h.elements['#followManager'].hasAttribute('hidden'), false);
  assert.equal(h.elements['#followToggle'].getAttribute('aria-expanded'), 'true');
  h.call('toggleFollowPanel()');
  assert.equal(h.elements['#followManager'].hasAttribute('hidden'), true);
  assert.equal(h.elements['#followToggle'].getAttribute('aria-expanded'), 'false');

  const enabled0 = h.storage.getItem('fs1.enabled');
  const day0 = h.storage.getItem('fs1.day');
  const view0 = h.storage.getItem('fs1.view');
  h.call("toggleFollow({ name: 'Manchester City', teamId: '42', league: 'eng.1' })");
  assert.equal(h.elements['#followCount'].textContent, '1');
  /* 按键保存：关注变化只写 fs1.followed，其余偏好字节不动 */
  assert.notEqual(h.storage.getItem('fs1.followed'), '[]');
  assert.equal(h.storage.getItem('fs1.enabled'), enabled0);
  assert.equal(h.storage.getItem('fs1.day'), day0);
  assert.equal(h.storage.getItem('fs1.view'), view0);
  const row = h.elements['#followTeams'].innerHTML;
  assert.match(row, /class="follow-team"/);
  assert.ok(row.includes('曼城'));
  assert.match(row, /aria-label="取消关注 曼城"/);

  /* 面板行上的移除按钮走委托点击 */
  h.elements['#followTeams'].dispatch('click', {
    target: {
      closest: (sel) => (sel === '[data-follow-idx]' ? { dataset: { followIdx: '0' } } : null),
    },
  });
  assert.equal(h.elements['#followCount'].textContent, '');
  assert.match(h.elements['#followTeams'].innerHTML, /follow-empty/);
  assert.equal(h.call("isFollowed({ name: 'Manchester City', teamId: '42' })"), false);

  /* 添加 → 重新加载页面（新上下文共享存储）→ 状态保留 */
  h.call("toggleFollow({ name: 'Manchester City', teamId: '42', league: 'eng.1' })");
  const h2 = harness(h.entries(), true);
  assert.equal(h2.elements['#followCount'].textContent, '1');
  assert.equal(h2.call("isFollowed({ name: 'Manchester City', teamId: '42' })"), true);
  assert.ok(h2.elements['#followTeams'].innerHTML.includes('曼城'));
});

test('follow manager shows each profile next cached fixture only while open', () => {
  const h = harness([['fs1.enabled', '["eng.1"]']], true);
  /* 关注两队：Home 在缓存里有未来比赛（事件 ID 与档案不同 → 必须按名字命中），Roma 没有 */
  h.call("toggleFollow({ name: 'Home', teamId: '42', league: 'eng.1' })");
  h.call("toggleFollow({ name: 'Roma', teamId: '112', league: 'ita.1' })");
  h.call('render()');
  /* 面板收起（index.html 初始态）：不展示下一场 */
  assert.doesNotMatch(h.elements['#followTeams'].innerHTML, /follow-team-next/);

  const day = futureDayKey(10);
  const upcoming = {
    id: 'next-game', league: 'eng.1', start: new Date(`${day}T12:00:00`).toISOString(),
    status: 'SCHEDULED',
    home: { name: 'Home', teamId: '999' }, // 档案 id 是 42，事件 id 已漂移 → 名字说了算
    away: { name: 'Away', teamId: '99' },
  };
  const gone = { ...upcoming, id: 'past-game', start: new Date(Date.now() - 3 * 864e5).toISOString() };
  for (const ym of h.call(`monthsForDay('${day}')`)) seedMonth(h, 'eng.1', ym, [gone, upcoming]);

  const fetches = h.attempts();
  h.call('toggleFollowPanel()'); // 打开面板
  h.call('render()');
  assert.equal(h.attempts(), fetches); // 只扫本地缓存，零网络
  const html = h.elements['#followTeams'].innerHTML;
  const [mm, dd] = [Number(day.slice(5, 7)), Number(day.slice(8, 10))];
  /* 展示的是未来的那一场（过去的被排除），本地时间与联赛/对阵一并给出 */
  assert.ok(html.includes(`已缓存下一场赛程：${mm}/${dd} 12:00 · 英超 · Home vs Away`));
  assert.match(html, /暂无已缓存赛程/); // Roma：诚实说明没有已缓存赛程，不承诺真实最近
  /* 收起面板 → 不再展示 */
  h.call('toggleFollowPanel()');
  h.call('render()');
  assert.doesNotMatch(h.elements['#followTeams'].innerHTML, /follow-team-next/);

  /* 缓存出现更早的未来比赛 → 重开面板即重算到新的一场 */
  const day2 = futureDayKey(2);
  const sooner = { ...upcoming, id: 'sooner-game', start: new Date(`${day2}T12:00:00`).toISOString() };
  for (const ym of h.call(`monthsForDay('${day2}')`)) seedMonth(h, 'eng.1', ym, [sooner]);
  h.call('toggleFollowPanel()');
  h.call('render()');
  const [m2, d2] = [Number(day2.slice(5, 7)), Number(day2.slice(8, 10))];
  assert.ok(h.elements['#followTeams'].innerHTML.includes(`已缓存下一场赛程：${m2}/${d2} 12:00 · 英超 · Home vs Away`));
  assert.equal(h.attempts(), fetches); // 全程零网络
  h.call('toggleFollowPanel()');
  h.call('render()');
  assert.doesNotMatch(h.elements['#followTeams'].innerHTML, /follow-team-next/);
});

test('panel next-fixture hint advances across kickoffs without network', () => {
  const h = harness([['fs1.enabled', '["eng.1"]']], true);
  const day1 = futureDayKey(1);
  const day2 = futureDayKey(3);
  const k1 = new Date(`${day1}T12:00:00`);
  const k2 = new Date(`${day2}T12:00:00`);
  const mk = (id, day) => ({
    id, league: 'eng.1', start: new Date(`${day}T12:00:00`).toISOString(),
    status: 'SCHEDULED', home: { name: 'Home', teamId: '42' }, away: { name: 'Away', teamId: '99' },
  });
  const events = [mk('g1', day1), mk('g2', day2)];
  const yms = new Set([
    ...h.call(`monthsForDay('${day1}')`),
    ...h.call(`monthsForDay('${day2}')`),
  ]);
  for (const ym of yms) seedMonth(h, 'eng.1', ym, events);
  h.call("toggleFollow({ name: 'Home', teamId: '42', league: 'eng.1' })");
  h.call('toggleFollowPanel()'); // 打开面板
  const [m1, d1] = [Number(day1.slice(5, 7)), Number(day1.slice(8, 10))];
  const [m2, d2] = [Number(day2.slice(5, 7)), Number(day2.slice(8, 10))];
  let html = h.elements['#followTeams'].innerHTML;
  assert.ok(html.includes(`已缓存下一场赛程：${m1}/${d1} 12:00 · 英超 · Home vs Away`)); // 最早的一场
  assert.ok(!html.includes(`${m2}/${d2} 12:00`));

  const fetches = h.attempts();
  /* 跨过第一场开赛点 → tick 推进到第二场 */
  h.advance(k1.getTime() - Date.now() + 60000);
  h.call('minuteTick()');
  html = h.elements['#followTeams'].innerHTML;
  assert.ok(!html.includes(`${m1}/${d1} 12:00`));
  assert.ok(html.includes(`已缓存下一场赛程：${m2}/${d2} 12:00 · 英超 · Home vs Away`));

  /* 跨过第二场 → 诚实说暂无 */
  h.advance(k2.getTime() - Date.now() + 60000);
  h.call('minuteTick()');
  html = h.elements['#followTeams'].innerHTML;
  assert.match(html, /暂无已缓存赛程/);
  assert.ok(!html.includes('已缓存下一场赛程：'));
  assert.equal(h.attempts(), fetches); // 全程零网络

  /* 面板收起时：tick 不动行、不重算 */
  h.call('toggleFollowPanel()');
  const closed = h.elements['#followTeams'].innerHTML;
  h.advance(86400e3);
  h.call('minuteTick()');
  assert.equal(h.elements['#followTeams'].innerHTML, closed);
  assert.equal(h.attempts(), fetches);
});

test('same ID with different known names stays as two profiles and cancels independently', () => {
  const stored = JSON.stringify([
    { id: '110', name: 'Inter Milan', names: ['intermilan'], leagues: ['ita.1'] },
    { id: '110', name: 'Roma', names: ['roma'], leagues: [] },
  ]);
  const h = harness([['fs1.followed', stored]], true);
  h.call('render()');
  /* 同 ID 但已知名字不同 → 两条档案并存，不被 ID 合并 */
  assert.equal(h.call('state.followed.length'), 2);
  assert.equal(h.elements['#followCount'].textContent, '2');
  assert.equal(h.call('isFollowed({ name: "Inter Milan", teamId: "110" })'), true);
  assert.equal(h.call('isFollowed({ name: "Roma", teamId: "110" })'), true);
  assert.equal(h.call('isFollowed({ name: "Lazio", teamId: "110" })'), false); // ID 复用不算同队
  assert.equal(h.call('isFollowed({ name: "未知球队", teamId: "112" })'), false); // 漂移前：尚无档案持 112

  /* 观察一场比赛（home Inter/110，away Roma/112）：各补各的档案，仍不合并 */
  const obs = JSON.stringify([{
    id: 'm', league: 'uefa.champions',
    home: { name: 'Inter Milan', teamId: '110' },
    away: { name: 'Roma', teamId: '112' },
  }]);
  assert.equal(h.call(`enrichFollowedFromMatches(${obs})`), true);
  assert.equal(h.call('state.followed.length'), 2);
  /* 档案2 的 ID 按观察漂移到 112；档案1 保持 110 —— 按占位名探 ID 可见 */
  assert.equal(h.call('isFollowed({ name: "未知球队", teamId: "112" })'), true);
  assert.equal(h.call('isFollowed({ name: "未知球队", teamId: "110" })'), true);
  /* 两队都学到观察到的联赛（预览/导出提示用） */
  assert.equal(JSON.stringify(h.call('followedLeagues()').sort()), '["ita.1","uefa.champions"]');

  /* 跨重启（migrate 再走合并逻辑）仍并存 */
  const h2 = harness(h.entries(), true);
  assert.equal(h2.call('state.followed.length'), 2);
  assert.equal(h2.elements['#followCount'].textContent, '2');

  /* 星标取消只影响该队：关掉 Roma，Inter 仍在 */
  h.call("toggleFollow({ name: 'Roma', teamId: '110' })");
  assert.equal(h.call('state.followed.length'), 1);
  assert.equal(h.call('isFollowed({ name: "Roma", teamId: "112" })'), false);
  assert.equal(h.call('isFollowed({ name: "Inter Milan", teamId: "110" })'), true);
  assert.equal(h.elements['#followCount'].textContent, '1');

  /* 面板按行取消：定位“国际米兰”那一行的 data-follow-idx 走真实委托点击 */
  const row = (h2.elements['#followTeams'].innerHTML.match(/<div class="follow-team">[\s\S]*?<\/div>/g) || [])
    .find((r) => r.includes('取消关注 国际米兰'));
  assert.ok(row);
  const idx = Number(/data-follow-idx="(\d+)"/.exec(row)[1]);
  h2.elements['#followTeams'].dispatch('click', {
    target: {
      closest: (sel) => (sel === '[data-follow-idx]' ? { dataset: { followIdx: String(idx) } } : null),
    },
  });
  assert.equal(h2.call('state.followed.length'), 1);
  assert.equal(h2.call('isFollowed({ name: "Inter Milan", teamId: "110" })'), false);
  assert.equal(h2.call('isFollowed({ name: "Roma", teamId: "112" })'), true);
  assert.equal(h2.elements['#followCount'].textContent, '1');
});

test('empty-day followed preview searches disabled leagues of followed teams', async () => {
  const h = harness([['fs1.enabled', '["eng.1"]']], true);
  /* eng.1 十月：目标日所在月确认无赛；esp.1 已停用但关注球队在 10-10 有比赛 */
  seedMonth(h, 'eng.1', '202610', []);
  seedMonth(h, 'esp.1', '202610', [match('fav-game', 'esp.1', 10, '42', 9)]);
  h.call("toggleFollow({ name: 'Home', teamId: '42', league: 'esp.1' })");
  h.call("state.dayKey = '2026-10-07'; state.windowStart = '2026-10-04';");
  await h.call('reload()');
  assert.equal(h.call("state.enabled.has('esp.1')"), false);
  const nb = h.call('state.nearby');
  assert.equal(nb && nb.favNext && nb.favNext.dayKey, '2026-10-10'); // 关注搜索覆盖关闭联赛
  const pv = h.call('state.preview');
  assert.ok(pv);
  assert.equal(pv.kind, 'followed');
  assert.equal(pv.matches.length, 1);
  assert.equal(pv.matches[0].league, 'esp.1');
  assert.ok(h.elements['#list'].innerHTML.includes('你关注的球队'));
});

test('export covers followed teams in disabled leagues and marks partial data', async () => {
  const h = harness([['fs1.enabled', '["eng.1"]']], true);
  const day = futureDayKey(10);
  const yms = new Set(h.call(`monthsForDay('${day}')`));
  for (const ym of h.call(`monthsForDay(addDays('${day}', 40))`)) yms.add(ym); // 同一赛事落入两个月缓存，验证去重
  const futureMatch = match('evt-followed', 'ita.1', 1, '42', 9);
  futureMatch.start = `${day}T15:00:00.000Z`;
  h.call("toggleFollow({ name: 'Home', teamId: '42', league: 'ita.1' })");
  for (const ym of yms) seedMonth(h, 'ita.1', ym, [futureMatch]);
  await h.call('exportCalendar()');
  assert.equal(h.call("state.enabled.has('ita.1')"), false); // ita.1 是停用联赛
  assert.equal(h.downloads.length, 1);
  assert.equal(h.blobs.length, 1);
  const ics = h.blobs[0].parts.join('');
  assert.equal((ics.match(/UID:evt-followed@football-schedule/g) || []).length, 1); // 去重后仅一条 VEVENT
  assert.ok(ics.includes('BEGIN:VCALENDAR'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  const note = h.elements['#icsNote'].textContent;
  assert.match(note, /已导出 1 场/);
  assert.match(note, /可能有遗漏/); // 其余联赛数据过期/拿不到 → 如实提示可能有遗漏
  assert.ok(!note.includes('没有关注球队的赛程'));
});

test('export failure never claims there are no future fixtures', async () => {
  const h = harness([['fs1.enabled', '["eng.1"]']], true);
  /* 没有关注球队时给出引导文案 */
  await h.call('exportCalendar()');
  assert.equal(h.elements['#icsNote'].textContent, '先点 ☆ 关注球队，再来导出');
  h.call("toggleFollow({ name: 'Home', teamId: '42', league: 'eng.1' })");
  /* 全部联赛×月都拿不到数据（默认 fetch 直接失败）：必须承认无法确认，而非谎称没有 */
  await h.call('exportCalendar()');
  const note = h.elements['#icsNote'].textContent;
  assert.ok(!note.includes('没有关注球队的赛程'));
  assert.match(note, /未能确认/);
  assert.match(note, /不可用/);
  assert.equal(h.blobs.length, 0);
  assert.equal(h.downloads.length, 0);
});

test('export reports none only when every league month actually loaded', async () => {
  const h = harness([['fs1.enabled', '["eng.1"]']], true);
  h.setFetch(async () => ({ ok: true, json: async () => ({ leagues: [], events: [] }) }));
  h.call("toggleFollow({ name: 'Home', teamId: '42', league: 'eng.1' })");
  await h.call('exportCalendar()');
  const note = h.elements['#icsNote'].textContent;
  assert.ok(note.includes(`未来 60 天没有关注球队的赛程`)); // 确实全量加载且无未来赛事 → 才允许说“没有”
  assert.equal(h.blobs.length, 0);
  assert.equal(h.downloads.length, 0);
});

test('empty-day generic nearby ignores disabled-league non-followed matches', async () => {
  const h = harness([['fs1.enabled', '["eng.1"]']], true);
  /* 非关注球队的比赛夹具（名字与关注球队不同，避免按名字误判为关注） */
  const nf = (id, league, day, teamId) => {
    const m = match(id, league, day, teamId, 9);
    m.home.name = 'Roma';
    return m;
  };
  /* eng.1（启用）：目标日无赛，10-17 有比赛 → generic 下一个比赛日应指向它 */
  seedMonth(h, 'eng.1', '202610', [nf('eng-later', 'eng.1', 17, '77')]);
  /* esp.1（已关注但关闭）：10-04 / 10-09 有非关注球队比赛 → generic 不该看到；
     10-17 也有比赛 → kind='any' 预览按启用联赛加载，同样不该混入 */
  seedMonth(h, 'esp.1', '202610', [
    nf('esp-before', 'esp.1', 4, '88'),
    nf('esp-after', 'esp.1', 9, '89'),
    nf('esp-sameday', 'esp.1', 17, '90'),
  ]);
  h.call("toggleFollow({ name: 'Home', teamId: '42', league: 'esp.1' });"); // 关注球队 60 天内无比赛
  h.call("state.dayKey = '2026-10-07'; state.windowStart = '2026-10-04';");
  await h.call('reload()');
  const nb = h.call('state.nearby');
  assert.ok(nb);
  /* 关注搜索：无关注赛事（esp.1 的比赛都不是关注球队） */
  assert.equal(nb.favNext, null);
  assert.equal(nb.favPrev, null);
  /* generic 搜索只算启用联赛：找到 eng.1 的 10-17，不拿 esp.1 的赛事当“其他比赛日” */
  assert.equal(nb.next && nb.next.dayKey, '2026-10-17');
  assert.equal(nb.prev, null);
  const pv = h.call('state.preview');
  assert.ok(pv);
  assert.equal(pv.dayKey, '2026-10-17');
  assert.equal(pv.kind, 'any');
  /* kind='any' 的预览只加载启用联赛：不含 esp.1 的同日比赛 */
  assert.equal(pv.matches.length, 1);
  assert.equal(pv.matches[0].id, 'eng-later');
});

test('export with only stale cached data reports inability to confirm', async () => {
  const h = harness([['fs1.enabled', '["eng.1"]']], true);
  /* 每个目标月都有过期旧缓存且零赛事：联网失败回落 stale:true → 绝不能宣称“没有” */
  const staleAt = Date.now() - 2 * 864e5;
  const today = h.call('dayKeyOf(new Date())');
  const yms = new Set();
  for (let i = 0; i < 60; i++) {
    for (const ym of h.call(`monthsForDay(addDays('${today}', ${i}))`)) yms.add(ym);
  }
  for (const lg of h.call('LEAGUES.map((l) => l.id)')) {
    for (const ym of yms) seedMonth(h, lg, ym, [], staleAt);
  }
  h.call("toggleFollow({ name: 'Home', teamId: '42', league: 'eng.1' })");
  await h.call('exportCalendar()');
  const note = h.elements['#icsNote'].textContent;
  assert.ok(!note.includes('没有关注球队的赛程'));
  assert.match(note, /未能确认/);
  assert.equal(h.blobs.length, 0);
  assert.equal(h.downloads.length, 0);
});

test('export from stale cache with fixtures still exports but flags possible gaps', async () => {
  const h = harness([['fs1.enabled', '["eng.1"]']], true);
  const staleAt = Date.now() - 2 * 864e5;
  const day = futureDayKey(10);
  const today = h.call('dayKeyOf(new Date())');
  const yms = new Set();
  for (let i = 0; i < 60; i++) {
    for (const ym of h.call(`monthsForDay(addDays('${today}', ${i}))`)) yms.add(ym);
  }
  const staleMatch = match('stale-future', 'ita.1', 1, '42', 9);
  staleMatch.start = `${day}T15:00:00.000Z`;
  const matchYms = h.call(`monthsForDay('${day}')`);
  h.call("toggleFollow({ name: 'Home', teamId: '42', league: 'ita.1' })");
  for (const lg of h.call('LEAGUES.map((l) => l.id)')) {
    for (const ym of yms) {
      seedMonth(h, lg, ym, lg === 'ita.1' && matchYms.includes(ym) ? [staleMatch] : [], staleAt);
    }
  }
  await h.call('exportCalendar()');
  assert.equal(h.downloads.length, 1);
  assert.ok(h.blobs[0].parts.join('').includes('UID:stale-future@football-schedule'));
  const note = h.elements['#icsNote'].textContent;
  assert.match(note, /已导出 1 场/); // 有缓存赛事 → 允许导出
  assert.match(note, /可能有遗漏/); // 但旧数据不能当作完整 → 必须标部分
  assert.ok(!note.includes('没有关注球队的赛程'));
});

test('export respects the 60-day window even when month cache holds farther events', async () => {
  const h = harness([['fs1.enabled', '["eng.1"]']], true);
  /* 第 60 天内的赛事：本地正午的第 59 天 */
  const inDay = futureDayKey(59);
  const inDate = new Date(`${inDay}T12:00:00`);
  const near = {
    id: 'in-window', league: 'ita.1', start: inDate.toISOString(),
    status: 'SCHEDULED', home: { name: 'Home', teamId: '42' }, away: { name: 'Away', teamId: '99' },
  };
  /* 同月但已在窗口外：优先取该月最后一天（必然 ≥ 第 60 天）；恰好是月末时退到第 61 天 */
  const monthEnd = new Date(inDate.getFullYear(), inDate.getMonth() + 1, 0, 12);
  const farDate = monthEnd.getTime() > inDate.getTime() ? monthEnd : new Date(`${futureDayKey(61)}T12:00:00`);
  const far = { ...near, id: 'out-of-window', start: farDate.toISOString() };
  h.call("toggleFollow({ name: 'Home', teamId: '42', league: 'ita.1' })");
  for (const ym of h.call(`monthsForDay('${inDay}')`)) seedMonth(h, 'ita.1', ym, [near, far]);
  await h.call('exportCalendar()');
  assert.equal(h.downloads.length, 1);
  const ics = h.blobs[0].parts.join('');
  assert.ok(ics.includes('UID:in-window@football-schedule')); // 第 60 天内保留
  assert.ok(!ics.includes('UID:out-of-window@football-schedule')); // 第 61 天或更远（同月抓取）不得进入
  assert.match(h.elements['#icsNote'].textContent, /已导出 1 场/);
});

test('date strip dots distinguish confirmed-empty from uncached days', () => {
  const h = harness([['fs1.enabled', '["eng.1"]']], true);
  h.call("state.windowStart = '2026-10-05'; state.dayKey = '2026-10-07';");
  /* 十月缓存已就位且整月无赛 → 7 天全部“确认无赛”，不算未知 */
  seedMonth(h, 'eng.1', '202610', []);
  h.call('renderDays()');
  let html = h.elements['#days'].innerHTML;
  assert.equal((html.match(/day-dot off/g) || []).length, 7);
  assert.equal((html.match(/day-dot unk/g) || []).length, 0);
  assert.ok(!html.includes('赛程未知'));
  assert.match(html, /aria-label="2026-10-05 [^"]*无所选联赛比赛"/);

  /* 另一个启用联赛没有缓存 → 覆盖不足 → 同一天变“未知” */
  h.call("state.enabled.add('esp.1'); renderDays()");
  html = h.elements['#days'].innerHTML;
  assert.equal((html.match(/day-dot unk/g) || []).length, 7);
  assert.match(html, /aria-label="2026-10-05 [^"]*赛程未知"/);
  h.call("state.enabled.delete('esp.1')");

  /* 缓存过期（赛程可能已变更）→ 同样无赛也不能确认 → unk */
  seedMonth(h, 'eng.1', '202610', [], Date.now() - 2 * 864e5);
  h.call('renderDays()');
  html = h.elements['#days'].innerHTML;
  assert.equal((html.match(/day-dot unk/g) || []).length, 7);
  assert.equal((html.match(/aria-label="2026-10-05 [^"]*赛程未知"/) || []).length, 1);
  assert.equal((html.match(/day-dot off/g) || []).length, 0);

  /* 加入两场比赛：有赛日 hollow（无关注）/ fill（有关注），其余仍 off */
  const noFav = match('nf', 'eng.1', 6, '77', 9);
  noFav.home.name = 'Roma'; // 名字是身份权威：非关注球队必须用不同队名
  seedMonth(h, 'eng.1', '202610', [noFav, match('fav', 'eng.1', 7, '42', 9)]);
  h.call("toggleFollow({ name: 'Home', teamId: '42', league: 'eng.1' })");
  html = h.elements['#days'].innerHTML;
  assert.equal((html.match(/day-dot fill/g) || []).length, 1);
  assert.equal((html.match(/day-dot hollow/g) || []).length, 1);
  assert.equal((html.match(/day-dot off/g) || []).length, 5);
  assert.match(html, /aria-label="2026-10-07 [^"]*有关注球队比赛"/);
  assert.match(html, /aria-label="2026-10-06 [^"]*有其他比赛"/);
  assert.match(html, /aria-label="2026-10-05 [^"]*无所选联赛比赛"/);

  /* 无缓存月份 → 未知，aria-label 明示“赛程未知” */
  h.call("state.windowStart = '2026-07-05'; state.dayKey = '2026-07-07'; renderDays()");
  html = h.elements['#days'].innerHTML;
  assert.equal((html.match(/day-dot unk/g) || []).length, 7);
  assert.equal((html.match(/aria-label="2026-07-05 [^"]*赛程未知"/) || []).length, 1);
  assert.equal((html.match(/day-dot off/g) || []).length, 0);
});

test('cross-tab storage event refreshes follows without clobbering other prefs', () => {
  const h = harness([
    ['fs1.enabled', '["ita.1"]'],
    ['fs1.followed', '["intermilan"]'],
    ['fs1.day', '2026-09-22'],
    ['fs1.view', 'day'],
  ], true);
  h.call('render()');
  assert.equal(h.elements['#followCount'].textContent, '1');

  /* 另一标签页（独立上下文）取消了该关注：其写入值由真实 app 代码产生 */
  const peer = harness(h.entries(), true);
  peer.call("toggleFollow({ name: 'Internazionale', teamId: '115' })");
  const emptyVal = peer.storage.getItem('fs1.followed');
  h.storage.setItem('fs1.followed', emptyVal);
  h.fireWindow('storage', { key: 'fs1.followed', newValue: emptyVal, storageArea: h.storage });
  assert.equal(h.call('state.followed.length'), 0);
  assert.equal(h.elements['#followCount'].textContent, '');
  assert.match(h.elements['#followTeams'].innerHTML, /follow-empty/);
  /* 处理器只读不写：其他偏好分毫未动 */
  assert.equal(h.storage.getItem('fs1.enabled'), '["ita.1"]');
  assert.equal(h.storage.getItem('fs1.day'), '2026-09-22');
  assert.equal(h.storage.getItem('fs1.view'), 'day');
  assert.equal(h.storage.getItem('fs1.followed'), emptyVal);

  /* 另一标签页改为关注罗马 → 本页立即反映 */
  const peer2 = harness(h.entries(), true);
  peer2.call("toggleFollow({ name: 'Roma', teamId: '112', league: 'ita.1' })");
  const romaVal = peer2.storage.getItem('fs1.followed');
  h.storage.setItem('fs1.followed', romaVal);
  h.fireWindow('storage', { key: 'fs1.followed', newValue: romaVal, storageArea: h.storage });
  assert.equal(h.elements['#followCount'].textContent, '1');
  assert.ok(h.elements['#followTeams'].innerHTML.includes('罗马'));
  assert.equal(h.call('isFollowed({ name: "Roma" })'), true);
  assert.equal(h.storage.getItem('fs1.enabled'), '["ita.1"]');
  assert.equal(h.storage.getItem('fs1.day'), '2026-09-22');

  /* 非关注/联赛键的事件被完全忽略：不回读 day，也不写回 */
  const dayBefore = h.call('state.dayKey');
  const otherTabDay = h.call("addDays(dayKeyOf(new Date()), -1)");
  h.storage.setItem('fs1.day', otherTabDay);
  h.fireWindow('storage', { key: 'fs1.day', newValue: otherTabDay, storageArea: h.storage });
  assert.equal(h.call('state.dayKey'), dayBefore);
  assert.equal(h.storage.getItem('fs1.day'), otherTabDay);
});

test('Eastern-date rollover covers the adjacent monthly bucket', () => {
  const h = harness();
  assert.equal(h.call("etBucketOf(new Date('2026-10-01T01:00:00Z'))"), '20260930');
  assert.equal(h.call("etBucketOf(new Date('2026-10-01T12:00:00Z'))"), '20261001');
});

test('countdownText 分档与边界', () => {
  const h = harness([], true);
  const base = Date.parse('2026-10-01T12:00:00Z');
  const at = (iso) => h.call(`countdownText('${iso}', ${base})`);
  assert.equal(at('2026-10-01T12:00:30Z'), '1 分钟后');
  assert.equal(at('2026-10-01T12:30:00Z'), '30 分钟后');
  assert.equal(at('2026-10-01T15:00:00Z'), '3 小时后');
  assert.equal(at('2026-10-02T11:59:00Z'), '23 小时后');
  assert.equal(at('2026-10-02T12:00:00Z'), '1 天后');
  assert.equal(at('2026-10-07T11:59:00Z'), '5 天后');
  assert.equal(at('2026-10-08T12:00:00Z'), '');
  assert.equal(at('2026-10-01T11:59:00Z'), '');
});

test('week view groups by day, skips empty days, marks followed', async () => {
  const h = harness([], true);
  h.context.fixtures = [
    match('w1', 'eng.1', 22, '42'),
    match('w2', 'eng.1', 22, '77'),
    match('w3', 'eng.2', 23, '88'),
  ];
  h.call("toggleFollow({ name: 'Home', teamId: '42' })");
  await h.call(`(async () => {
    state.view = 'week';
    state.windowStart = '2026-09-21';
    state.dayKey = '2026-09-22';
    state.weekDays = [
      { dayKey: '2026-09-22', matches: fixtures.slice(0, 2) },
      { dayKey: '2026-09-23', matches: [fixtures[2]] },
      { dayKey: '2026-09-24', matches: [] },
    ];
    render();
  })()`);
  const html = h.elements['#list'].innerHTML;
  assert.equal((html.match(/class="wday"/g) || []).length, 2); // 空日跳过
  assert.ok(html.includes('class="match st-SCHEDULED compact"'));
  assert.ok(html.includes('关注 1'));
  assert.ok(html.includes('id="wday-2026-09-23"'));
  assert.ok(!html.includes('wday-2026-09-24'));
  assert.equal(h.call('currentMatches().length'), 3);
});

test('week view keeps incomplete days distinct from a confirmed empty week', () => {
  const h = harness([], true);
  h.call(`state.view = 'week'; state.windowStart = '2026-09-21';
    state.weekDays = [{ dayKey: '2026-09-22', matches: [], pending: true }]; render()`);
  const html = h.elements['#list'].innerHTML;
  assert.match(html, /数据不完整，无法确认是否有比赛/);
  assert.match(html, /重试/);
  assert.doesNotMatch(html, /这一周没有赛程/);
});

test('week view applies a background update received before the initial week completes', async () => {
  const h = harness([], true);
  h.context.freshMatch = match('fresh', 'eng.1', 21);
  h.call(`state.view = 'week'; state.windowStart = '2026-09-21';
    loadDayVisible = async (key, opts) => {
      if (key === '2026-09-21') opts.onUpdate({ matches: [freshMatch], failed: [], stale: false, pending: false });
      return { matches: [], failed: [], stale: false, pending: true };
    }`);
  await h.call('reloadWeek()');
  assert.equal(h.call("state.weekDays[0].matches[0]?.id"), 'fresh');
  assert.equal(h.call('state.weekDays[0].pending'), false);
});

test('followed matches remain visible when their league is disabled', async () => {
  const h = harness([['fs1.enabled', '["eng.1"]']], true);
  h.call("toggleFollow({ name: 'Home', teamId: '42', league: 'esp.1' })");
  h.context.fixtures = [match('followed', 'esp.1', 22, '42'), match('other', 'esp.1', 22, '77')];
  h.context.fixtures[1].home.name = 'Different';
  const ids = h.call('fixtures.filter(matchVisible).map((m) => m.id)');
  assert.deepEqual([...ids], ['followed']);
  assert.ok([...h.call('fetchLeagues()')].includes('esp.1'));
});

test('minute tick requests a refresh after a scheduled kickoff passes', () => {
  const h = harness([], true);
  h.context.fixture = match('kickoff', 'eng.1', 22);
  h.call('state.data = { matches: [fixture] }; state.view = "day"; state.loading = false; refreshCalls = 0; reload = () => { refreshCalls++ }');
  h.advance(new Date(h.context.fixture.start).getTime() - Date.now() + 60_000);
  h.call('minuteTick()');
  assert.equal(h.call('refreshCalls'), 1);
});

test('buildIcs 生成合法 iCalendar：转义、VALARM、行折叠', () => {
  const h = harness([], true);
  const m = match('evt-1', 'eng.1', 28);
  m.home.name = 'A, B; C';
  h.context.fixture = m;
  const ics = h.call("buildIcs([fixture], { title: 'T' })");
  assert.ok(ics.includes('BEGIN:VCALENDAR'));
  assert.ok(ics.includes('BEGIN:VEVENT'));
  assert.ok(ics.includes('UID:evt-1@football-schedule'));
  assert.ok(ics.includes(`DTSTART:${new Date(m.start).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`));
  assert.ok(ics.includes('TRIGGER:-PT15M'));
  assert.ok(ics.includes('ACTION:DISPLAY'));
  assert.ok(ics.includes('A\\, B\\; C'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  for (const line of ics.split('\r\n')) {
    if (line) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `line too long: ${line}`);
  }
});
