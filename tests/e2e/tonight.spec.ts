import { test, expect, type Page } from '@playwright/test';
import { fixtures } from './fixtures';

async function tonightFixtures(page: Page, options: { empty?: boolean; partial?: boolean; unavailable?: boolean } = {}) {
  await fixtures(page, { followed: ['manchesterunited', 'arsenal', 'realmadrid'] });
  await page.addInitScript((options) => {
    if (localStorage.getItem('__tonight_ready')) return;
    localStorage.setItem('__tonight_ready', '1');
    localStorage.setItem('fs1.enabled', '["eng.1"]');
    localStorage.setItem('fs1.followed', JSON.stringify([
      { id: '360', name: 'Manchester United', names: ['manchesterunited'], leagues: ['eng.1'] },
      { id: '359', name: 'Arsenal', names: ['arsenal'], leagues: ['eng.1'] },
      { id: '86', name: 'Real Madrid', names: ['realmadrid'], leagues: ['esp.1'] },
    ]));
    const game = (id: string, start: string, name = 'Arsenal', teamId = '359', league = 'eng.1') => ({
      id, start, league, status: 'SCHEDULED', home: { name, teamId }, away: { name: 'Roma', teamId: '104' },
    });
    const events = [
      game('earlier', '2026-09-30T02:00:00+08:00'),
      game('before', '2026-09-30T17:59:59+08:00'),
      { ...game('opening', '2026-09-30T18:00:00+08:00', 'Manchester United', '360'), away: { name: 'Arsenal', teamId: '359' } },
      game('other', '2026-09-30T20:00:00+08:00', 'Liverpool', '364'),
      game('disabled-followed', '2026-09-30T22:00:00+08:00', 'Real Madrid', '86', 'esp.1'),
      game('disabled-other', '2026-09-30T23:00:00+08:00', 'Valencia', '94', 'esp.1'),
      game('midnight', '2026-10-01T00:00:00+08:00'),
      game('dawn', '2026-10-01T05:59:59+08:00', 'Manchester United', '360'),
      game('after', '2026-10-01T06:00:00+08:00'),
      game('next-night', '2026-10-01T20:00:00+08:00'),
    ];
    for (const id of ['eng.1', 'esp.1']) for (const ym of ['202609', '202610']) {
      const key = `fs1|m|${id}|${ym}`;
      if (options.unavailable || (options.partial && ym === '202610')) { localStorage.removeItem(key); continue; }
      localStorage.setItem(key, JSON.stringify({
        fetchedAt: Date.parse('2026-09-30T12:00:00+08:00'), league: { id, logo: '' },
        events: events.filter((match) => match.league === id && (!options.empty || ['before', 'after'].includes(match.id))),
      }));
    }
  }, options);
}

async function matchIds(page: Page) {
  return page.locator('#list .match').evaluateAll((rows) => rows.map((row) => row.querySelector<HTMLElement>('[data-match]')?.dataset.match));
}

