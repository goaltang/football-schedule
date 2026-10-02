'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { tsImport } from 'tsx/esm/api';
import { tonightDayKey, tonightRange, summarizeTonight } from '../src/domain/tonight.js';
const { Hero } = await tsImport('../src/components/Hero.tsx', import.meta.url);
const { DateBar } = await tsImport('../src/components/DateBar.tsx', import.meta.url);
const { LeagueChips, LeagueFilters } = await tsImport('../src/components/LeagueFilters.tsx', import.meta.url);
const { FollowTeams, SearchResults } = await tsImport('../src/components/FollowManager.tsx', import.meta.url);
const { DaySchedule, WeekSchedule, TonightSchedule } = await tsImport('../src/components/ScheduleList.tsx', import.meta.url);
const { MatchRow } = await tsImport('../src/components/MatchRow.tsx', import.meta.url);

const root = fileURLToPath(new URL('../', import.meta.url));
// The VM isolates storage, clock and requests. React views are the same components
// used by the browser; no legacy HTML renderer is kept for the tests.
const scriptSource = (file) => fs.readFileSync(path.join(root, file), 'utf8')
  .replace(/^import .*?;\n/gm, '').replace(/^export \{[\s\S]*?\};?\n?/gm, '');
const dataSource = scriptSource('data.js');
const appSource = scriptSource('app.js');

test('tonight uses local calendar boundaries across months, years and leap days', () => {
  for (const [day, next] of [['2026-09-30', '2026-10-01'], ['2026-12-31', '2027-01-01'], ['2028-02-29', '2028-03-01']]) {
    const range = tonightRange(day);
    assert.deepEqual(range.dayKeys, [day, next]);
    assert.equal(range.start, new Date(`${day}T18:00:00`).getTime());
    assert.equal(range.end, new Date(`${next}T06:00:00`).getTime());
    assert.equal(tonightDayKey(new Date(`${next}T00:00:00`).getTime()), day);
    assert.equal(tonightDayKey(new Date(`${next}T05:59:59`).getTime()), day);
    assert.equal(tonightDayKey(new Date(`${next}T06:00:00`).getTime()), next);
  }
});

test('tonight includes 18:00, excludes 06:00, orders and deduplicates cross-day matches', () => {
  const fixture = (id, start) => ({ id, start });
  const evening = fixture('evening', '2026-09-30T18:00:00');
  const midnight = fixture('midnight', '2026-10-01T00:00:00');
  const dawn = fixture('dawn', '2026-10-01T05:59:59');
  const summary = summarizeTonight([
    { matches: [midnight, evening, fixture('too-early', '2026-09-30T17:59:59')], fetchedAt: 100 },
    { matches: [dawn, midnight, fixture('too-late', '2026-10-01T06:00:00'), fixture('invalid', 'unknown')], fetchedAt: 200 },
  ], '2026-09-30');
  assert.deepEqual(summary.matches.map((match) => match.id), ['evening', 'midnight', 'dawn']);
  assert.equal(summary.fetchedAt, 200);
  assert.equal(summarizeTonight(null, '2026-09-30'), null);
});

test('tonight retains uncertainty and known matches when one date fails or is still updating', () => {
  const summary = summarizeTonight([
    { matches: [{ id: 'known', start: '2026-09-30T20:00:00' }], failed: ['eng.1'], fetchedAt: 100 },
    { matches: [], failed: ['eng.1', 'esp.1'], error: true, stale: true, pending: true },
  ], '2026-09-30');
  assert.equal(summary.matches.length, 1);
  assert.deepEqual(summary.failed, ['eng.1', 'esp.1']);
  for (const flag of ['error', 'stale', 'pending']) assert.equal(summary[flag], true);
});

test('tonight loads both dates and keeps a completed early update before the initial result', async () => {
  const h = harness([], true);
  h.context.evening = { ...match('evening', 'eng.1', 30), start: '2026-09-30T18:00:00' };
  h.context.midnight = { ...match('midnight', 'eng.1', 1), start: '2026-10-01T00:30:00', live: true, status: 'LIVE', fetchedAt: Date.now() };
  h.call(`state.view = 'tonight'; state.dayKey = '2026-09-30'; state.windowStart = '2026-09-27';
    const requestedNights = []; const nightUpdates = new Map();
    loadDayVisible = async (key, opts) => {
      requestedNights.push(key); nightUpdates.set(key, opts.onUpdate);
      const matches = key === '2026-09-30' ? [evening] : [midnight];
      opts.onUpdate({ dayKey: key, matches, failed: [], pending: false, fetchedAt: Date.now() });
      return { dayKey: key, matches: [], failed: [], pending: true, fetchedAt: Date.now() };
    }; let nightPolls = 0; scheduleLivePoll = () => { nightPolls++; }`);
  await h.call("reloadRange('tonight')");
  assert.deepEqual([...h.call('requestedNights')].sort(), ['2026-09-30', '2026-10-01']);
  assert.deepEqual([...h.call('getSnapshot().data.matches.map((m) => m.id)')], ['evening', 'midnight']);
  assert.equal(h.call('getSnapshot().data.pending'), false);
  assert.equal(h.elements['#heroDate'].textContent, '今晚');
  assert.equal(h.elements['#heroWd'].textContent, '18:00–次日06:00');
  assert.match(h.elements['#list'].innerHTML, /09\.30.*晚间/);
  assert.match(h.elements['#list'].innerHTML, /10\.01.*次日凌晨/);
  assert.equal(h.call('currentMatches().length'), 2);
  assert.match(h.hero(), /进行中比分约每分钟自动更新/);
  h.call(`nightUpdates.get('2026-10-01')({ dayKey: '2026-10-01', matches: [], failed: ['eng.1'], fetchedAt: Date.now() })`);
  assert.equal(h.call('getSnapshot().data.matches.length'), 1);
  assert.match(h.elements['#list'].innerHTML, /英超赛程未能加载/);
  assert.equal(h.call('nightPolls'), 2);
  h.call(`reload = () => {}; gotoDay('2026-10-01');
    nightUpdates.get('2026-10-01')({ dayKey: '2026-10-01', matches: [midnight], failed: [], fetchedAt: Date.now() })`);
  assert.equal(h.call('getSnapshot().view'), 'day');
  assert.equal(h.call('getSnapshot().data'), null);
  assert.equal(h.storage.getItem('fs1.view'), 'day');
});

