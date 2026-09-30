#!/usr/bin/env node
/* 生成赛程快照：snapshot/schedule.json
 *
 * 新设备首次打开时本地没有缓存，若浏览器直连 ESPN 慢或不通就会一直“加载中”。
 * 本脚本由 GitHub Actions 定时运行（.github/workflows/refresh-snapshot.yml），
 * 把所有赛事「上月 ~ 后两个月」的整月赛程和完整球队名单拉下来，按 data.js 同一套归一化写成与本地缓存
 * 同格式的条目，随页面同源部署；前端冷启动时先用它出数据，再在后台联网更新。
 *
 * - 某联赛某月抓取失败：沿用上一份快照里的旧条目，不让一次抖动清空数据
 * - 内容与上一份完全一致（忽略时间戳）且上一份不超过 MAX_AGE_MS：不写文件，避免无意义提交
 * - 一个条目都没抓到：以非 0 退出，保留原快照
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const OUT = path.join(root, 'snapshot', 'schedule.json');
// 小于 3 小时调度间隔：即使赛事内容不变，也发布本轮核对后的时间戳。
// 否则同内容快照被跳过两轮，前端 6 小时有效期会先耗尽。
const MAX_AGE_MS = 2 * 3600e3;
const CONCURRENCY = 4;
const ATTEMPTS = 3;
const TIMEOUT_MS = 20000;

const { LEAGUES } = require(path.join(root, 'config.js'));

/* 复用数据层的归一化，保证与浏览器缓存格式一致 */
const ctx = vm.createContext({ window: {}, Intl, AbortController, setTimeout, clearTimeout, fetch, console });
vm.runInContext(fs.readFileSync(path.join(root, 'data.js'), 'utf8'), ctx, { filename: 'data.js' });
const { ESPN_BASE, normalizeMonthData, normalizeTeams, etBucketOf } =
  vm.runInContext('({ ESPN_BASE, normalizeMonthData, normalizeTeams, etBucketOf })', ctx);

/* 与 data.js 的月份口径一致：按美东日期取“上月、本月、后两个月” */
function monthsWindow() {
  const bucket = etBucketOf(new Date());
  const y = Number(bucket.slice(0, 4));
  const m = Number(bucket.slice(4, 6));
  return [-1, 0, 1, 2].map((off) => {
    const t = y * 12 + (m - 1) + off;
    return `${Math.floor(t / 12)}${String((t % 12) + 1).padStart(2, '0')}`;
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url) {
  let lastErr;
  for (let i = 0; i < ATTEMPTS; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await sleep(500 * (i + 1));
    }
  }
  throw lastErr;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }));
  return results;
}

/* 忽略时间戳的内容指纹，用来判断“是否真的变了” */
function fingerprint(months, teams = {}) {
  return JSON.stringify({
    months: Object.keys(months).sort().map((k) => [k, months[k].league, months[k].events]),
    teams: Object.keys(teams).sort().map((k) => [k, teams[k].teams]),
  });
}

async function main() {
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { /* 首次生成 */ }
  const prevMonths = (prev && prev.months) || {};
  const prevTeams = (prev && prev.teams) || {};

  const yms = monthsWindow();
  const jobs = [];
  for (const lg of LEAGUES) for (const ym of yms) jobs.push({ id: lg.id, ym });

  let ok = 0;
  const failed = [];
  const now = Date.now();
  const entries = await mapLimit(jobs, CONCURRENCY, async ({ id, ym }) => {
    const key = `${id}|${ym}`;
    try {
      const json = await fetchJson(`${ESPN_BASE}/${id}/scoreboard?dates=${ym}&limit=1000`);
      const data = normalizeMonthData(json, id, now);
      ok++;
      return [key, data];
    } catch (e) {
      failed.push(`${key} (${e.message})`);
      return prevMonths[key] ? [key, prevMonths[key]] : null;
    }
  });

  let teamsOk = 0;
  const teamEntries = await mapLimit(LEAGUES, CONCURRENCY, async ({ id }) => {
    try {
      const teams = normalizeTeams(await fetchJson(`${ESPN_BASE}/${id}/teams?limit=1000`));
      if (!teams.length) throw new Error('empty team list');
      teamsOk++;
      return [id, { fetchedAt: now, teams }];
    } catch (e) {
      failed.push(`${id}|teams (${e.message})`);
      return prevTeams[id] ? [id, prevTeams[id]] : null;
    }
  });

  console.log(`fetched ${ok}/${jobs.length}`);
  console.log(`team lists ${teamsOk}/${LEAGUES.length}`);
  if (failed.length) console.log('failed:\n  ' + failed.join('\n  '));
  if (!ok) {
    console.error('no entry could be fetched; keeping the existing snapshot');
    process.exit(1);
  }

  const months = Object.fromEntries(entries.filter(Boolean));
  const teams = Object.fromEntries(teamEntries.filter(Boolean));
  const unchanged = prev && prev.generatedAt && now - prev.generatedAt < MAX_AGE_MS
    && fingerprint(months, teams) === fingerprint(prevMonths, prevTeams);
  if (unchanged) {
    console.log('unchanged, snapshot not rewritten');
    return;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: now, months, teams }) + '\n');
  console.log(`wrote ${path.relative(root, OUT)} (${Object.keys(months).length} entries)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
