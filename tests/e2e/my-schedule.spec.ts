import { test, expect, type Page } from '@playwright/test';
import { fixtures } from './fixtures';

async function myScheduleFixtures(page: Page, followed = ['manchesterunited', 'arsenal']) {
  await fixtures(page, { followed });
  await page.addInitScript(() => {
    if (localStorage.getItem('__my_schedule_ready')) return;
    localStorage.setItem('__my_schedule_ready', '1');
    const game = (id: string, start: string, name: string, teamId: string, awayName = 'Roma', awayId = '104') => ({
      id, league: 'eng.1', start, status: 'SCHEDULED', home: { name, teamId }, away: { name: awayName, teamId: awayId },
    });
    const events = [
      game('yesterday', '2026-09-29T20:00:00+08:00', 'Manchester United', '360'),
      game('other', '2026-09-30T14:00:00+08:00', 'Liverpool', '364'),
      game('today-early', '2026-09-30T18:00:00+08:00', 'Manchester United', '360', 'Arsenal', '359'),
      game('today-late', '2026-09-30T22:00:00+08:00', 'Arsenal', '359'),
      game('overnight', '2026-10-01T00:30:00+08:00', 'Manchester United', '360'),
      game('day-six', '2026-10-06T20:00:00+08:00', 'Arsenal', '359'),
      game('outside', '2026-10-07T20:00:00+08:00', 'Manchester United', '360'),
    ];
    for (const ym of ['202609', '202610']) localStorage.setItem(`fs1|m|eng.1|${ym}`, JSON.stringify({
      fetchedAt: Date.parse('2026-09-30T12:00:00+08:00'), league: { id: 'eng.1', logo: '' }, events,
    }));
  });
}

async function matchIds(page: Page) {
  return page.locator('#list .match').evaluateAll((rows) => rows.map((row) => row.querySelector<HTMLElement>('[data-match]')?.dataset.match));
}

test('only-followed day and seven-day schedules are ordered, span midnight and persist', async ({ page }, testInfo) => {
  await myScheduleFixtures(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./');
  const scope = page.getByRole('button', { name: '只看关注', exact: true });
  await scope.click();
  await expect(scope).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#list .match')).toHaveCount(2);
  expect(await matchIds(page)).toEqual(['today-early', 'today-late']);
  await page.getByRole('button', { name: '按周查看' }).click();
  await expect(page.locator('#heroDate')).toHaveText('09.30–10.06');
  await expect(page.locator('#list .match')).toHaveCount(4);
  expect(await matchIds(page)).toEqual(['today-early', 'today-late', 'overnight', 'day-six']);
  await expect(page.locator('#wday-2026-10-01')).toContainText('00:30');
  await expect(page.locator('#heroCount')).toHaveText('4 场 · 关注球队');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('my-schedule.png'), fullPage: true });
  await page.reload();
  await expect(scope).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '按周查看' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#list .match')).toHaveCount(4);
  expect(await page.evaluate(() => localStorage.getItem('fs1.enabled'))).toBe('["eng.1","esp.1"]');
  expect(errors).toEqual([]);
});

test('seven-day navigation uses adjacent ranges and Today restores the upcoming range', async ({ page }) => {
  await myScheduleFixtures(page);
  await page.goto('./');
  await page.getByRole('button', { name: '只看关注', exact: true }).click();
  await page.getByRole('button', { name: '按周查看' }).click();
  await page.locator('[data-day="2026-10-02"]').click();
  await expect(page.locator('#heroDate')).toHaveText('09.30–10.06');
  await page.getByRole('button', { name: '后一周', exact: true }).click();
  await expect(page.locator('#heroDate')).toHaveText('10.07–10.13');
  await expect(page.locator('#list .match')).toHaveCount(1);
  expect(await matchIds(page)).toEqual(['outside']);
  await page.getByRole('button', { name: '前一周', exact: true }).click();
  await expect(page.locator('#heroDate')).toHaveText('09.30–10.06');
  await page.getByRole('button', { name: '前一周', exact: true }).click();
  await expect(page.locator('#heroDate')).toHaveText('09.23–09.29');
  await page.getByRole('button', { name: '今天', exact: true }).click();
  await expect(page.locator('#heroDate')).toHaveText('09.30–10.06');
  await expect(page.locator('#list .match')).toHaveCount(4);
});

test('empty follows guide the user through search and return to guidance after removal', async ({ page }) => {
  await fixtures(page);
  await page.goto('./');
  await page.getByRole('button', { name: '只看关注', exact: true }).click();
  await expect(page.locator('#list')).toContainText('还没有关注球队');
  await page.getByRole('button', { name: '添加关注球队', exact: true }).click();
  await expect(page.getByRole('searchbox')).toBeFocused();
  await page.getByRole('searchbox').fill('曼联');
  await page.locator('#followResults').getByRole('button', { name: '关注 曼联', exact: true }).click();
  await expect(page.locator('#list .match')).toHaveCount(1);
  await page.locator('#followTeams').getByRole('button', { name: '取消关注 曼联', exact: true }).click();
  await expect(page.locator('#list')).toContainText('还没有关注球队');
  await expect(page.locator('#list .match')).toHaveCount(0);
  await page.getByRole('button', { name: '查看全部比赛', exact: true }).click();
  await expect(page.getByRole('button', { name: '只看关注', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#list .match')).toHaveCount(1);
});

test('scope and removed follows sync across tabs while their date and view stay independent', async ({ page, context }) => {
  await myScheduleFixtures(page, ['manchesterunited']);
  await page.goto('./');
  const peer = await context.newPage();
  await myScheduleFixtures(peer, ['manchesterunited']);
  await peer.goto('./');
  await peer.getByRole('button', { name: '按周查看' }).click();
  await peer.locator('[data-day="2026-10-01"]').click();
  await page.getByRole('button', { name: '只看关注', exact: true }).click();
  await expect(peer.getByRole('button', { name: '只看关注', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(peer.locator('#list .match')).toHaveCount(2);
  await expect(peer.locator('[data-day="2026-10-01"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(peer.getByRole('button', { name: '按周查看' })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#followToggle').click();
  await page.locator('#followTeams').getByRole('button', { name: '取消关注 曼联', exact: true }).click();
  await expect(peer.locator('#list')).toContainText('还没有关注球队');
  expect(await page.evaluate(() => localStorage.getItem('fs1.day'))).toBe('2026-10-01');
  expect(await peer.evaluate(() => localStorage.getItem('fs1.onlyFollowed'))).toBe('true');
});
