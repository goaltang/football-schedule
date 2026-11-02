#!/usr/bin/env node
/* 从 snapshot/schedule.json 生成每支球队的订阅日历（dist/ics/<teamId>.ics）与索引。
 *
 * 为什么在构建时生成而不是提交到仓库：
 * - 快照每 3 小时更新一次，300+ 个 .ics 放进仓库会让仓库和提交记录无限膨胀；
 * - 构建产物里的文件与当次快照必然一致，不会出现快照更新了日历没更新的情况。
 *
 * 窗口与快照一致（上月 ~ 后两个月），只保留还没结束的比赛，所以订阅源是“滚动”的：
 * 每次构建都会补上新的比赛、丢掉过去的比赛，日历客户端按 UID 更新已有事件。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LEAGUES } from '../config.js';
import { zhName } from '../team-names.js';
import { nameKeys } from '../src/domain/following.js';
import { calendarBlock } from '../src/domain/ics.js';

/* 已经开赛一段时间的不再推送，避免每次构建都把昨天比分塞进日历 */
const PAST_GRACE_MS = 3 * 3600e3;
const MATCH_MS = 2 * 3600e3;
const ALARM_MINUTES = 30;

const LEAGUE_ZH = new Map(LEAGUES.map((league) => [league.id, league.zh]));

function leagueLabel(id) {
  return LEAGUE_ZH.get(id) || id || '';
}

function readSnapshot(snapshotPath) {
  const raw = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  return { generatedAt: Number(raw.generatedAt) || 0, months: raw.months || {} };
}

/* 摊平月份数据，按比赛 ID 去重（保留抓取时间较新的那份） */
function collectMatches(snapshot) {
  const byId = new Map();
  for (const entry of Object.values(snapshot.months)) {
    const fetchedAt = Number(entry.fetchedAt) || snapshot.generatedAt;
    for (const match of entry.events || []) {
      if (!match || match.id == null) continue;
      const prev = byId.get(match.id);
      if (!prev || fetchedAt > prev.stamp) byId.set(match.id, { match, stamp: fetchedAt });
    }
  }
  return [...byId.values()];
}

function teamIdOf(team) {
  const id = team && team.teamId != null ? String(team.teamId) : '';
  return /^[A-Za-z0-9_-]+$/.test(id) ? id : '';
}

function displayName(team) {
  return zhName(team.name) || team.name || '待定';
}

/* 按球队聚合未来的比赛 */
function groupByTeam(rows, now) {
  const teams = new Map();
  for (const { match, stamp } of rows) {
    const start = new Date(match.start).getTime();
    if (!Number.isFinite(start) || start < now - PAST_GRACE_MS) continue;
    for (const side of ['home', 'away']) {
      const team = match[side];
      const id = teamIdOf(team);
      if (!id) continue;
      if (!teams.has(id)) teams.set(id, { id, name: team.name || '', matches: [], leagues: new Set() });
      const bucket = teams.get(id);
      bucket.matches.push({ match, stamp, side });
      if (match.league) bucket.leagues.add(match.league);
    }
  }
  return teams;
}

function teamCalendar(entry, { siteUrl }) {
  const name = displayName(entry.matches[0].match[entry.matches[0].side]);
  const events = entry.matches
    .slice()
    .sort((a, b) => new Date(a.match.start) - new Date(b.match.start))
    .map(({ match, stamp, side }) => {
      const home = displayName(match.home);
      const away = displayName(match.away);
      const league = leagueLabel(match.league);
      return {
        uid: `${match.id}@football-schedule`,
        stamp,
        start: new Date(match.start).getTime(),
        durationMs: MATCH_MS,
        title: `${home} vs ${away}`,
        location: [league, side === 'home' ? '主场' : '客场'].filter(Boolean).join(' · '),
        description: [league, `${home} vs ${away}`, siteUrl ? `赛程与比分：${siteUrl}` : ''].filter(Boolean).join(' · '),
        status: match.status,
        alarmMinutes: ALARM_MINUTES,
      };
    });
  return calendarBlock({
    name: `赛程 · ${name}`,
    description: `${name}的近期赛程，随赛程更新自动调整`,
    ttlMinutes: 60,
    events,
  });
}

/* 生成全部球队日历与索引。files 的键是 `<teamId>.ics`
 * @param {{ snapshotPath?: string, siteUrl?: string, now?: number }} [options] */
function buildCalendars(options = {}) {
  const { snapshotPath, siteUrl = '', now = Date.now() } = options;
  const snapshot = readSnapshot(snapshotPath);
  const teams = groupByTeam(collectMatches(snapshot), now);
  const files = new Map();
  const index = { generatedAt: now, teams: [] };
  for (const entry of [...teams.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    const sample = entry.matches[0].match[entry.matches[0].side];
    const zh = zhName(sample.name) || sample.name || '';
    files.set(`${entry.id}.ics`, teamCalendar(entry, { siteUrl }));
    index.teams.push({
      id: entry.id,
      name: sample.name || '',
      zh,
      keys: [...new Set(nameKeys({ name: sample.name || '' }))],
      leagues: [...entry.leagues].sort(),
      count: entry.matches.length,
    });
  }
  return { files, index };
}

/* @param {string} outDir
 * @param {{ snapshotPath?: string, siteUrl?: string, now?: number }} [options] */
function writeCalendars(outDir, options = {}) {
  const { files, index } = buildCalendars(options);
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, content] of files) fs.writeFileSync(path.join(outDir, name), content);
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index) + '\n');
  return { teams: files.size, events: index.teams.reduce((sum, team) => sum + team.count, 0) };
}

/* 命令行：node tools/build-ics.js [输出目录]（默认 dist/ics，便于人工检查） */
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const out = path.resolve(root, process.argv[2] || 'dist/ics');
  const stats = writeCalendars(out, {
    snapshotPath: path.join(root, 'snapshot/schedule.json'),
    siteUrl: process.env.SITE_URL || 'https://goaltang.github.io/football-schedule/',
  });
  console.log(`wrote ${stats.teams} team calendars (${stats.events} events) to ${path.relative(root, out)}`);
}

export { buildCalendars, writeCalendars };