test('tonight spans the month boundary, respects filters and follows, and restores on reload', async ({ page }, testInfo) => {
  await tonightFixtures(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./');
  const tonight = page.getByRole('button', { name: '今晚', exact: true });
  await tonight.focus();
  await page.keyboard.press('Enter');
  await expect(tonight).toHaveAttribute('aria-pressed', 'true');
  await expect(tonight).toBeFocused();
  await expect(page.locator('#heroDate')).toHaveText('今晚');
  await expect(page.locator('#heroWd')).toHaveText('18:00–次日06:00');
  await expect(page.locator('#tonightRange')).toContainText('9月30日晚间 — 10月1日凌晨');
  await expect(page.locator('#list .match')).toHaveCount(5);
  expect(await matchIds(page)).toEqual(['opening', 'other', 'disabled-followed', 'midnight', 'dawn']);
  await expect(page.getByRole('region', { name: '10月1日凌晨比赛' })).toContainText('次日凌晨');
  await expect(page.locator('#heroCount')).toHaveText('5 场 · 关注 4 场');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('tonight.png'), fullPage: true, animations: 'disabled' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: testInfo.outputPath('tonight-dark.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: '只看关注', exact: true }).click();
  await expect(page.locator('#list .match')).toHaveCount(4);
  expect(await matchIds(page)).toEqual(['opening', 'disabled-followed', 'midnight', 'dawn']);
  await page.reload();
  await expect(tonight).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#list .match')).toHaveCount(4);
  expect(await page.evaluate(() => localStorage.getItem('fs1.enabled'))).toBe('["eng.1"]');
  expect(errors).toEqual([]);
});

test('today, date navigation and seven-day view leave tonight with their usual date ranges', async ({ page }) => {
  await tonightFixtures(page);
  await page.goto('./');
  const tonight = page.getByRole('button', { name: '今晚', exact: true });
  await tonight.click();
  await page.getByRole('button', { name: '今天', exact: true }).click();
  await expect(tonight).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#heroDate')).toHaveText('09.30');
  await expect(page.getByRole('button', { name: '按日查看' })).toHaveAttribute('aria-pressed', 'true');
  await tonight.click();
  await page.locator('[data-day="2026-10-01"]').click();
  await expect(page.locator('#heroDate')).toHaveText('10.01');
  await expect(page.locator('#tonightRange')).toHaveCount(0);
  await tonight.click();
  await page.getByRole('button', { name: '按周查看' }).click();
  await expect(page.locator('#heroDate')).toHaveText('09.30–10.06');
  await expect(tonight).toHaveAttribute('aria-pressed', 'false');
  await tonight.click();
  await expect(page.locator('#list .match')).toHaveCount(5);
  await page.getByRole('button', { name: '后一天', exact: true }).click();
  await expect(page.locator('#heroDate')).toHaveText('10.01');
});

test('tonight stays on the same night at midnight and advances at 06:00 even after being hidden', async ({ page }) => {
  await tonightFixtures(page);
  await page.clock.setFixedTime(new Date('2026-09-30T23:59:00+08:00'));
  await page.goto('./');
  await page.getByRole('button', { name: '今晚', exact: true }).click();
  await expect(page.locator('#list .match')).toHaveCount(5);
  await page.clock.setFixedTime(new Date('2026-10-01T00:01:00+08:00'));
  await page.clock.runFor(60_000);
  await expect(page.locator('#tonightRange')).toContainText('9月30日晚间 — 10月1日凌晨');
  await page.reload();
  await expect(page.locator('#list .match')).toHaveCount(5);
  await page.clock.setFixedTime(new Date('2026-10-01T06:00:00+08:00'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('#tonightRange')).toContainText('10月1日晚间 — 10月2日凌晨');
  await expect(page.locator('#list .match')).toHaveCount(1);
  expect(await matchIds(page)).toEqual(['next-night']);
});

test('empty tonight does not include daytime matches or suggest an unrelated preview', async ({ page }) => {
  await tonightFixtures(page, { empty: true });
  await page.goto('./');
  await page.getByRole('button', { name: '今晚', exact: true }).click();
  await expect(page.locator('#heroCount')).toHaveText('今晚暂无比赛');
  await expect(page.locator('#list')).toContainText('今晚暂无所选赛事或关注球队的比赛');
  await expect(page.locator('#list .match')).toHaveCount(0);
  await expect(page.locator('#list')).not.toContainText('赛程预览');
  await page.getByRole('button', { name: '查看今天比赛', exact: true }).click();
  await expect(page.locator('#heroDate')).toHaveText('09.30');
  await page.getByRole('button', { name: '今晚', exact: true }).click();
  await page.getByRole('button', { name: '只看关注', exact: true }).click();
  await expect(page.locator('#list')).toContainText('今晚暂无关注球队的比赛');
});

test('a missing next-day month keeps known tonight matches and warns about incomplete coverage', async ({ page }) => {
  await tonightFixtures(page, { partial: true });
  await page.goto('./');
  await page.getByRole('button', { name: '今晚', exact: true }).click();
  await expect(page.locator('#heroCount')).toContainText('部分赛程未能加载');
  await expect(page.locator('#list .match')).toHaveCount(5);
  await expect(page.locator('#list .warn')).toContainText('赛程未能加载');
  await expect(page.locator('#list')).not.toContainText('今晚暂无');
  await expect(page.locator('#list').getByRole('button', { name: '重新加载' })).toBeVisible();
});

test('no available night data is uncertain and can be retried', async ({ page }) => {
  await tonightFixtures(page, { unavailable: true });
  await page.goto('./');
  await page.getByRole('button', { name: '今晚', exact: true }).click();
  await expect(page.locator('#list')).toContainText('暂时无法确认今晚是否有比赛');
  await expect(page.locator('#list')).not.toContainText('今晚暂无');
  await expect(page.locator('#list').getByRole('button', { name: '重新加载' })).toBeVisible();
});

test('tonight automatically refreshes an included live score', async ({ page }) => {
  await tonightFixtures(page);
  await page.clock.setFixedTime(new Date('2026-09-30T19:00:00+08:00'));
  await page.addInitScript(() => {
    if (localStorage.getItem('__tonight_live_ready')) return;
    localStorage.setItem('__tonight_live_ready', '1');
    for (const id of ['eng.1', 'esp.1']) for (const ym of ['202609', '202610']) {
      const key = `fs1|m|${id}|${ym}`;
      const data = JSON.parse(localStorage.getItem(key)!);
      data.fetchedAt = Date.parse('2026-09-30T19:00:00+08:00');
      const match = data.events.find((match: { id: string }) => match.id === 'opening');
      if (match) {
        Object.assign(match, { status: 'LIVE', live: true, minute: "45'" });
        match.home.score = 1; match.away.score = 0;
      }
      localStorage.setItem(key, JSON.stringify(data));
    }
  });
  await page.route('https://site.api.espn.com/**', (route) => route.fulfill({ json: {
    events: route.request().url().includes('/eng.1/') ? [{
      id: 'opening', date: '2026-09-30T18:00:00+08:00', status: { type: { state: 'in' }, displayClock: "46'" },
      competitions: [{ competitors: [
        { homeAway: 'home', team: { id: '360', displayName: 'Manchester United' }, score: '2' },
        { homeAway: 'away', team: { id: '359', displayName: 'Arsenal' }, score: '0' },
      ] }],
    }] : [],
  } }));
  await page.goto('./');
  await page.getByRole('button', { name: '今晚', exact: true }).click();
  const live = page.locator('#list .match').filter({ has: page.locator('[data-match="opening"]') });
  await expect(live.locator('.score')).toHaveText('1–0');
  await expect(page.locator('#scoreUpdate')).toContainText('约每分钟自动更新');
  await page.clock.runFor(60_000);
  await expect(live.locator('.score')).toHaveText('2–0');
  await expect(page.getByRole('button', { name: '今晚', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