test('tonight renders followed matches once and ignores live matches outside the night window', () => {
  const h = harness([['fs1.followed', '["manchesterunited","arsenal"]']], true);
  h.context.included = { ...match('followed', 'eng.1', 30), start: '2026-09-30T20:00:00',
    home: { name: 'Manchester United', teamId: '360' }, away: { name: 'Arsenal', teamId: '359' } };
  h.context.excluded = { ...match('outside-live', 'eng.1', 30), start: '2026-09-30T12:00:00', live: true, status: 'LIVE' };
  h.call(`state.view = 'tonight'; state.dayKey = '2026-09-30'; state.loading = false;
    state.tonightDays = [{ matches: [excluded, included], failed: [], fetchedAt: Date.now() },
      { matches: [], failed: [], fetchedAt: Date.now() }]; publish()`);
  assert.equal((h.elements['#list'].innerHTML.match(/class="match /g) || []).length, 1);
  assert.equal(h.elements['#heroCount'].textContent, '1 场 · 关注 1 场');
  assert.doesNotMatch(h.hero(), /比分.*自动/);
  assert.equal(h.call('currentMatches().some(m => m.live)'), false);
  h.call('reload = () => {}; setOnlyFollowed(true)');
  assert.equal(h.elements['#heroCount'].textContent, '1 场 · 关注球队');
  h.call('state.tonightDays[0].matches = [excluded]; publish()');
  assert.match(h.elements['#list'].innerHTML, /今晚暂无关注球队的比赛/);
  assert.doesNotMatch(h.elements['#list'].innerHTML, /赛程预览/);
  h.call('state.tonightDays[1].failed = ["eng.1"]; publish()');
  assert.match(h.elements['#list'].innerHTML, /暂时无法确认今晚是否有比赛/);
  assert.doesNotMatch(h.elements['#list'].innerHTML, /今晚暂无关注/);
});

test('tonight restores the current night, survives midnight and moves forward at 06:00', () => {
  const h = harness([['fs1.view', 'tonight'], ['fs1.day', '2026-01-01']], true);
  h.advance(new Date('2026-09-30T23:59:00').getTime() - Date.now());
  h.call(`loadPrefs(); reload = () => { nightReloads++; }; let nightReloads = 0; state.tonightDays = []`);
  assert.equal(h.call('state.dayKey'), '2026-09-30');
  h.advance(2 * 60e3);
  h.call('minuteTick()');
  assert.equal(h.call('state.dayKey'), '2026-09-30');
  assert.equal(h.call('nightReloads'), 0);
  h.advance(6 * 3600e3);
  h.call('minuteTick()');
  assert.equal(h.call('state.dayKey'), '2026-10-01');
  assert.equal(h.call('state.tonightDays'), null);
  assert.equal(h.call('nightReloads'), 1);
  assert.equal(h.storage.getItem('fs1.day'), '2026-10-01');
  h.advance(24 * 3600e3);
  h.call("setView('tonight')");
  assert.equal(h.call('state.dayKey'), '2026-10-02');
  assert.equal(h.call('nightReloads'), 2);
});

test('reconnecting in tonight retries its missing coverage even when the previously selected day was fresh', () => {
  const h = harness([], true);
  h.advance(new Date('2026-09-30T19:00:00').getTime() - Date.now());
  h.call(`state.view = 'tonight'; state.dayKey = '2026-09-30'; state.loading = false;
    state.data = { matches: [], failed: [], fetchedAt: Date.now() };
    state.tonightDays = [{ matches: [], failed: ['eng.1'] }, { matches: [], failed: [], fetchedAt: Date.now() }];
    let reconnects = 0; reload = () => { reconnects++; }; onOnline()`);
  assert.equal(h.call('reconnects'), 1);
  h.call('state.tonightDays[0].failed = []; state.tonightDays[0].fetchedAt = Date.now(); onOnline()');
  assert.equal(h.call('reconnects'), 1);
});

test('loading an unrelated night date does not claim that a fresh live score is being updated', () => {
  const h = harness([], true);
  h.advance(new Date('2026-09-30T19:00:00').getTime() - Date.now());
  h.context.fixture = { ...match('evening-live', 'eng.1', 30), start: '2026-09-30T18:30:00',
    live: true, status: 'LIVE', fetchedAt: h.call('Date.now()') };
  h.context.outside = { ...h.context.fixture, id: 'outside-live', start: '2026-10-01T14:00:00' };
  h.call(`state.view = 'tonight'; state.dayKey = '2026-09-30'; state.loading = false;
    state.tonightDays = [{ dayKey: '2026-09-30', matches: [fixture], failed: [], fetchedAt: Date.now() },
      { dayKey: '2026-10-01', matches: [outside], pending: true, failed: [] }]; publish()`);
  assert.match(h.hero(), /进行中比分约每分钟自动更新/);
  assert.doesNotMatch(h.hero(), /正在更新比分/);
  h.call('state.tonightDays[0].pending = true; publish()');
  assert.match(h.hero(), /正在更新比分/);
});

test('national competition filters preserve saved club choices', () => {
  const h = harness([['fs1.enabled', '["eng.1","esp.1"]']], true);
  assert.deepEqual([...h.call('loadEnabled()')], ['eng.1', 'esp.1']);
  h.call('publish()');
  assert.match(h.elements['#chips'].innerHTML, /aria-label="俱乐部赛事"/);
  assert.match(h.elements['#chips'].innerHTML, /aria-label="国家队赛事"/);
  assert.match(h.elements['#chips'].innerHTML, /data-league="fifa.friendly" aria-pressed="false"/);
  assert.equal(h.elements['#filterCount'].textContent, '已选 2');
  h.call('state.enabled.add("fifa.friendly"); saveEnabled(); publish()');
  assert.match(h.elements['#chips'].innerHTML, /data-league="fifa.friendly" aria-pressed="true"/);
  assert.deepEqual(JSON.parse(h.storage.getItem('fs1.enabled')), ['eng.1', 'esp.1', 'fifa.friendly']);
});

test('batch league choices persist once, reload once and preserve unrelated preferences', () => {
  const h = harness([['fs1.enabled', '["eng.1","esp.1"]']], true);
  const originalSetItem = h.storage.setItem;
  const writes = [];
  h.storage.setItem = (key, value) => { writes.push(key); originalSetItem(key, value); };
  h.call('let selectionReloads = 0; reload = () => { selectionReloads++; }');
  const day = h.call('state.dayKey');
  h.call('setLeagues(["uefa.champions", "uefa.europa", "uefa.champions", "unknown"])');
  assert.deepEqual(JSON.parse(h.storage.getItem('fs1.enabled')), ['uefa.champions', 'uefa.europa']);
  assert.deepEqual(writes, ['fs1.enabled']);
  assert.equal(h.call('selectionReloads'), 1);
  assert.equal(h.call('state.dayKey'), day);
  h.call('setLeagues(["uefa.europa", "uefa.champions"]); setLeagues([]); setLeagues(["unknown"])');
  assert.equal(h.call('selectionReloads'), 1);
  assert.deepEqual(writes, ['fs1.enabled']);
});

test('the last selected competition cannot be removed and obsolete saved IDs are ignored', () => {
  const h = harness([['fs1.enabled', '["eng.1","obsolete"]']], true);
  assert.deepEqual([...h.call('state.enabled')], ['eng.1']);
  h.call('let selectionReloads = 0; reload = () => { selectionReloads++; }; toggleLeague("eng.1")');
  assert.deepEqual([...h.call('state.enabled')], ['eng.1']);
  assert.equal(h.call('selectionReloads'), 0);
  h.storage.setItem('fs1.enabled', '["obsolete"]');
  assert.deepEqual([...h.call('loadEnabled()')], [...h.call('DEFAULT_ENABLED')]);
});

test('national team search merges competitions and supports Chinese names and nicknames', () => {
  const h = harness([], true);
  h.context.catalog = h.call(`buildCatalog([
    { leagueId: 'fifa.friendly', teams: [
      { id: '560', name: 'China', short: '', logo: '' },
      { id: '202', name: 'Argentina', short: '', logo: '' },
      { id: '203', name: 'Brazil', short: '', logo: '' }] },
    { leagueId: 'fifa.worldq.afc', teams: [{ id: '560', name: 'China', short: '', logo: '' }] },
  ])`);
  for (const q of ['国足', '中国', '中国队', '中国国家队', '中国男足', 'China PR']) {
    assert.deepEqual([...h.call(`searchTeams(catalog, ${JSON.stringify(q)}).map((e) => e.id)`)], ['560']);
  }
  for (const q of ['阿根廷', 'Argentina', '阿根廷队']) {
    assert.deepEqual([...h.call(`searchTeams(catalog, ${JSON.stringify(q)}).map((e) => e.id)`)], ['202']);
  }
  assert.equal(h.call('catalog.length'), 3);
  assert.deepEqual([...h.call('catalog.find((t) => t.id === "560").leagues')], ['fifa.friendly', 'fifa.worldq.afc']);
  assert.equal(h.call('zhName("Türkiye")'), '土耳其');
  assert.equal(h.call('zhName("Congo DR")'), '刚果民主共和国');
  assert.equal(h.call('zhName("Congo")'), '刚果共和国');
});

test('following a national team from one match finds its disabled qualifiers and cup matches', async () => {
  const h = harness([], true);
  const day = futureDayKey(2);
  h.call('state.enabled = new Set(["eng.1"]); state.data = null; state.followed = []');
  h.call('let reloadCalls = 0; reload = () => { reloadCalls++; }');
  h.call('toggleFollow({ name: "China", teamId: "560", league: "fifa.friendly" })');
  const make = (id, league, home) => ({
    id, league, start: new Date(`${day}T12:00:00`).toISOString(), status: 'SCHEDULED',
    home: { teamId: home === 'China' ? '560' : '203', name: home }, away: { teamId: '999', name: 'Japan' },
  });
  for (const league of h.call('fetchLeagues()')) {
    for (const ym of h.call(`monthsForDay(${JSON.stringify(day)})`)) {
      const events = league === 'fifa.worldq.afc' ? [make('qualifier', league, 'China')]
        : league === 'afc.asian.cup' ? [make('cup', league, 'China')]
          : league === 'fifa.friendly' ? [make('other-national-team', league, 'Brazil')] : [];
      seedMonth(h, league, ym, events);
    }
  }
  const r = await h.call(`loadDayVisible(${JSON.stringify(day)})`);
  assert.deepEqual([...r.matches.map((m) => m.id)].sort(), ['cup', 'qualifier']);
  assert.deepEqual(JSON.parse(h.storage.getItem('fs1.followed'))[0].leagues, ['fifa.friendly']);
  assert.ok(h.call('followedLeagues().includes("fifa.worldq.conmebol")'));
  assert.equal(h.call('reloadCalls'), 1);
  h.call('toggleFollow({ name: "China", teamId: "560", league: "fifa.friendly" })');
  assert.deepEqual([...h.call('fetchLeagues()')], ['eng.1']);
  assert.equal(h.call('reloadCalls'), 2);
  h.call('toggleFollow({ name: "China", teamId: "560", league: "fifa.friendly" }); unfollowAt(0)');
  assert.equal(h.call('reloadCalls'), 4);
  assert.deepEqual([...h.call('fetchLeagues()')], ['eng.1']);
});

test('same-origin team lists support cold national-team search without contacting ESPN', async () => {
  const h = harness();
  const teams = [{ id: '560', name: 'China', short: '', logo: '' }, { id: '202', name: 'Argentina', short: '', logo: '' }];
  const requests = [];
  h.context.snap = { leagues: {
    'fifa.friendly': { fetchedAt: Date.now(), teams },
    'fifa.worldq.afc': { fetchedAt: Date.now(), teams: [teams[0]] },
  } };
  h.setFetch((url) => {
    requests.push(String(url));
    assert.equal(String(url), 'snapshot/teams.json');
    return { ok: true, json: async () => h.context.snap };
  });
  const results = await h.call('Promise.all([ensureTeams("fifa.friendly"), ensureTeams("fifa.worldq.afc")])');
  assert.equal(requests.length, 1);
  assert.equal(results[0].teams.length, 2);
  assert.equal(results[1].teams[0].name, 'China');
  assert.equal(results[0].failed, false);
  assert.equal(results[0].stale, false);
  await h.call('ensureTeams("fifa.friendly")');
  assert.equal(requests.length, 1);
});

test('national follow changes from another tab reload the view without rewriting preferences', () => {
  const h = harness([['fs1.enabled', '["eng.1"]']], true);
  h.call('let nationalReloads = 0; reload = () => { nationalReloads++; }; state.followed = []');
  const dayBefore = h.call('state.dayKey');
  h.storage.setItem('fs1.followed', JSON.stringify([{ id: '658', name: 'China', names: ['china'], leagues: ['fifa.friendly'] }]));
  let writes = 0;
  const set = h.storage.setItem;
  h.storage.setItem = (...args) => { writes++; set(...args); };
  h.fireWindow('storage', { key: 'fs1.followed' });
  assert.equal(h.call('nationalReloads'), 1);
  assert.ok(h.call('fetchLeagues().includes("afc.asian.cup")'));
  assert.equal(h.call('state.dayKey'), dayBefore);
  assert.equal(writes, 0);
  set('fs1.followed', '[]');
  h.fireWindow('storage', { key: 'fs1.followed' });
  assert.equal(h.call('nationalReloads'), 2);
  assert.equal(h.call('state.followed.length'), 0);
  assert.equal(writes, 0);
});

test('bad and older team snapshots never erase a newer team list', async () => {
  const now = Date.now();
  const h = harness([['fs1t|fifa.friendly', JSON.stringify({ fetchedAt: now, teams: [{ id: '560', name: 'China' }] })]]);
  h.setFetch(() => ({ ok: true, json: async () => ({ leagues: {
    'fifa.friendly': { fetchedAt: now - 1000, teams: [{ id: '202', name: 'Argentina' }] },
    'afc.asian.cup': { fetchedAt: now, teams: [{ id: '560' }] },
    'fifa.worldq.afc': { fetchedAt: now, teams: [] },
  } }) }));
  await h.call('seedTeamsFromSnapshot()');
  assert.equal(h.call('readTeamsCache("fifa.friendly").teams[0].name'), 'China');
  assert.equal(h.call('readTeamsCache("afc.asian.cup")'), null);
  assert.equal(h.call('readTeamsCache("fifa.worldq.afc")'), null);
});

test('national requests ask for full monthly fixtures and team lists', async () => {
  const h = harness();
  const events = Array.from({ length: 131 }, (_, id) => ({ id, date: '2026-03-26T12:00:00Z', competitions: [] }));
  const teams = Array.from({ length: 193 }, (_, id) => [String(id), `Country ${id}`, '']);
  h.setFetch((url) => {
    if (String(url).includes('snapshot/')) return { ok: true, json: async () => ({ months: {} }) };
    assert.equal(new URL(url).searchParams.get('limit'), '1000');
    return { ok: true, json: async () => String(url).includes('/teams') ? teamsJson(teams) : { events } };
  });
  const month = await h.call('fetchMonth("fifa.friendly", "202603")');
  const roster = await h.call('ensureTeams("fifa.friendly")');
  assert.equal(month.data.events.length, 131);
  assert.equal(roster.teams.length, 193);
});

test('an invalid scoreboard response cannot confirm an empty national matchday', async () => {
  const old = Date.now() - 24 * 3600e3;
  const h = harness([monthCache('fifa.friendly', [match('known-national-match', 'fifa.friendly', 26)], old)]);
  h.setFetch(() => ({ ok: true, json: async () => ({ error: 'unavailable competition' }) }));
  const r = await h.call('ensureMonth("fifa.friendly", "202609", { force: true })');
  assert.equal(r.data.events[0].id, 'known-national-match');
  assert.equal(r.data.fetchedAt, old);
  assert.equal(r.stale, true);
});

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
  let heroMarkup = () => '';
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
      '#followToggle', '#followCount', '#followManager', '#followTeams', '#followSearch', '#followResults',
      '#viewDay', '#viewWeek']) elements[selector] = el(selector);
    elements['#followManager'].setAttribute('hidden', ''); // 与 index.html 初始一致：面板默认收起
    elements['#followToggle'].setAttribute('aria-expanded', 'false');
  }
  const winListeners = new Map();
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
      removeEventListener(type, fn) {
        const list = this.listeners.get(type) || [];
        const index = list.indexOf(fn);
        if (index >= 0) list.splice(index, 1);
      },
      dispatch(type, event) {
        for (const fn of [...(this.listeners.get(type) || [])]) fn(event);
      },
      createElement: (tag) => el(tag),
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
    vm.runInContext(scriptSource('config.js'), context);
    vm.runInContext(scriptSource('team-names.js'), context);
  }
  vm.runInContext(dataSource, context, { filename: 'data.js' });
  if (withApp) {
    for (const file of ['src/domain/format.js', 'src/domain/following.js', 'src/domain/catalog.js', 'src/domain/presentation.js', 'src/domain/tonight.js']) vm.runInContext(scriptSource(file), context);
    vm.runInContext(appSource, context, { filename: 'app.js' });
    const methods = ['getSnapshot', 'gotoDay', 'setView', 'setOnlyFollowed', 'reload', 'toggleLeague', 'setLeagues', 'toggleFilters', 'toggleFollowPanel', 'toggleFollow', 'unfollowAt', 'setSearchQuery', 'loadCatalog', 'followSearchResult', 'isFollowed', 'matchHasFollowed', 'dayDotState', 'followDisplayName', 'followMetaText', 'followNextText', 'scheduleStatus', 'scheduleNotice'];
    const api = Object.fromEntries(methods.map((name) => [name, (...args) => {
      context.__args = args;
      return vm.runInContext(`${name}(...__args)`, context);
    }]));
    const markup = (Component, extra = {}) => renderToStaticMarkup(createElement(Component, { state: api.getSnapshot(), api, ...extra }));
    heroMarkup = () => markup(Hero);
    const paint = () => {
      const state = api.getSnapshot();
      elements['#list'].innerHTML = markup(state.view === 'tonight' ? TonightSchedule : state.view === 'week' ? WeekSchedule : DaySchedule);
      elements['#chips'].innerHTML = markup(LeagueChips);
      elements['#days'].innerHTML = /id="days">([\s\S]*?)<\/div>/.exec(markup(DateBar))[1];
      elements['#followTeams'].innerHTML = markup(FollowTeams);
      elements['#followResults'].innerHTML = markup(SearchResults);
      const filters = markup(LeagueFilters);
      elements['.filters'].innerHTML = filters;
      elements['#refresh'].setAttribute('aria-busy', /id="refresh" aria-busy="([^"]*)"/.exec(filters)[1]);
      elements['#filterCount'].textContent = /id="filterCount">([^<]*)/.exec(filters)[1];
      elements['#followCount'].textContent = state.followed.length ? String(state.followed.length) : '';
      elements['#followToggle'].setAttribute('aria-expanded', String(state.followOpen));
      if (state.followOpen) elements['#followManager'].removeAttribute('hidden');
      else elements['#followManager'].setAttribute('hidden', '');
      const hero = markup(Hero);
      for (const id of ['heroDate', 'heroWd', 'heroRel', 'heroCount', 'updated']) elements[`#${id}`].textContent = new RegExp(`id="${id}">([^<]*)`).exec(hero)[1];
    };
    context.__paint = paint;
    vm.runInContext('subscribe(__paint)', context);
    context.matchRow = (match, options = {}) => markup(MatchRow, { match, ...options });
    paint();
    vm.runInContext('start(); ++loadSeq', context); // Invalidate the asynchronous boot load.
    elements['#followTeams'].addEventListener('click', (event) => api.unfollowAt(Number(event.target.closest('[data-follow-idx]').dataset.followIdx)));
    elements['#followSearch'].addEventListener('input', (event) => api.setSearchQuery(event.target.value));
    elements['#followResults'].addEventListener('click', (event) => api.followSearchResult(event.target.closest('[data-search-id]').dataset.searchId));
  }
  return {
    context,
    storage,
    elements,
    hero: () => heroMarkup(),
    attempts: () => attempts,
    setFetch: (fn) => { fetchImpl = fn; },
    call: (expression) => vm.runInContext(expression, context),
    advance: (ms) => { nowOffset += ms; },
    entries: () => [...values.entries()],
    fireWindow: (type, event) => {
      for (const fn of [...(winListeners.get(type) || [])]) fn(event);
    },
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

test('failed live refresh preserves score age even when the fallback snapshot is fresh', async () => {
  const h = harness();
  const now = Date.now();
  const old = now - 3 * 3600e3;
  const day = h.call('dayKeyOf(new Date())');
  const live = { ...match('live-score', 'eng.1', 1), start: new Date(now).toISOString(),
    status: 'LIVE', live: true, home: { name: 'Arsenal', teamId: '359', score: 1 } };
  for (const league of ['eng.1', 'esp.1']) for (const ym of h.call(`monthsForDay('${day}')`)) {
    h.storage.setItem(`fs1|m|${league}|${ym}`, JSON.stringify({ source: 'snapshot',
      fetchedAt: league === 'eng.1' ? old : now, league: { id: league, logo: '' }, events: league === 'eng.1' ? [live] : [] }));
  }
  const result = await h.call(`loadDay('${day}', { leagues: ['eng.1', 'esp.1'], force: true })`);
  assert.equal(result.stale, false); // The schedule is still usable for six hours.
  assert.equal(result.fetchedAt, now);
  assert.equal(result.matches[0].fetchedAt, old);
  assert.equal(result.matches[0].refreshFailed, true);
  assert.equal(result.matches[0].home.score, 1);
  assert.equal(h.call('readCache("eng.1", monthsForDay(dayKeyOf(new Date()))[0]).events[0].refreshFailed'), undefined);

  h.setFetch((url) => ({ ok: true, json: async () => ({ events: String(url).includes('/eng.1/') ? [{
    id: 'live-score', date: live.start, status: { type: { state: 'in' }, displayClock: '35' },
    competitions: [{ competitors: [
      { homeAway: 'home', team: { id: '359', displayName: 'Arsenal' }, score: '2' },
      { homeAway: 'away', team: { id: '99', displayName: 'Away' }, score: '0' },
    ] }],
  }] : [] }) }));
  const recovered = await h.call(`loadDay('${day}', { leagues: ['eng.1', 'esp.1'], force: true })`);
  assert.ok(recovered.matches[0].fetchedAt > old);
  assert.equal(recovered.matches[0].refreshFailed, false);
  assert.equal(recovered.matches[0].home.score, 2);
});

test('live score hints keep the oldest visible score time across day and week views', () => {
  const h = harness([], true);
  const now = new Date('2026-10-01T12:00:00').getTime();
  h.advance(now - Date.now());
  h.context.oldLive = { ...match('old', 'eng.1', 1, '359', 9), status: 'LIVE', live: true,
    fetchedAt: now - 24 * 3600e3, home: { name: 'Arsenal', teamId: '359', score: 1 } };
  h.context.freshLive = { ...match('fresh', 'esp.1', 1, '86', 9), status: 'LIVE', live: true,
    fetchedAt: now, home: { name: 'Real Madrid', teamId: '86', score: 2 } };
  h.call(`state.loading = false; state.error = null; state.enabled = new Set(['eng.1', 'esp.1']);
    state.data = { matches: [oldLive, freshLive], failed: [], fetchedAt: Date.now() }; publish()`);
  assert.equal(h.elements['#updated'].textContent, '比分更新于 9/30 12:00');
  assert.match(h.hero(), /比分可能已延迟/);
  h.advance(60e3);
  h.call('minuteTick()');
  assert.equal(h.elements['#updated'].textContent, '比分更新于 9/30 12:00');

  h.call(`state.view = 'week'; state.weekDays = [
    { dayKey: '2026-09-30', matches: [oldLive], fetchedAt: oldLive.fetchedAt },
    { dayKey: '2026-10-01', matches: [freshLive], fetchedAt: freshLive.fetchedAt },
  ]; publish()`);
  assert.equal(h.elements['#updated'].textContent, '比分更新于 9/30 12:00');
  h.call(`state.followed = [mkFollowRecord('86', 'Real Madrid', nameKeys(freshLive.home), ['esp.1'])]; state.onlyFollowed = true; publish()`);
  assert.equal(h.elements['#updated'].textContent, '比分更新于 12:00');
  assert.match(h.hero(), /进行中比分约每分钟自动更新/);
  assert.doesNotMatch(h.hero(), /比分可能已延迟/);
});

test('score hints report affected live games while retaining the previous result during updates', () => {
  const h = harness([], true);
  h.context.fixture = { ...match('live', 'eng.1', 1), status: 'LIVE', live: true,
    fetchedAt: Date.now(), refreshFailed: true };
  h.context.other = { ...match('other-live', 'eng.1', 1), status: 'LIVE', live: true, fetchedAt: Date.now() };
  h.call(`state.loading = false; state.error = null;
    state.data = { matches: [fixture, other], failed: [], fetchedAt: Date.now() }; publish()`);
  assert.match(h.hero(), /部分比分更新失败 · 稍后自动重试/);
  const before = h.elements['#updated'].textContent;
  h.call('state.loading = true; publish()');
  assert.match(h.hero(), /正在更新比分… · 当前显示上次结果/);
  assert.equal(h.elements['#updated'].textContent, before);
  h.call(`state.loading = false; fixture.refreshFailed = false; other.status = 'FT'; other.live = false;
    other.refreshFailed = true; publish()`);
  assert.match(h.hero(), /进行中比分约每分钟自动更新/);
  assert.doesNotMatch(h.hero(), /比分更新失败/);
  h.call('fixture.status = "FT"; fixture.live = false; publish()');
  assert.doesNotMatch(h.hero(), /id="scoreUpdate"/);
  assert.match(h.elements['#updated'].textContent, /^赛程更新于 /);
});

test('unknown live score times never borrow a newer schedule timestamp', () => {
  const h = harness([], true);
  h.context.fixture = { ...match('unknown-time', 'eng.1', 1), status: 'LIVE', live: true };
  h.call('state.loading = false; state.data = { matches: [fixture], failed: [], fetchedAt: Date.now() }; publish()');
  assert.equal(h.elements['#updated'].textContent, '');
  assert.match(h.hero(), /比分可能已延迟/);
});

test('a live game arriving in a weekly background update starts score polling', async () => {
  const h = harness([], true);
  h.call(`state.view = 'week'; state.windowStart = '2026-10-01'; const updates = new Map();
    let polls = 0; scheduleLivePoll = () => { polls++; };
    loadDayVisible = async (key, opts) => {
      updates.set(key, opts.onUpdate);
      return { dayKey: key, matches: [], failed: [], pending: true, fetchedAt: Date.now() };
    }`);
  await h.call('reloadWeek()');
  const before = h.call('polls');
  h.context.fixture = { ...match('late-live', 'eng.1', 1, '42', 9), status: 'LIVE', live: true,
    fetchedAt: Date.now(), refreshFailed: true };
  h.call(`updates.get('2026-10-01')({ dayKey: '2026-10-01', matches: [fixture], failed: [], fetchedAt: Date.now() })`);
  assert.equal(h.call('polls'), before + 1);
  assert.match(h.hero(), /比分更新失败 · 稍后自动重试/);
});

test('a page-level refresh error keeps the live score and schedules another attempt', async () => {
  const h = harness([], true);
  h.context.fixture = { ...match('kept-live', 'eng.1', 1), status: 'LIVE', live: true, fetchedAt: Date.now() };
  h.call(`state.data = { matches: [fixture], failed: [], fetchedAt: Date.now() };
    let polls = 0; scheduleLivePoll = () => { polls++; }; loadDayVisible = async () => { throw new Error('unavailable'); }`);
  await h.call('reload({ force: true })');
  assert.equal(h.call('polls'), 1);
  assert.equal(h.call('getSnapshot().data.matches[0].id'), 'kept-live');
  assert.match(h.hero(), /比分更新失败 · 稍后自动重试/);
});

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
  }; state.loading = false; publish()`);
  assert.match(h.elements['#list'].innerHTML, /赛程待确认/);
  assert.match(h.elements['#list'].innerHTML, /id="retry"/);
  assert.doesNotMatch(h.elements['#list'].innerHTML, /当天暂无所选赛事或关注球队的比赛/);
  assert.notEqual(h.elements['#heroCount'].textContent, '暂无比赛');

  h.call('state.data.failed = []; state.data.stale = false; state.data.fetchedAt = Date.now(); publish()');
  assert.match(h.elements['#list'].innerHTML, /当天暂无所选赛事或关注球队的比赛/);
  assert.equal(h.elements['#heroCount'].textContent, '暂无比赛');
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
  h.call('publish()'); // 渲染期间也不得写关注偏好
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
  h.call('publish()');
  assert.equal(h.elements['#followCount'].textContent, '1');
  assert.match(h.elements['#followTeams'].innerHTML, /球队名称待补全/);
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
  assert.match(h2.elements['#followTeams'].innerHTML, /球队名称待补全/);
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
  h.call('publish()');
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
  h.call('publish()');
  assert.equal(h.attempts(), fetches); // 只扫本地缓存，零网络
  const html = h.elements['#followTeams'].innerHTML;
  const [mm, dd] = [Number(day.slice(5, 7)), Number(day.slice(8, 10))];
  /* 展示的是未来的那一场（过去的被排除），本地时间与联赛/对阵一并给出 */
  assert.ok(html.includes(`赛程预览：${mm}/${dd} 12:00 · 英超 · Home vs Away`));
  assert.match(html, /暂未查到赛程/); // Roma：诚实说明没有已缓存赛程，不承诺真实最近
  /* 收起面板 → 不再展示 */
  h.call('toggleFollowPanel()');
  h.call('publish()');
  assert.doesNotMatch(h.elements['#followTeams'].innerHTML, /follow-team-next/);

  /* 缓存出现更早的未来比赛 → 重开面板即重算到新的一场 */
  const day2 = futureDayKey(2);
  const sooner = { ...upcoming, id: 'sooner-game', start: new Date(`${day2}T12:00:00`).toISOString() };
  for (const ym of h.call(`monthsForDay('${day2}')`)) seedMonth(h, 'eng.1', ym, [sooner]);
  h.call('toggleFollowPanel()');
  h.call('publish()');
  const [m2, d2] = [Number(day2.slice(5, 7)), Number(day2.slice(8, 10))];
  assert.ok(h.elements['#followTeams'].innerHTML.includes(`赛程预览：${m2}/${d2} 12:00 · 英超 · Home vs Away`));
  assert.equal(h.attempts(), fetches); // 全程零网络
  h.call('toggleFollowPanel()');
  h.call('publish()');
  assert.doesNotMatch(h.elements['#followTeams'].innerHTML, /follow-team-next/);
});

function followStatusPreview(events) {
  const h = harness([['fs1.enabled', '["eng.1"]'], ['fs1.followed', JSON.stringify([
    { id: '359', name: 'Arsenal', names: ['arsenal'], leagues: ['eng.1'] },
  ])]], true);
  h.advance(Date.parse('2026-09-30T04:00:00Z') - h.call('Date.now()'));
  seedMonth(h, 'eng.1', '202610', events);
  const requests = h.attempts();
  h.call('toggleFollowPanel()');
  assert.equal(h.attempts(), requests);
  return h;
}

const previewStatusMatch = (id, status, start = '2026-10-01T12:00:00Z') => ({
  id, league: 'eng.1', start, status,
  home: { name: 'Arsenal', teamId: '359' }, away: { name: 'Leeds United', teamId: '357' },
});

test('cancelled fixtures are skipped in cached follow previews while remaining in the schedule', () => {
  const h = followStatusPreview([
    previewStatusMatch('cancelled-earlier', 'CANCELLED'),
    previewStatusMatch('scheduled-later', 'SCHEDULED', '2026-10-01T13:00:00Z'),
  ]);
  assert.equal(h.call('getSnapshot().followNext[0].id'), 'scheduled-later');
  assert.ok(h.call('cachedDayMatches(dayKeyOf(new Date("2026-10-01T12:00:00Z")), ["eng.1"]).some(m => m.id === "cancelled-earlier")'));
});

test('all-cancelled cached fixtures leave the honest unavailable follow preview', () => {
  const h = followStatusPreview([previewStatusMatch('cancelled-only', 'CANCELLED')]);
  assert.equal(h.call('getSnapshot().followNext[0]'), null);
  assert.match(h.elements['#followTeams'].innerHTML, /暂未查到赛程/);
});

test('postponed follow previews retain teams and competition without promising the old kickoff', () => {
  const postponed = previewStatusMatch('postponed', 'POSTPONED');
  const h = followStatusPreview([postponed, previewStatusMatch('later', 'SCHEDULED', '2026-10-02T12:00:00Z')]);
  assert.equal(h.call('getSnapshot().followNext[0].id'), 'postponed');
  const text = h.call('followNextText(getSnapshot().followNext[0])');
  for (const label of ['赛程预览', '延期', '时间待定', '英超', '阿森纳', '利兹联']) assert.ok(text.includes(label));
  const oldDate = new Date(postponed.start);
  assert.ok(!text.includes(`${oldDate.getMonth() + 1}/${oldDate.getDate()}`));
  assert.doesNotMatch(text, /\d{2}:\d{2}/);
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
  assert.ok(html.includes(`赛程预览：${m1}/${d1} 12:00 · 英超 · Home vs Away`)); // 最早的一场
  assert.ok(!html.includes(`${m2}/${d2} 12:00`));

  const fetches = h.attempts();
  /* 跨过第一场开赛点 → tick 推进到第二场 */
  h.advance(k1.getTime() - Date.now() + 60000);
  h.call('minuteTick()');
  html = h.elements['#followTeams'].innerHTML;
  assert.ok(!html.includes(`${m1}/${d1} 12:00`));
  assert.ok(html.includes(`赛程预览：${m2}/${d2} 12:00 · 英超 · Home vs Away`));

  /* 跨过第二场 → 诚实说暂无 */
  h.advance(k2.getTime() - Date.now() + 60000);
  h.call('minuteTick()');
  html = h.elements['#followTeams'].innerHTML;
  assert.match(html, /暂未查到赛程/);
  assert.ok(!html.includes('赛程预览：'));
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
  h.call('publish()');
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
  assert.ok(h.elements['#list'].innerHTML.includes('关注球队赛程预览'));
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

test('date strip dots distinguish confirmed-empty from uncached days', () => {
  const h = harness([['fs1.enabled', '["eng.1"]']], true);
  h.call("state.windowStart = '2026-10-05'; state.dayKey = '2026-10-07';");
  /* 十月缓存已就位且整月无赛 → 7 天全部“确认无赛”，不算未知 */
  seedMonth(h, 'eng.1', '202610', []);
  h.call('publish()');
  let html = h.elements['#days'].innerHTML;
  assert.equal((html.match(/day-dot off/g) || []).length, 7);
  assert.equal((html.match(/day-dot unk/g) || []).length, 0);
  assert.ok(!html.includes('赛程未知'));
  assert.match(html, /aria-label="2026-10-05 [^"]*无所选赛事比赛"/);

  /* 另一个启用联赛没有缓存 → 覆盖不足 → 同一天变“未知” */
  h.call("state.enabled.add('esp.1'); publish()");
  html = h.elements['#days'].innerHTML;
  assert.equal((html.match(/day-dot unk/g) || []).length, 7);
  assert.match(html, /aria-label="2026-10-05 [^"]*赛程未知"/);
  h.call("state.enabled.delete('esp.1')");

  /* 缓存过期（赛程可能已变更）→ 同样无赛也不能确认 → unk */
  seedMonth(h, 'eng.1', '202610', [], Date.now() - 2 * 864e5);
  h.call('publish()');
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
  assert.match(html, /aria-label="2026-10-05 [^"]*无所选赛事比赛"/);

  /* 无缓存月份 → 未知，aria-label 明示“赛程未知” */
  h.call("state.windowStart = '2026-07-05'; state.dayKey = '2026-07-07'; publish()");
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
  h.call('publish()');
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
    publish();
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
  h.call(`state.loading = false; state.view = 'week'; state.windowStart = '2026-09-21';
    state.weekDays = [{ dayKey: '2026-09-22', matches: [], pending: true }]; publish()`);
  let html = h.elements['#list'].innerHTML;
  assert.match(html, /加载中…/);
  assert.doesNotMatch(html, /id="retry"|这7天暂无比赛|未能加载/);

  h.call('state.weekDays[0].pending = false; state.weekDays[0].failed = ["eng.1"]; publish()');
  html = h.elements['#list'].innerHTML;
  assert.match(html, /赛程待确认/);
  assert.match(html, /id="retry"/);
  assert.doesNotMatch(html, /这7天暂无比赛/);
  assert.equal(h.elements['#heroCount'].textContent, '赛程待确认');

  h.call('state.weekDays[0].failed = []; publish()');
  assert.match(h.elements['#list'].innerHTML, /这7天暂无比赛/);
  assert.equal(h.elements['#heroCount'].textContent, '这7天暂无比赛');
});

test('background updates keep matches visible without warning of a loading failure', () => {
  const h = harness([], true);
  h.context.fixture = match('visible', 'eng.1', 22);
  h.call(`state.loading = false; state.data = {
    matches: [fixture], failed: [], fetchedAt: Date.now(), fromCache: true,
    stale: true, pending: true, leagueMeta: new Map(),
  }; publish()`);
  assert.match(h.elements['#list'].innerHTML, /class="match /);
  assert.doesNotMatch(h.elements['#list'].innerHTML, /class="warn"|缓存|未能加载/);
  assert.match(h.elements['#heroCount'].textContent, /更新中…/);
  assert.match(h.elements['#updated'].textContent, /更新于 .*更新中…/);

  h.call('state.data.pending = false; publish()');
  assert.match(h.elements['#list'].innerHTML, /比赛时间和比分可能有变动/);
  assert.match(h.elements['#heroCount'].textContent, /赛程可能有变动/);

  h.call('state.data.failed = ["esp.1"]; publish()');
  assert.match(h.elements['#list'].innerHTML, /西甲赛程未能加载/);
  assert.match(h.elements['#heroCount'].textContent, /部分赛程未能加载/);
  assert.doesNotMatch(h.elements['#list'].innerHTML, /无法确认当天是否有比赛|esp\.1/);
});

test('a partially unavailable week with known matches does not deny those matches', () => {
  const h = harness([], true);
  h.context.fixture = match('visible', 'eng.1', 22);
  h.call(`state.loading = false; state.view = 'week'; state.windowStart = '2026-09-21';
    state.weekDays = [
      { dayKey: '2026-09-22', matches: [fixture], failed: [], fetchedAt: Date.now() },
      { dayKey: '2026-09-23', matches: [], failed: ['esp.1'] },
    ]; publish()`);
  assert.match(h.elements['#list'].innerHTML, /部分日期的赛程未能加载/);
  assert.match(h.elements['#list'].innerHTML, /id="retry"/);
  assert.doesNotMatch(h.elements['#list'].innerHTML, /无法确认这7天是否有比赛|这7天暂无比赛/);
  assert.match(h.elements['#heroCount'].textContent, /1 场.*部分赛程未能加载/);

  h.call(`state.weekDays = null; state.loading = true; publish()`);
  assert.equal(h.elements['#updated'].textContent, '更新中…');
  assert.match(h.elements['#list'].innerHTML, /role="status"/);
  assert.equal(h.elements['#refresh'].getAttribute('aria-busy'), 'true');
});

test('load errors show an actionable message without exposing the raw exception', () => {
  const h = harness([], true);
  h.call(`state.loading = false; state.data = null; state.error = 'HTTP 503 internal-test'; publish()`);
  assert.match(h.elements['#list'].innerHTML, /暂时无法加载赛程/);
  assert.match(h.elements['#list'].innerHTML, /id="retry"/);
  assert.doesNotMatch(h.elements['#list'].innerHTML, /HTTP|internal-test/);
  assert.equal(h.elements['#refresh'].getAttribute('aria-busy'), 'false');
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

/* ---------- 球队搜索 ---------- */

function teamsJson(teams) {
  return { sports: [{ leagues: [{ teams: teams.map(([id, displayName, shortDisplayName]) => ({
    team: { id, displayName, shortDisplayName, logos: [{ href: `https://a.espncdn.com/i/teamlogos/soccer/500/${id}.png` }] },
  })) }] }] };
}

