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
  const el = () => ({
    innerHTML: '', textContent: '', children: [],
    classList: { toggle() {} },
    setAttribute() {},
    addEventListener() {}, contains: () => false,
    querySelectorAll: () => [],
  });
  if (withApp) {
    for (const selector of ['#days', '#chips', '#filterToggle', '#filterCount', '.filters',
      '#list', '#refresh', '#updated', '#goToday', '#prevDay', '#nextDay', '#tz',
      '#heroDate', '#heroWd', '#heroRel', '#heroCount']) elements[selector] = el();
  }
  let attempts = 0;
  const globals = {
    window: { localStorage: storage },
    localStorage: storage,
    AbortController,
    TextEncoder,
    fetch: async () => { attempts++; throw new Error('offline'); },
    setTimeout: (fn, ms) => ms >= 15000 ? null : setImmediate(fn),
    clearTimeout: (id) => clearImmediate(id),
  };
  if (withApp) {
    globals.document = {
      activeElement: { matches: () => false },
      hidden: false,
      querySelector: (selector) => elements[selector] || null,
      addEventListener() {},
    };
    globals.navigator = {};
    globals.location = { protocol: 'file:' };
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
    call: (expression) => vm.runInContext(expression, context),
  };
}

function monthCache(league, events, fetchedAt = Date.now()) {
  return [`fs1|m|${league}|202609`, JSON.stringify({
    fetchedAt,
    league: { id: league, logo: '' },
    events,
  })];
}

function match(id, league, day, teamId = '42') {
  return {
    id,
    league,
    start: new Date(2026, 8, day, 12).toISOString(),
    status: 'SCHEDULED',
    home: { name: 'Home', teamId },
    away: { name: 'Away', teamId: '99' },
  };
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

test('legacy team aliases migrate to ID and keep favorite toggle consistent', () => {
  const h = harness([['fs1.followed', '["intermilan"]']], true);
  h.context.fixture = {
    id: 'fixture', league: 'ita.1', start: new Date().toISOString(), status: 'SCHEDULED',
    home: { name: 'Internazionale', teamId: '115' },
    away: { name: 'Roma', teamId: '112' },
  };
  assert.equal(h.call('isFollowed(fixture.home)'), true);
  assert.equal(h.storage.getItem('fs1.followed'), '["id:115"]');
  assert.equal(h.call('isFollowed({ name: "Inter Milan", teamId: "115" })'), true);
  assert.equal(h.call('isFollowed({ name: "Inter Milan", teamId: "999" })'), false);
  assert.match(h.call('matchRow(fixture)'), /aria-label="取消关注国际米兰" aria-pressed="true"/);
  h.call('toggleFollow(fixture.home)');
  assert.equal(h.storage.getItem('fs1.followed'), '[]');
  assert.match(h.call('matchRow(fixture)'), /aria-label="关注国际米兰" aria-pressed="false"/);
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
