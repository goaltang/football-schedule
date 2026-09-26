/* 刷新本地图标库：把各联赛的队徽与联赛标（64px 缩略图）下载到 logos/
 * 用法：node tools/refresh-logos.js
 * 什么时候跑：新赛季、config.js 增加联赛后、或发现新球队图标缺失时
 * 依赖 curl（Windows 10+ 自带）；下载失败会重试 3 次并在最后汇总
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { LEAGUES } = require('../config.js');

const execFileP = promisify(execFile);
const OUT = path.join(__dirname, '..', 'logos');

async function curlBuf(url) {
  const { stdout } = await execFileP(
    'curl',
    ['-sS', '--retry', '3', '--retry-delay', '1', '--retry-all-errors', '-m', '30', url],
    { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 }
  );
  return stdout;
}

async function curlJson(url) {
  return JSON.parse((await curlBuf(url)).toString('utf8'));
}

function small(url) {
  const m = /^https?:\/\/a\.espncdn\.com(\/.+)$/.exec(url || '');
  return m ? `https://a.espncdn.com/combiner/i?img=${m[1]}&w=64&h=64` : url;
}

async function mapLimit(items, limit, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        await fn(items[idx]);
      }
    })
  );
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const jobs = [];
  for (const lg of LEAGUES) {
    let json;
    try {
      json = await curlJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${lg.id}/teams`);
    } catch (e) {
      console.warn(`[${lg.zh}] 球队列表拉取失败: ${e.message}`);
      continue;
    }
    const league = (json.sports && json.sports[0].leagues[0]) || {};
    /* /teams 响应不含联赛 logo，取自轻量 scoreboard 响应的 leagues[0].logos */
    try {
      const sb = await curlJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${lg.id}/scoreboard?dates=20230101`);
      const logos = (sb.leagues && sb.leagues[0] && sb.leagues[0].logos) || [];
      const crest = logos.find((l) => (l.rel || []).includes('dark')) || logos[0];
      if (crest) jobs.push({ file: `lg-${lg.id}.png`, url: small(crest.href) });
    } catch (e) {
      console.warn(`[${lg.zh}] 联赛标拉取失败: ${e.message}`);
    }
    for (const t of (league.teams || [])) {
      const logo = (t.team.logos && t.team.logos[0] && t.team.logos[0].href) || t.team.logo;
      if (logo && t.team.id) jobs.push({ file: `${t.team.id}.png`, url: small(logo) });
    }
    console.log(`[${lg.zh}] 收集 ${(league.teams || []).length} 队`);
  }

  const uniq = [...new Map(jobs.map((j) => [j.file, j])).values()];
  let ok = 0;
  const failed = [];
  await mapLimit(uniq, 6, async (j) => {
    try {
      fs.writeFileSync(path.join(OUT, j.file), await curlBuf(j.url));
      ok++;
    } catch (e) {
      failed.push(`${j.file} (${e.message})`);
    }
  });

  console.log(`完成：${ok}/${uniq.length} 个图标写入 logos/`);
  if (failed.length) {
    console.log('失败（可重跑本命令）：');
    failed.forEach((f) => console.log('  ' + f));
    process.exitCode = 1;
  }
})();