/* 按联赛路径返回不同名单；其余联赛返回空壳（不会写缓存） */
function teamsFetch(byLeague) {
  return async (url) => {
    const m = /soccer\/([^/]+)\/teams/.exec(url);
    const teams = (m && byLeague[m[1]]) || [];
    return { ok: true, json: async () => teamsJson(teams) };
  };
}

test('team list is cached for a week and falls back to stale cache on failure', async () => {
  const h = harness();
  h.setFetch(teamsFetch({ 'eng.1': [['360', 'Manchester United', 'Man United']] }));
  const first = await h.call("ensureTeams('eng.1')");
  assert.equal(first.teams.length, 1);
  assert.equal(first.teams[0].id, '360');
  const calls = h.attempts();
  await h.call("ensureTeams('eng.1')");
  assert.equal(h.attempts(), calls); // 新鲜缓存：不联网
  /* 缓存过期后抓取失败：仍返回旧名单并标记 stale */
  h.storage.setItem('fs1t|eng.1', JSON.stringify({ fetchedAt: Date.now() - 8 * 24 * 3600e3, teams: first.teams }));
  h.call('teamsMemo.clear()');
  h.setFetch(async () => { throw new Error('offline'); });
  const stale = await h.call("ensureTeams('eng.1')");
  assert.equal(stale.stale, true);
  assert.equal(stale.failed, false);
  assert.equal(stale.teams.length, 1);
  /* 从没成功过：failed，且不编造名单 */
  const none = await h.call("ensureTeams('esp.1')");
  assert.equal(none.failed, true);
  assert.deepEqual([...none.teams], []);
});

