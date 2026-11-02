import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { cp, readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCalendars } from './tools/build-ics.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const SITE_URL = process.env.SITE_URL || 'https://goaltang.github.io/football-schedule/';
const SNAPSHOT = path.join(root, 'snapshot/schedule.json');

// Generate the shell from the actual build. This preserves the existing custom
// schedule/teams cache policy and precaches every hashed JS/CSS dependency.
function staticAssets(): Plugin {
  let outDir: string;
  return {
    name: 'football-static-assets',
    apply: 'build',
    configResolved(config) { outDir = path.resolve(config.root, config.build.outDir); },
    async closeBundle() {
      for (const item of ['logos', 'icons', 'snapshot', 'manifest.webmanifest']) {
        await cp(path.join(root, item), path.join(outDir, item), { recursive: true });
      }
      const assets = (await readdir(path.join(outDir, 'assets'))).filter((file) => /\.(?:js|css)$/.test(file)).sort();
      const shell = ['./', './index.html', ...assets.map((file) => `./assets/${file}`), './manifest.webmanifest'];
      const html = await readFile(path.join(outDir, 'index.html'), 'utf8');
      const hash = createHash('sha256').update(html).update(JSON.stringify(shell)).digest('hex').slice(0, 12);
      const worker = (await readFile(path.join(root, 'sw.js'), 'utf8'))
        .replace(/const CACHE = '[^']+';/, `const CACHE = 'football-schedule-shell-v16-react-${hash}'`)
        .replace(/const SHELL = \[[\s\S]*?\];/, `const SHELL = ${JSON.stringify(shell, null, 2)};`);
      await writeFile(path.join(outDir, 'sw.js'), worker);
    },
  };
}

// 每支球队一个订阅日历：构建时从快照生成 dist/ics/<teamId>.ics 与 index.json。
// 只有请求到 /ics/ 时才在开发服务器里现算，避免每次启动都跑一遍。
function calendarIcs(): Plugin {
  let outDir = '';
  let base = '/';
  let cached: { mtimeMs: number; result: ReturnType<typeof buildCalendars> } | null = null;

  async function current() {
    const info = await stat(SNAPSHOT);
    if (!cached || cached.mtimeMs !== info.mtimeMs) {
      cached = { mtimeMs: info.mtimeMs, result: buildCalendars({ snapshotPath: SNAPSHOT, siteUrl: SITE_URL }) };
    }
    return cached.result;
  }

  async function serve(url: string, res: import('http').ServerResponse) {
    const name = decodeURIComponent(url.split('?')[0].slice(base.length + 'ics/'.length));
    const { files, index } = await current();
    if (name === 'index.json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(index));
      return true;
    }
    const body = files.get(name);
    if (!body) return false;
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.end(body);
    return true;
  }

  const middleware = (req: { url?: string }, res: import('http').ServerResponse, next: () => void) => {
    const url = req.url || '';
    if (!url.startsWith(`${base}ics/`)) { next(); return; }
    serve(url, res).then((handled) => {
      // 不要落到 SPA 回退：日历客户端拿到 HTML 200 会当成“下载成功”
      if (!handled) { res.statusCode = 404; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end('not found'); }
    }, next);
  };

  return {
    name: 'football-calendar-ics',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
      base = config.base;
    },
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
    async closeBundle() {
      const { files, index } = await current();
      const dir = path.join(outDir, 'ics');
      await mkdir(dir, { recursive: true });
      await Promise.all([...files].map(([name, body]) => writeFile(path.join(dir, name), body)));
      await writeFile(path.join(dir, 'index.json'), JSON.stringify(index));
    },
  };
}

export default defineConfig({
  base: '/football-schedule/',
  publicDir: false,
  plugins: [react(), staticAssets(), calendarIcs()],
  build: { rollupOptions: { input: { main: path.join(root, 'index.html'), coverage: path.join(root, 'tools/zh-coverage.html') } } },
});
