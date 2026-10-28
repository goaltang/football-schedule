import { test, expect, type Page } from '@playwright/test';
import { fixtures } from './fixtures';

const CALENDAR = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//football-schedule//zh-CN',
  'BEGIN:VEVENT',
  'UID:game-1@football-schedule',
  'DTSTAMP:20260930T120000Z',
  'DTSTART:20260930T120000Z',
  'SUMMARY:曼彻斯特联 vs 阿森纳',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');

async function calendarRoutes(page: Page, teams: unknown[]) {
  await page.route('**/ics/index.json', (route) => route.fulfill({ json: { teams } }));
  await page.route('**/ics/359.ics', (route) => route.fulfill({ contentType: 'text/calendar; charset=utf-8', body: CALENDAR }));
}

const arsenal = { id: '359', name: 'Arsenal', zh: '阿森纳', keys: ['arsenal'], leagues: ['eng.1'], count: 4 };

test('a followed team can be added to the phone calendar', async ({ page }) => {
  await fixtures(page, { followed: [{ id: '359', name: 'Arsenal', names: ['arsenal'], leagues: ['eng.1'] }] });
  await calendarRoutes(page, [arsenal]);
  await page.goto('./');
  await page.locator('#followToggle').click();
  const add = page.getByRole('button', { name: '加进日历 阿森纳' });
  await add.click();
  const dialog = page.getByRole('dialog', { name: '加进日历' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.panel-summary')).toContainText('接下来约两个月 4 场');
  await expect(dialog.getByRole('link', { name: /在日历应用里打开/ })).toHaveAttribute('href', /^webcal:\/\/.+\/ics\/359\.ics$/);
  await expect(dialog.locator('.cal-url')).toHaveValue(/\/ics\/359\.ics$/);
  await expect(dialog).toContainText('安卓 / 电脑');
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(add).toBeFocused();
});

test('a team without a published calendar does not invent matches', async ({ page }) => {
  await fixtures(page, { followed: [{ id: '359', name: 'Arsenal', names: ['arsenal'], leagues: ['eng.1'] }] });
  await calendarRoutes(page, []);
  await page.goto('./');
  await page.locator('#followToggle').click();
  await page.getByRole('button', { name: '加进日历 阿森纳' }).click();
  const dialog = page.getByRole('dialog', { name: '加进日历' });
  await expect(dialog).toContainText('暂时查不到这支球队的近期赛程');
  await expect(dialog.getByRole('link', { name: /在日历应用里打开/ })).toHaveCount(0);
});

test('exporting all followed teams downloads a single calendar file', async ({ page }) => {
  await fixtures(page, { followed: [{ id: '359', name: 'Arsenal', names: ['arsenal'], leagues: ['eng.1'] }] });
  await calendarRoutes(page, [arsenal]);
  await page.goto('./');
  await page.locator('#followToggle').click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出全部关注' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('赛程-我的关注.ics');
  await expect(page.locator('#followManager')).toContainText('已导出 1 支球队');
});
