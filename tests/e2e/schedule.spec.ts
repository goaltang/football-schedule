import { test, expect } from '@playwright/test';
import { fixtures } from './fixtures';

test('date navigation, week view and persisted follows work in the built app', async ({ page }) => {
  await fixtures(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./');
  await expect(page.locator('#heroCount')).toHaveText('1 场');
  await page.getByRole('button', { name: '关注曼联', exact: true }).click();
  await expect(page.getByRole('heading', { name: '★ 我的关注' })).toBeVisible();
  await expect(page.locator('#followCount')).toHaveText('1');
  await page.reload();
  await expect(page.locator('#followCount')).toHaveText('1');
  await page.getByRole('button', { name: '按周查看' }).click();
  await expect(page.locator('#wday-2026-10-01')).toContainText('中国');
  await page.getByRole('button', { name: '按日查看' }).click();
  await page.getByRole('button', { name: '后一天', exact: true }).click();
  await expect(page.locator('#heroDate')).toHaveText('10.01');
  await expect(page.locator('#list .score')).toHaveText('2–1');
  await page.getByRole('button', { name: '今天', exact: true }).click();
  await expect(page.locator('#heroDate')).toHaveText('09.30');
  expect(errors).toEqual([]);
});
test('filters retain keyboard focus and followed matches from a disabled competition', async ({ page }, testInfo) => {
  await fixtures(page);
  await page.goto('./');
  await page.getByRole('button', { name: '关注曼联', exact: true }).click();
  const toggle = page.getByRole('button', { name: /赛事筛选/ });
  await expect(toggle).toBeVisible();
  const initiallyOpen = testInfo.project.name !== 'mobile';
  await expect(toggle).toHaveAttribute('aria-expanded', String(initiallyOpen));
  if (initiallyOpen) {
    await expect(page.locator('#chips')).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  }
  await expect(page.locator('#chips')).toBeHidden();
  await toggle.focus();
  await toggle.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#chips')).toBeVisible();
  const league = page.getByRole('button', { name: '英超', exact: true });
  await league.focus();
  await league.press('Space');
  await expect(league).toBeFocused();
  await expect(league).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('heading', { name: '★ 我的关注' })).toBeVisible();
  await expect(page.locator('#list .match')).toHaveCount(1);
  await toggle.click();
  await expect(page.locator('#chips')).toBeHidden();
  await toggle.click();
  await expect(league).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('team search, follow removal focus and preferences survive reload', async ({ page }) => {
  await fixtures(page);
  await page.goto('./');
  await page.locator('#followToggle').click();
  await page.getByRole('searchbox').fill('国足');
  await page.locator('#followResults').getByRole('button', { name: '关注 中国', exact: true }).click();
  await expect(page.locator('#followTeams')).toContainText('中国');
  await expect(page.getByRole('searchbox')).toHaveValue('国足');
  await page.locator('#followTeams').getByRole('button', { name: '取消关注 中国', exact: true }).click();
  await expect(page.locator('#followToggle')).toBeFocused();
  await expect(page.locator('#followCount')).toHaveText('');
  await page.reload();
  await expect(page.locator('#followCount')).toHaveText('');
});
test('cross-tab changes update follows without overwriting the other tabs date', async ({ page, context }) => {
  await fixtures(page);
  await page.goto('./');
  await expect(page.locator('#heroCount')).toHaveText('1 场');
  const peer = await context.newPage();
  await fixtures(peer);
  await peer.goto('./');
  await peer.getByRole('button', { name: '后一天', exact: true }).click();
  await page.getByRole('button', { name: '关注曼联', exact: true }).click();
  await expect(peer.locator('#followCount')).toHaveText('1');
  await expect(peer.locator('#heroDate')).toHaveText('10.01');
  expect(await page.evaluate(() => localStorage.getItem('fs1.day'))).toBe('2026-10-01');
});
test('missing data stays unconfirmed and a complete empty day stays empty', async ({ page }) => {
  await fixtures(page, { unavailable: true });
  await page.goto('./');
  await expect(page.locator('#retry')).toBeVisible({ timeout: 35000 });
  await expect(page.locator('#heroCount')).toHaveText('赛程待确认');
  await expect(page.locator('#list')).not.toContainText('当天暂无所选赛事或关注球队的比赛');
});
test('complete empty days offer navigation and no loading error', async ({ page }) => {
  await fixtures(page, { empty: true });
  await page.goto('./');
  await expect(page.locator('#heroCount')).toHaveText('暂无比赛');
  await expect(page.locator('#list')).toContainText('当天暂无所选赛事或关注球队的比赛');
  await expect(page.locator('#retry')).toHaveCount(0);
});