test('an empty team list response never overwrites a good cache', async () => {
  const h = harness();
  h.setFetch(teamsFetch({ 'eng.1': [['360', 'Manchester United', 'Man United']] }));
  await h.call("ensureTeams('eng.1')");
  h.setFetch(teamsFetch({}));
  const r = await h.call("ensureTeams('eng.1', { force: true })");
  assert.equal(r.teams.length, 1);
  assert.equal(JSON.parse(h.storage.getItem('fs1t|eng.1')).teams.length, 1);
});

test('team search matches Chinese, English and nicknames, ranking exact before prefix before contains', () => {
  const h = harness([], true);
  h.context.catalog = h.call(`buildCatalog([
    { leagueId: 'eng.1', teams: [
      { id: '360', name: 'Manchester United', short: 'Man United', logo: '' },
      { id: '382', name: 'Manchester City', short: 'Man City', logo: '' },
      { id: '359', name: 'Arsenal', short: '', logo: '' } ] },
    { leagueId: 'esp.1', teams: [ { id: '86', name: 'Real Madrid', short: 'Real Madrid', logo: '' } ] },
  ])`);
  const ids = (q) => [...h.call(`searchTeams(catalog, ${JSON.stringify(q)}).map((e) => e.id)`)];
  assert.deepEqual(ids('曼联'), ['360']);
  assert.deepEqual(ids('红魔'), ['360']);        // 昵称
  assert.deepEqual(ids('皇马'), ['86']);          // 口语简称
  assert.deepEqual(ids('arsenal'), ['359']);
  assert.deepEqual(ids(' ARSENAL '), ['359']);    // 大小写与空白
  assert.deepEqual(ids('Manchester').sort(), ['360', '382']);
  assert.deepEqual(ids('madrid'), ['86']);
  assert.deepEqual(ids(''), []);
  assert.deepEqual(ids('zzzz'), []);
});

