import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { cp, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
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
        .replace(/const CACHE = '[^']+';/, `const CACHE = 'football-schedule-shell-v16-react-${hash}';`)
        .replace(/const SHELL = \[[\s\S]*?\];/, `const SHELL = ${JSON.stringify(shell, null, 2)};`);
      await writeFile(path.join(outDir, 'sw.js'), worker);
    },
  };
}
export default defineConfig({
  base: '/football-schedule/',
  publicDir: false,
  plugins: [react(), staticAssets()],
  build: { rollupOptions: { input: { main: path.join(root, 'index.html'), coverage: path.join(root, 'tools/zh-coverage.html') } } },
});
