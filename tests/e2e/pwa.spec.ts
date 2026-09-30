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
  await page.screenshot({ path: testInfo.outputPath('page.png'), fullPage: true });
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#heroCount')).toContainText('1 场');
  await expect(page.locator('#followCount')).toHaveText('1');
  await expect(page.getByRole('heading', { name: '★ 我的关注' })).toBeVisible();
});