test('the same team in several leagues is one catalog entry that remembers every league', () => {
  const h = harness([], true);
  const entries = h.call(`buildCatalog([
    { leagueId: 'eng.1', teams: [ { id: '359', name: 'Arsenal', short: '', logo: '' } ] },
    { leagueId: 'uefa.champions', teams: [ { id: '359', name: 'Arsenal', short: '', logo: '' } ] },
  ])`);
  assert.equal(entries.length, 1);
  assert.deepEqual([...entries[0].leagues], ['eng.1', 'uefa.champions']);
});

test('following from search records the team ID and all its leagues, and toggles off again', async () => {
  const h = harness([], true);
  h.setFetch(teamsFetch({
    'eng.1': [['359', 'Arsenal', '']],
    'uefa.champions': [['359', 'Arsenal', '']],
    'chn.1': [['1', 'Beijing Guoan', 'Beijing']],
  }));
  h.call('toggleFollowPanel()');
  h.elements['#followSearch'].value = '阿森纳';
  h.elements['#followSearch'].dispatch('input', { target: h.elements['#followSearch'] });
  await h.call('catalogPromise');
  const html = h.elements['#followResults'].innerHTML;
  assert.ok(html.includes('阿森纳'));
  assert.ok(html.includes('英超 · 欧冠'));
  assert.match(html, /aria-pressed="false"/);

  const click = (id) => h.elements['#followResults'].dispatch('click', {
    target: { closest: (sel) => (sel === '[data-search-id]' ? { dataset: { searchId: id } } : null) },
  });
  click('359');
  const saved = JSON.parse(h.storage.getItem('fs1.followed'));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, '359');
  assert.equal(saved[0].name, 'Arsenal');
  assert.deepEqual(saved[0].leagues, ['eng.1', 'uefa.champions']);
  assert.match(h.elements['#followResults'].innerHTML, /aria-pressed="true"/);
  assert.match(h.elements['#followResults'].innerHTML, /已关注/);
  /* 关注联赛并入抓取范围 */
  assert.ok(h.call('fetchLeagues()').includes('uefa.champions'));
  /* 搜索里再点一次：取消关注，不留残余 */
  click('359');
  assert.equal(JSON.parse(h.storage.getItem('fs1.followed')).length, 0);
});

