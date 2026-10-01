import { test, expect, type Page } from '@playwright/test';
import { fixtures } from './fixtures';

async function liveFixtures(page: Page) {
  await fixtures(page);
  await page.addInitScript(() => {
    if (localStorage.getItem('__live_ready')) return;
    localStorage.setItem('__live_ready', '1');
    const key = 'fs1|m|eng.1|202609';
    const data = JSON.parse(localStorage.getItem(key)!);
    data.fetchedAt = Date.parse('2026-09-30T11:55:00+08:00');
    data.source = 'snapshot';
    Object.assign(data.events[0], { status: 'LIVE', live: true, minute: "30'", start: '2026-09-30T11:30:00+08:00' });
    data.events[0].home.score = 1;
    data.events[0].away.score = 0;
    localStorage.setItem(key, JSON.stringify(data));
  });
}

function scoreboard(finished = false) {
  return { events: [{ id: 'game-1', date: '2026-09-30T11:30:00+08:00',
    status: { type: { state: finished ? 'post' : 'in' }, displayClock: "35'" },
    competitions: [{ competitors: [
      { homeAway: 'home', team: { id: '360', displayName: 'Manchester United' }, score: '2' },
      { homeAway: 'away', team: { id: '359', displayName: 'Arsenal' }, score: '0' },
    ] }],
  }] };
}

test('live hints reflect score age, an in-flight refresh and the completed result', async ({ page }, testInfo) => {
  await liveFixtures(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('https://site.api.espn.com/**', async (route) => {
    await gate;
    await route.fulfill({ json: route.request().url().includes('/eng.1/') ? scoreboard() : { events: [] } });
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./');
  await expect(page.locator('#updated')).toHaveText('比分更新于 11:55');
  await expect(page.locator('#scoreUpdate')).toContainText('比分可能已延迟');
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.locator('#scoreUpdate')).toContainText('正在更新比分');
  await expect(page.locator('#list .score')).toHaveText('1–0');
  await expect(page.locator('#updated')).toHaveText('比分更新于 11:55');
  release();
  await expect(page.locator('#list .score')).toHaveText('2–0');
  await expect(page.locator('#scoreUpdate')).toContainText('约每分钟自动更新');
  await expect(page.locator('#updated')).toHaveText('比分更新于 12:00');
  await page.getByRole('button', { name: '按周查看' }).click();
  await expect(page.locator('#scoreUpdate')).toContainText('约每分钟自动更新');
  await expect(page.locator('#updated')).toHaveText('比分更新于 12:00');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('score-updates.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('a failed score refresh retains its timestamp and recovers on the automatic retry', async ({ page }, testInfo) => {
  await liveFixtures(page);
  let recover = false;
  await page.route('https://site.api.espn.com/**', (route) => recover
    ? route.fulfill({ json: route.request().url().includes('/eng.1/') ? scoreboard() : { events: [] } }) : route.abort());
  await page.goto('./');
  await expect(page.locator('#updated')).toHaveText('比分更新于 11:55');
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.locator('#scoreUpdate')).toContainText('正在更新比分');
  await expect(page.locator('#scoreUpdate')).toContainText('比分更新失败 · 稍后自动重试');
  await expect(page.locator('#updated')).toHaveText('比分更新于 11:55');
  await expect(page.locator('#list .score')).toHaveText('1–0');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('score-refresh-failed.png'), fullPage: true });
  recover = true;
  await page.clock.runFor(60_000);
  await expect(page.locator('#list .score')).toHaveText('2–0');
  await expect(page.locator('#scoreUpdate')).toContainText('约每分钟自动更新');
  await expect(page.locator('#updated')).not.toHaveText('比分更新于 11:55');
});

test('the live hint disappears when the game finishes or is filtered out', async ({ page }) => {
  await liveFixtures(page);
  await page.goto('./');
  await expect(page.locator('#scoreUpdate')).toBeVisible();
  await page.getByRole('button', { name: '只看关注', exact: true }).click();
  await expect(page.locator('#scoreUpdate')).toHaveCount(0);
  await page.getByRole('button', { name: '查看全部比赛', exact: true }).click();
  await expect(page.locator('#scoreUpdate')).toBeVisible();
  await page.route('https://site.api.espn.com/**', (route) => route.fulfill({
    json: route.request().url().includes('/eng.1/') ? scoreboard(true) : { events: [] },
  }));
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(page.locator('#list .score')).toHaveText('2–0');
  await expect(page.locator('#list')).toContainText('完场');
  await expect(page.locator('#scoreUpdate')).toHaveCount(0);
  await expect(page.locator('#updated')).toHaveText('赛程更新于 12:00');
});
