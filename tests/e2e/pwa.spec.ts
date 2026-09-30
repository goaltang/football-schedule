import { test, expect } from '@playwright/test';
import { fixtures } from './fixtures';
test.use({ serviceWorkers: 'allow' });
test('production shell and preferences can reopen offline', async ({ page, context }, testInfo) => {
  await fixtures(page);
  await page.goto('./');
  await expect(page.locator('#heroCount')).toHaveText('1 场');
  await page.getByRole('button', { name: '关注曼联', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const manifest = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifest).toBe('/football-schedule/manifest.webmanifest');
  const cached = await page.evaluate(async () => {
    const name = (await caches.keys()).find((key) => key.startsWith('football-schedule-shell-v16-react-'))!;
    return (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname);
  });
  expect(cached.some((url) => /\/assets\/main-.*\.js$/.test(url))).toBe(true);
  expect(cached.some((url) => /\/assets\/team-names-.*\.js$/.test(url))).toBe(true);
  expect(cached.some((url) => /\/assets\/main-.*\.css$/.test(url))).toBe(true);
  expect(cached).toContain('/football-schedule/manifest.webmanifest');
  // Preview servers can send Vary: Origin. Precache and module requests use
  // different Origin headers in Chromium; reproduce that mismatch explicitly.
  const variedAssets = await page.evaluate(async () => {
    const name = (await caches.keys()).find((key) => key.startsWith('football-schedule-shell-v16-react-'))!;
    const cache = await caches.open(name);
    let varied = 0;
    for (const request of await cache.keys()) {
      if (!/\/assets\/[^/]+\.(?:js|css)$/.test(new URL(request.url).pathname)) continue;
      const response = (await cache.match(request))!;
      const headers = new Headers(response.headers);
      headers.set('Vary', 'Origin, X-Precache-Origin');
      await cache.delete(request, { ignoreVary: true });
      await cache.put(new Request(request.url, { headers: { 'X-Precache-Origin': 'install' } }),
        new Response(await response.arrayBuffer(), { status: response.status, headers }));
      if (!(await cache.match(request.url))) varied++;
    }
    return varied;
  });
  expect(variedAssets).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath('page.png'), fullPage: true });
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#heroCount')).toContainText('1 场');
  await expect(page.locator('#followCount')).toHaveText('1');
  await expect(page.getByRole('heading', { name: '★ 我的关注' })).toBeVisible();
});