test('team search stays honest when the list cannot load', async () => {
  const h = harness([], true);
  h.setFetch(async () => { throw new Error('offline'); });
  h.elements['#followSearch'].value = 'arsenal';
  h.elements['#followSearch'].dispatch('input', { target: h.elements['#followSearch'] });
  await h.call('catalogPromise');
  assert.match(h.elements['#followResults'].innerHTML, /暂时无法搜索球队/);
  assert.doesNotMatch(h.elements['#followResults'].innerHTML, /没有找到/);
  assert.equal(h.call('catalogPromise'), null); // 全部失败后清掉，再次聚焦可重试
});

test('cold start renders leagues that already arrived when the deadline hits', async () => {
  const h = harness();
  const day = '2026-09-26';
  const ev = { id: 'e1', date: new Date(2026, 8, 26, 12).toISOString(), status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' } },
    competitions: [{ competitors: [
      { homeAway: 'home', team: { id: '1', displayName: 'A' } },
      { homeAway: 'away', team: { id: '2', displayName: 'B' } }] }] };
  h.setFetch((url) => {
    if (String(url).includes('snapshot/')) return Promise.reject(new Error('snapshot unavailable'));
    return String(url).includes('/eng.1/')
      ? Promise.resolve({ ok: true, json: async () => ({ leagues: [], events: [ev] }) })
      : new Promise(() => {}); /* 其余联赛一直无响应 */
  });
  h.context.updates = [];
  const r = await h.call(`loadDay('${day}', { leagues: ['eng.1', 'esp.1'], deadline: 50, onUpdate: (v) => updates.push(v) })`);
  assert.equal(r.pending, true);
  assert.equal(r.matches.length, 1);
  assert.equal(r.matches[0].id, 'e1');
  assert.ok(r.fetchedAt);
  assert.ok(h.context.updates.length >= 1);
});

test('cold start with an unreachable ESPN falls back to the same-origin snapshot', async () => {
  const h = harness();
  const entry = {
    fetchedAt: Date.now() - 1000,
    league: { id: 'eng.1', logo: '' },
    events: [match('snap1', 'eng.1', 26)],
  };
  h.setFetch((url) => (String(url).includes('snapshot/schedule.json')
    ? Promise.resolve({ ok: true, json: async () => ({ generatedAt: Date.now(), months: { 'eng.1|202609': entry } }) })
    : new Promise(() => {}))); /* ESPN 一直无响应 */
  h.context.updates = [];
  const r = await h.call("loadDay('2026-09-26', { leagues: ['eng.1'], deadline: 20000, onUpdate: (v) => updates.push(v) })");
  assert.equal(r.matches.length, 1);
  assert.equal(r.matches[0].id, 'snap1');
  assert.equal(r.pending, undefined); /* 有效快照即可完成首屏，无需等待 ESPN */
  assert.equal(r.stale, false);
  assert.equal(h.attempts(), 1); /* 只访问同源快照 */
  assert.ok(r.fetchedAt);
  assert.ok(h.entries().some(([k]) => k === 'fs1|m|eng.1|202609')); /* 已写入本地缓存，下次直接命中 */
});

test('a snapshot never overwrites a newer local cache and a bad snapshot is ignored', async () => {
  const newer = monthCache('eng.1', [match('local', 'eng.1', 26)], Date.now());
  const h = harness([newer]);
  h.setFetch(async (url) => {
    if (String(url).includes('snapshot/schedule.json')) {
      return { ok: true, json: async () => ({ months: { 'eng.1|202609': { fetchedAt: 1, league: { id: 'eng.1' }, events: [match('old', 'eng.1', 26)] } } }) };
    }
    throw new Error('offline');
  });
  assert.equal(await h.call('seedFromSnapshot()'), false);
  assert.equal(JSON.parse(h.storage.getItem('fs1|m|eng.1|202609')).events[0].id, 'local');

  const bad = harness();
  bad.setFetch(async () => ({ ok: true, json: async () => ({ months: 'nope' }) }));
  assert.equal(await bad.call('seedFromSnapshot()'), false);
});

test('a three-hour-old snapshot confirms an empty day without contacting ESPN', async () => {
  const h = harness();
  h.setFetch(async (url) => {
    assert.ok(String(url).includes('snapshot/'));
    return { ok: true, json: async () => ({ months: {
      'eng.1|202609': { fetchedAt: Date.now() - 3 * 3600e3, league: { id: 'eng.1' }, events: [] },
    } }) };
  });
  const day = await h.call("loadDay('2026-09-30', { leagues: ['eng.1'] })");
  assert.equal(day.matches.length, 0);
  assert.equal(day.failed.length, 0);
  assert.equal(day.stale, false);
  assert.equal(day.pending, undefined);
  assert.ok(day.fetchedAt);
  assert.equal(h.attempts(), 1);
});

test('an ESPN request started before seeding cannot discard the snapshot on failure', async () => {
  const h = harness();
  const requests = [];
  const entry = { fetchedAt: Date.now(), league: { id: 'eng.1' }, events: [match('survives', 'eng.1', 26)] };
  h.setFetch((url) => String(url).includes('snapshot/')
    ? Promise.resolve({ ok: true, json: async () => ({ months: { 'eng.1|202609': entry } }) })
    : new Promise((resolve, reject) => requests.push(reject)));
  const pending = h.call("ensureMonth('eng.1', '202609', { force: true })");
  await h.call('seedFromSnapshot()');
  for (let attempt = 0; attempt < 3; attempt++) {
    while (requests.length <= attempt) await new Promise(setImmediate);
    requests[attempt](new Error('mobile ESPN blocked'));
  }
  const result = await pending;
  assert.equal(result.data.events[0].id, 'survives');
  assert.equal(result.stale, false);
  assert.equal(result.failed, false);
});

test('expired and partially covered snapshots never confirm that there are no matches', async () => {
  for (const age of [7 * 3600e3, 1000]) {
    const h = harness();
    const currentDay = h.call('dayKeyOf(new Date())');
    const months = Object.fromEntries(h.call(`monthsForDay('${currentDay}')`).map((ym) => [
      `eng.1|${ym}`, { fetchedAt: Date.now() - age, league: { id: 'eng.1' }, events: [] },
    ]));
    h.setFetch(async (url) => {
      if (!String(url).includes('snapshot/')) throw new Error('mobile ESPN blocked');
      return { ok: true, json: async () => ({ months }) };
    });
    const day = await h.call(`loadDay('${currentDay}', { leagues: ['eng.1', 'esp.1'] })`);
    assert.ok(day.failed.includes('esp.1'));
    assert.equal(day.stale, age > 6 * 3600e3);
    assert.ok(day.fetchedAt);
  }
});

test('a failed snapshot request can be retried and force refresh obtains a new snapshot', async () => {
  const h = harness();
  let fail = true;
  h.setFetch(async () => {
    if (fail) throw new Error('temporary failure');
    return { ok: true, json: async () => ({ months: {
      'eng.1|202609': { fetchedAt: Date.now(), league: { id: 'eng.1' }, events: [] },
    } }) };
  });
  assert.equal(await h.call('seedFromSnapshot()'), false);
  fail = false;
  assert.equal(await h.call('seedFromSnapshot()'), true);
  const attempts = h.attempts();
  await h.call('seedFromSnapshot({ force: true })');
  assert.equal(h.attempts(), attempts + 1);
});

test('day view keeps a completed update received before the initial pending result', async () => {
  const h = harness([], true);
  h.context.freshMatch = match('fresh-day', 'eng.1', 26);
  h.call(`state.view = 'day'; state.dayKey = '2026-09-26';
    loadDayVisible = async (key, opts) => {
      opts.onUpdate({ dayKey: key, matches: [freshMatch], failed: [], leagueMeta: new Map(), stale: false, fetchedAt: Date.now() });
      return { dayKey: key, matches: [], failed: [], leagueMeta: new Map(), pending: true };
    }`);
  await h.call('reload()');
  assert.equal(h.call('state.data.matches[0].id'), 'fresh-day');
  assert.equal(h.call('state.data.pending'), undefined);
});

test('day view never replaces the completed snapshot result with an early progress update', async () => {
  const h = harness([], true);
  h.context.freshMatch = match('complete-day', 'eng.1', 26);
  h.call(`state.view = 'day'; state.dayKey = '2026-09-26';
    loadDayVisible = async (key, opts) => {
      opts.onUpdate({ dayKey: key, matches: [freshMatch], failed: [], leagueMeta: new Map(), pending: true, stale: true });
      return { dayKey: key, matches: [freshMatch], failed: [], leagueMeta: new Map(), stale: false, fetchedAt: Date.now() };
    }`);
  await h.call('reload()');
  assert.equal(h.call('state.data.stale'), false);
  assert.equal(h.call('state.data.pending'), undefined);
});

test('week view keeps completed results instead of early snapshot progress', async () => {
  const h = harness([], true);
  h.context.freshMatch = match('complete-week', 'eng.1', 26);
  h.call(`state.view = 'week'; state.windowStart = '2026-09-21';
    loadDayVisible = async (key, opts) => {
      opts.onUpdate({ dayKey: key, matches: [freshMatch], failed: [], pending: true, stale: true });
      return { dayKey: key, matches: [freshMatch], failed: [], stale: false };
    }`);
  await h.call('reloadWeek()');
  assert.equal(h.call('state.weekDays.every(day => !day.stale && !day.pending)'), true);
});

test('team search works from the same-origin snapshot without contacting ESPN', async () => {
  const h = harness([], true);
  h.context.location.protocol = 'https:';
  const leagues = Object.fromEntries(h.call('LEAGUES.map((lg) => lg.id)').map((id) => [id, {
    fetchedAt: Date.now(),
    teams: [{ id: '360', name: 'Manchester United', short: 'Man United', logo: '' }],
  }]));
  let requests = 0;
  h.setFetch(async (url) => {
    assert.equal(String(url), 'snapshot/teams.json');
    requests++;
    return { ok: true, json: async () => ({ leagues }) };
  });
  h.call("setSearchQuery('曼联')");
  await h.call('catalogPromise');
  assert.equal(requests, 1); // 并发联赛共用一次快照请求
  assert.match(h.elements['#followResults'].innerHTML, /Manchester United/);
  assert.doesNotMatch(h.elements['#followResults'].innerHTML, /无法加载/);
  h.call("followSearchResult('360')");
  assert.equal(h.call('state.followed[0].name'), 'Manchester United');
  assert.equal(h.call('state.followed[0].leagues.length'), Object.keys(leagues).length);
});

