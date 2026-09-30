#!/usr/bin/env node
'use strict';

// 发布完整联赛名单；请求失败保留上一份，不用赛程推断球队所属联赛。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const out = path.join(root, 'snapshot', 'teams.json');
const { LEAGUES } = require(path.join(root, 'config.js'));
const ctx = vm.createContext({ window: {}, Intl, AbortController, setTimeout, clearTimeout, fetch, console });
vm.runInContext(fs.readFileSync(path.join(root, 'data.js'), 'utf8'), ctx);
const { ESPN_BASE, normalizeTeams, mapLimit } = vm.runInContext('({ ESPN_BASE, normalizeTeams, mapLimit })', ctx);

async function main() {
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(out, 'utf8')).leagues || {}; } catch (e) { /* 首次生成 */ }
  let ok = 0;
  const entries = await mapLimit(LEAGUES, 4, async ({ id }) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${ESPN_BASE}/${id}/teams?limit=1000`, { signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const teams = normalizeTeams(json);
        if (!teams.length) throw new Error('empty team list');
        ok++;
        return [id, { fetchedAt: Date.now(), teams }];
      } catch (e) {
        if (attempt === 2) console.warn(`${id}: ${e.message}; keeping previous list`);
      }
    }
    return prev[id] ? [id, prev[id]] : null;
  });
  if (!ok) throw new Error('no team list fetched; keeping existing snapshot');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ generatedAt: Date.now(), leagues: Object.fromEntries(entries.filter(Boolean)) }) + '\n');
  console.log(`wrote team snapshot (${ok}/${LEAGUES.length} refreshed)`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