test('team snapshot preserves newer cache, ignores invalid data, and retries failure', async () => {
  const h = harness();
  const newer = { fetchedAt: Date.now(), teams: [{ id: '359', name: 'Arsenal', short: '', logo: '' }] };
  h.call(`writeTeamsCache('eng.1', ${JSON.stringify(newer)})`);
  let calls = 0;
  h.setFetch(async () => {
    calls++;
    if (calls === 1) throw new Error('offline');
    return { ok: true, json: async () => ({ leagues: {
      'eng.1': { fetchedAt: newer.fetchedAt - 1000, teams: [{ id: '360', name: 'Manchester United' }] },
      'esp.1': { fetchedAt: Date.now(), teams: [{ name: 'missing ID' }] },
    } }) };
  });
  assert.equal(await h.call('seedTeamsFromSnapshot()'), false);
  assert.equal(await h.call('seedTeamsFromSnapshot()'), true);
  assert.equal(calls, 2);
  assert.equal(h.call("readTeamsCache('eng.1').teams[0].name"), 'Arsenal');
  assert.equal(h.call("readTeamsCache('esp.1')"), null);
});

test('subscriptions have stable snapshots and teardown removes listeners and invalidates loads', async () => {
  const h = harness([['fs1.enabled', '["eng.1"]']], true);
  h.call('let calls = 0; const unsubscribe = subscribe(() => calls++);');
  assert.equal(h.call('getSnapshot() === getSnapshot()'), true);
  const before = h.call('getSnapshot()');
  h.call('toggleFilters()');
  assert.notEqual(h.call('getSnapshot()'), before);
  assert.equal(h.call('calls'), 1);
  h.call('unsubscribe(); toggleFilters()');
  assert.equal(h.call('calls'), 1);
  h.call('let resolveLoad; loadDayVisible = () => new Promise((resolve) => { resolveLoad = resolve; }); const pendingLoad = reload(); stop();');
  h.call('resolveLoad({ dayKey: state.dayKey, matches: [], failed: [], fetchedAt: Date.now(), leagueMeta: new Map() });');
  await h.call('pendingLoad');
  assert.equal(h.call('state.data'), null);
  h.storage.setItem('fs1.enabled', '["esp.1"]');
  h.fireWindow('storage', { key: 'fs1.enabled' });
  assert.deepEqual([...h.call('state.enabled')], ['eng.1']);
  assert.equal(h.context.document.listeners.get('keydown').length, 0);
});

test('quick date switches never commit the previous requests result', async () => {
  const h = harness([], true);
  h.call('const pendingDays = new Map(); loadDayVisible = (key) => new Promise((resolve) => pendingDays.set(key, resolve));');
  h.call('state.dayKey = "2026-10-01"; const first = reload(); state.dayKey = "2026-10-02"; const second = reload();');
  h.context.fresh = { dayKey: '2026-10-02', matches: [match('new-day', 'eng.1', 2, '42', 9)], failed: [], fetchedAt: Date.now(), leagueMeta: new Map() };
  h.context.old = { ...h.context.fresh, dayKey: '2026-10-01', matches: [match('old-day', 'eng.1', 1, '42', 9)] };
  h.call('pendingDays.get("2026-10-02")(fresh)');
  await h.call('second');
  h.call('pendingDays.get("2026-10-01")(old)');
  await h.call('first');
  assert.equal(h.call('getSnapshot().data.matches[0].id'), 'new-day');
  assert.equal(h.call('getSnapshot().dayKey'), '2026-10-02');
});

test('snapshot CLIs import shared ESM normalizers and publish valid schedule and team files', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'football-snapshot-test-'));
  try {
    for (const file of ['config.js', 'data.js', 'package.json']) fs.copyFileSync(path.join(root, file), path.join(directory, file));
    fs.cpSync(path.join(root, 'tools'), path.join(directory, 'tools'), { recursive: true });
    const mock = path.join(directory, 'mock-fetch.mjs');
    fs.writeFileSync(mock, `globalThis.fetch = async (url) => ({ ok: true, json: async () => String(url).includes('/teams') ? {
      sports: [{ leagues: [{ teams: [{ team: { id: '360', displayName: 'Manchester United', abbreviation: 'MUN' } }] }] }]
    } : {
      leagues: [{ logos: [] }], events: [{ id: 'snapshot-fixture', date: new Date().toISOString(),
        status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' } },
        competitions: [{ competitors: [{ homeAway: 'home', team: { id: '360', displayName: 'Manchester United' } }, { homeAway: 'away', team: { id: '359', displayName: 'Arsenal' } }] }]
      }]
    } });`);
    for (const file of ['build-snapshot.js', 'build-teams-snapshot.js']) {
      const result = spawnSync(process.execPath, ['--import', mock, path.join(directory, 'tools', file)], { encoding: 'utf8', timeout: 10000 });
      assert.equal(result.status, 0, result.stderr || String(result.error));
    }
    const { LEAGUES } = await import('../config.js');
    const schedule = JSON.parse(fs.readFileSync(path.join(directory, 'snapshot/schedule.json'), 'utf8'));
    assert.equal(Object.keys(schedule.months).length, LEAGUES.length * 4);
    assert.equal(Object.values(schedule.months)[0].events[0].home.name, 'Manchester United');
    const teams = JSON.parse(fs.readFileSync(path.join(directory, 'snapshot/teams.json'), 'utf8'));
    assert.equal(Object.keys(teams.leagues).length, LEAGUES.length);
    assert.equal(teams.leagues['eng.1'].teams[0].id, '360');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('follow-only day view filters and orders matches without duplicates or discarding loaded data', () => {
  const h = harness([['fs1.followed', '["manchesterunited"]']], true);
  h.context.fixtures = [
    { ...match('later', 'eng.1', 30), start: '2026-09-30T22:00:00+08:00', home: { name: 'Manchester United', teamId: '360' } },
    { ...match('other', 'eng.1', 30), home: { name: 'Liverpool', teamId: '364' } },
    { ...match('earlier', 'esp.1', 30), start: '2026-09-30T20:00:00+08:00', away: { name: 'Manchester United', teamId: '360' } },
  ];
  h.call(`reload = () => {}; state.loading = false;
    state.data = { matches: fixtures, failed: [], fetchedAt: Date.now(), leagueMeta: new Map() };
    setOnlyFollowed(true)`);
  assert.deepEqual([...h.call('getSnapshot().data.matches.map((m) => m.id)')], ['earlier', 'later']);
  assert.equal(h.call('state.data.matches.length'), 3);
  assert.equal((h.elements['#list'].innerHTML.match(/class="match /g) || []).length, 2);
  assert.doesNotMatch(h.elements['#list'].innerHTML, /利物浦/);
  assert.equal(h.elements['#heroCount'].textContent, '2 场 · 关注球队');
  assert.equal(h.storage.getItem('fs1.onlyFollowed'), 'true');
  assert.equal(h.call('currentMatches().length'), 2);
  h.call('setOnlyFollowed(false)');
  assert.equal(h.call('getSnapshot().data.matches.length'), 3);
  assert.match(h.elements['#list'].innerHTML, /利物浦/);
});

test('follow-only preference and seven-day view restore while legacy preferences remain compatible', () => {
  const day = futureDayKey(1);
  const h = harness([
    ['fs1.onlyFollowed', 'true'], ['fs1.view', 'week'], ['fs1.day', day],
    ['fs1.enabled', '["esp.1"]'], ['fs1.followed', '["arsenal"]'],
  ], true);
  assert.equal(h.call('getSnapshot().onlyFollowed'), true);
  assert.equal(h.call('state.windowStart'), day);
  assert.equal(h.call('state.view'), 'week');
  assert.deepEqual([...h.call('state.enabled')], ['esp.1']);
  assert.equal(h.call('isFollowed({ name: "Arsenal" })'), true);
  assert.match(h.elements['.filters'].innerHTML, /id="onlyFollowed" aria-pressed="true"/);
  for (const entries of [[], [['fs1.onlyFollowed', 'invalid']]]) {
    assert.equal(harness(entries, true).call('state.onlyFollowed'), false);
  }
  const returning = harness([['fs1.view', 'week'], ['fs1.day', futureDayKey(-1)]], true);
  assert.equal(returning.call('state.windowStart'), futureDayKey(0));
});

test('seven-day loading starts at the selected date and includes the sixth following day across a month boundary', async () => {
  const h = harness([], true);
  h.call(`reload = () => {}; state.dayKey = '2026-09-30'; setView('week');
    const requestedDays = [];
    loadDayVisible = async (key) => {
      requestedDays.push(key);
      return { matches: [], failed: [], fetchedAt: Date.now(), stale: false };
    }`);
  await h.call('reloadWeek()');
  assert.deepEqual([...h.call('requestedDays')].sort(), ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06']);
  assert.equal(h.elements['#heroDate'].textContent, '09.30–10.06');
  assert.match(h.elements['#days'].innerHTML, /data-day="2026-10-06"/);
  h.call(`gotoDay('2026-10-02')`);
  assert.equal(h.call('state.windowStart'), '2026-09-30');
  h.call(`gotoDay('2026-10-07')`);
  assert.equal(h.call('state.windowStart'), '2026-10-07');
  assert.equal(h.call('state.weekDays'), null);
  h.call(`gotoDay('2026-10-08', { resetWeek: true })`);
  assert.equal(h.call('state.windowStart'), '2026-10-08');
  h.call(`setView('day')`);
  assert.equal(h.call('state.windowStart'), '2026-10-05');
  h.call(`state.view = 'week'; state.windowStart = addDays(dayKeyOf(new Date()), -2);
    onKeyDown({ key: 'Home', preventDefault() {} })`);
  assert.equal(h.call('state.windowStart'), futureDayKey(0));
});

test('follow-only week shows both followed sides once and omits days containing only other teams', () => {
  const h = harness([['fs1.followed', '["manchesterunited","arsenal"]']], true);
  h.context.fixtures = [
    { ...match('both', 'eng.1', 30), home: { name: 'Manchester United', teamId: '360' }, away: { name: 'Arsenal', teamId: '359' } },
    { ...match('other', 'eng.1', 1, '88', 9), home: { name: 'Liverpool', teamId: '364' } },
    { ...match('last', 'eng.1', 6, '360', 9), home: { name: 'Manchester United', teamId: '360' } },
  ];
  h.call(`state.onlyFollowed = true; state.view = 'week'; state.loading = false; state.windowStart = '2026-09-30';
    state.weekDays = [
      { dayKey: '2026-09-30', matches: [fixtures[0]], fetchedAt: Date.now() },
      { dayKey: '2026-10-01', matches: [fixtures[1]], fetchedAt: Date.now() },
      { dayKey: '2026-10-06', matches: [fixtures[2]], fetchedAt: Date.now() },
    ]; publish()`);
  assert.equal((h.elements['#list'].innerHTML.match(/class="match /g) || []).length, 2);
  assert.doesNotMatch(h.elements['#list'].innerHTML, /wday-2026-10-01|利物浦/);
  assert.match(h.elements['#list'].innerHTML, /wday-2026-10-06/);
  assert.equal(h.call('currentMatches().length'), 2);
  assert.equal(h.elements['#heroCount'].textContent, '2 场 · 关注球队');
});

test('follow-only loads disabled followed competitions while preserving the selected competition range', async () => {
  const h = harness([
    ['fs1.enabled', '["eng.1"]'], ['fs1.onlyFollowed', 'true'],
    ['fs1.followed', JSON.stringify([{ name: 'Real Madrid', leagues: ['esp.1'] }])],
  ], true);
  const day = futureDayKey(2);
  const fixture = { ...match('madrid', 'esp.1', 1), start: new Date(`${day}T20:00:00`).toISOString(), home: { name: 'Real Madrid', teamId: '86' } };
  for (const league of h.call('fetchLeagues()')) for (const ym of h.call(`monthsForDay('${day}')`)) {
    seedMonth(h, league, ym, league === 'esp.1' ? [fixture] : []);
  }
  h.call(`state.dayKey = '${day}'`);
  await h.call('reload()');
  assert.deepEqual([...h.call('fetchLeagues()')], ['eng.1', 'esp.1']);
  assert.equal(h.call('getSnapshot().data.matches[0].id'), 'madrid');
  assert.equal(h.call('getSnapshot().data.failed.length'), 0);
  assert.match(h.elements['#list'].innerHTML, /皇家马德里/);
  assert.doesNotMatch(h.elements['#list'].innerHTML, /赛程待确认|未能加载/);
  const legacy = harness([['fs1.enabled', '["eng.1"]'], ['fs1.onlyFollowed', 'true'], ['fs1.followed', '["arsenal"]']], true);
  assert.deepEqual([...legacy.call('fetchLeagues()')], ['eng.1']);
});

test('follow-only with no teams gives actionable guidance and makes no schedule requests', async () => {
  const h = harness([['fs1.onlyFollowed', 'true']], true);
  await h.call('reload()');
  assert.equal(h.attempts(), 0);
  assert.equal(h.elements['#heroCount'].textContent, '尚未关注球队');
  assert.match(h.elements['#list'].innerHTML, /还没有关注球队|添加关注球队|查看全部比赛/);
  assert.doesNotMatch(h.elements['#list'].innerHTML, /赛程待确认|加载中|重新加载/);
  h.call(`setView('week')`);
  assert.match(h.elements['#list'].innerHTML, /还没有关注球队/);
  assert.equal(h.attempts(), 0);
});

test('follow-only keeps an uncertain empty week distinct from confirmed no followed matches', () => {
  const h = harness([['fs1.followed', '["arsenal"]'], ['fs1.onlyFollowed', 'true']], true);
  h.call(`state.view = 'week'; state.loading = false;
    state.weekDays = [{ dayKey: state.dayKey, matches: [], fetchedAt: Date.now(), failed: ['eng.1'] }]; publish()`);
  assert.match(h.elements['#list'].innerHTML, /赛程待确认|重新加载/);
  assert.doesNotMatch(h.elements['#list'].innerHTML, /这7天暂无关注球队的比赛/);
  h.call(`state.weekDays[0].failed = []; publish()`);
  assert.match(h.elements['#list'].innerHTML, /这7天暂无关注球队的比赛/);
  assert.doesNotMatch(h.elements['#list'].innerHTML, /重新加载/);
});

test('follow-only empty-day previews never fall back to unrelated teams', async () => {
  const h = harness([['fs1.followed', '["arsenal"]'], ['fs1.onlyFollowed', 'true']], true);
  h.call(`findNearbyMatchdays = async () => ({ next: { dayKey: '2026-10-02', count: 1 } });
    let previewRequests = 0; loadDay = async () => { previewRequests++; return { matches: [] }; }`);
  await h.call('enrichEmptyDay(loadSeq)');
  assert.equal(h.call('state.preview'), null);
  assert.equal(h.call('state.nearby.next'), undefined);
  assert.equal(h.call('previewRequests'), 0);
});

test('follow-only date dots ignore other teams and require coverage of all queried competitions', () => {
  const h = harness([
    ['fs1.onlyFollowed', 'true'], ['fs1.enabled', '["eng.1"]'],
    ['fs1.followed', JSON.stringify([{ name: 'Real Madrid', leagues: ['esp.1'] }])],
  ], true);
  const day = futureDayKey(2);
  const other = { ...match('other', 'esp.1', 1), start: new Date(`${day}T12:00:00`).toISOString(), home: { name: 'Barcelona' } };
  for (const ym of h.call(`monthsForDay('${day}')`)) seedMonth(h, 'eng.1', ym, []);
  for (const ym of h.call(`monthsForDay('${day}')`)) seedMonth(h, 'esp.1', ym, [other]);
  assert.equal(h.call(`dayDotState('${day}')`), 'off');
  const followed = { ...other, id: 'followed', home: { name: 'Real Madrid' } };
  for (const ym of h.call(`monthsForDay('${day}')`)) seedMonth(h, 'esp.1', ym, [followed]);
  assert.equal(h.call(`dayDotState('${day}')`), 'fill');
  for (const ym of h.call(`monthsForDay('${day}')`)) seedMonth(h, 'esp.1', ym, [], Date.now() - 25 * 3600e3);
  assert.equal(h.call(`dayDotState('${day}')`), 'unk');
});

test('scope and club follow changes sync across tabs without overwriting the selected date or view', () => {
  const h = harness([['fs1.enabled', '["eng.1"]'], ['fs1.followed', '["arsenal"]']], true);
  h.call(`let reloadCalls = 0; reload = () => { reloadCalls++; }; state.dayKey = '2026-10-02'; state.view = 'week'`);
  h.storage.setItem('fs1.onlyFollowed', 'true');
  h.storage.setItem('fs1.day', '2026-10-03');
  h.storage.setItem('fs1.view', 'day');
  h.fireWindow('storage', { key: 'fs1.onlyFollowed' });
  assert.equal(h.call('state.onlyFollowed'), true);
  assert.equal(h.call('reloadCalls'), 1);
  const storedFollows = JSON.stringify([{ name: 'Real Madrid', leagues: ['esp.1'] }]);
  h.storage.setItem('fs1.followed', storedFollows);
  h.fireWindow('storage', { key: 'fs1.followed' });
  assert.equal(h.call('reloadCalls'), 2);
  assert.deepEqual([...h.call('fetchLeagues()')], ['eng.1', 'esp.1']);
  assert.equal(h.call('state.dayKey'), '2026-10-02');
  assert.equal(h.call('state.view'), 'week');
  assert.equal(h.storage.getItem('fs1.day'), '2026-10-03');
  assert.equal(h.storage.getItem('fs1.view'), 'day');
  assert.equal(h.storage.getItem('fs1.followed'), storedFollows);
});

test('removing the last followed team immediately clears its matches and cancels a pending load', async () => {
  const h = harness([['fs1.followed', '["arsenal"]'], ['fs1.onlyFollowed', 'true']], true);
  h.context.fixture = { ...match('arsenal', 'eng.1', 1), home: { name: 'Arsenal', teamId: '359' } };
  h.call(`state.data = { matches: [fixture], failed: [], fetchedAt: Date.now() }; state.loading = false; publish();
    let resolvePending; loadDayVisible = () => new Promise((resolve) => { resolvePending = resolve; });
    const pending = reload(); toggleFollow({ name: 'Arsenal', teamId: '359' })`);
  assert.equal(h.call('getSnapshot().data.matches.length'), 0);
  assert.match(h.elements['#list'].innerHTML, /还没有关注球队/);
  assert.equal(h.call('state.loading'), false);
  h.call(`resolvePending({ matches: [fixture], failed: [], fetchedAt: Date.now() })`);
  await h.call('pending');
  assert.match(h.elements['#list'].innerHTML, /还没有关注球队/);
  assert.equal(h.call('getSnapshot().data.matches.length'), 0);
});

test('a follow learned from a domestic match still finds its selected cup fixtures', async () => {
  const h = harness([
    ['fs1.onlyFollowed', 'true'], ['fs1.enabled', '["eng.1","uefa.champions"]'],
    ['fs1.followed', JSON.stringify([{ name: 'Manchester United', leagues: ['eng.1'] }])],
  ], true);
  const day = futureDayKey(2);
  const cup = { ...match('cup', 'uefa.champions', 1), start: new Date(`${day}T20:00:00`).toISOString(), home: { name: 'Manchester United', teamId: '360' } };
  for (const league of ['eng.1', 'uefa.champions']) for (const ym of h.call(`monthsForDay('${day}')`)) {
    seedMonth(h, league, ym, league === 'uefa.champions' ? [cup] : []);
  }
  const data = await h.call(`loadDayVisible('${day}')`);
  assert.equal(data.matches[0]?.id, 'cup');
});

test('removing one follow also removes its retained empty-day preview immediately', () => {
  const h = harness([['fs1.onlyFollowed', 'true'], ['fs1.followed', '["manchesterunited","arsenal"]']], true);
  h.context.fixtures = [
    { ...match('united', 'eng.1', 2, '360', 9), home: { name: 'Manchester United', teamId: '360' } },
    { ...match('arsenal', 'eng.1', 2, '359', 9), home: { name: 'Arsenal', teamId: '359' } },
  ];
  h.call(`reload = () => {}; state.loading = false; state.data = { matches: [], failed: [], fetchedAt: Date.now() };
    state.preview = { dayKey: '2026-10-02', kind: 'followed', count: 2, matches: fixtures, partial: false };
    toggleFollow({ name: 'Arsenal', teamId: '359' })`);
  assert.deepEqual([...h.call('getSnapshot().preview.matches.map((m) => m.id)')], ['united']);
  assert.equal(h.call('getSnapshot().preview.count'), 1);
  assert.doesNotMatch(h.elements['#list'].innerHTML, /阿森纳/);
});
