import { test, expect, type Locator, type Page } from '@playwright/test';
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

async function followPreviewFixtures(page: Page, status = 'SCHEDULED') {
  await fixtures(page, { followed: [
    { id: '360', name: 'Manchester United', names: ['manchesterunited'], leagues: ['eng.1'] },
    { id: '359', name: 'Arsenal', names: ['arsenal'], leagues: ['eng.1'] },
  ], events: [{
    id: 'preview-boundary', league: 'eng.1', start: '2026-09-30T16:30:00Z', status,
    home: { name: 'Manchester United', teamId: '360' }, away: { name: 'Leeds United', teamId: '357' },
  }, ...(status === 'SCHEDULED' ? [{
    id: 'earlier-other-follow', league: 'eng.1', start: '2026-09-30T16:10:00Z', status,
    home: { name: 'Arsenal', teamId: '359' }, away: { name: 'Roma', teamId: '104' },
  }] : [])] });
}

async function expectRevealed(match: Locator) {
  await expect(match).toBeFocused();
  await expect.poll(() => match.evaluate((row) => {
    const rect = row.getBoundingClientRect();
    const controls = document.querySelector('.sticky-bar')!.getBoundingClientRect();
    const style = getComputedStyle(row);
    return rect.top >= Math.max(0, controls.bottom) && rect.bottom <= innerHeight
      && rect.left >= 0 && rect.right <= innerWidth && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
  })).toBe(true);
  await expect(match).toHaveAttribute('tabindex', '-1');
}

for (const view of ['day', 'week', 'tonight'] as const) {
  test(`follow preview navigates from ${view} to the local date across a UTC month boundary`, async ({ page }) => {
    await followPreviewFixtures(page);
    await page.goto('./');
    const onlyFollowed = view === 'week';
    if (onlyFollowed) await page.getByRole('button', { name: '只看关注', exact: true }).click();
    if (view === 'week') await page.getByRole('button', { name: '按周查看' }).click();
    if (view === 'tonight') await page.getByRole('button', { name: '今晚', exact: true }).click();
    if (view === 'week') await expect(page.locator('#wday-2026-10-01 .match')).toHaveCount(2);
    await page.locator('#followToggle').click();
    await page.getByRole('searchbox').fill('曼联');
    const preferences = await page.evaluate(() => ({ enabled: localStorage.getItem('fs1.enabled'), followed: localStorage.getItem('fs1.followed') }));
    const preview = page.locator('#followTeams').getByRole('button', { name: /查看当天比赛.*曼联.*2026-10-01/ });
    await expect(preview).toContainText('10/1 00:30');
    if (view === 'day') await preview.click();
    else {
      await preview.focus();
      await preview.press('Enter');
    }
    await expect(page.locator('#followManager')).toBeHidden();
    await expect(page.locator('#followToggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[data-day="2026-10-01"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: view === 'week' ? '按周查看' : '按日查看' })).toHaveAttribute('aria-pressed', 'true');
    const section = view === 'week' ? page.locator('#wday-2026-10-01')
      : page.locator('#list section').filter({ has: page.getByRole('heading', { name: '★ 我的关注', exact: true }) });
    const match = section.locator('.match[data-match="preview-boundary"][data-league="eng.1"]');
    await expectRevealed(match);
    if (view !== 'week') await expect(match).toHaveAttribute('data-copy', 'followed');
    else await expect(page.locator('#heroDate')).toHaveText('09.30–10.06');
    await expect(match).toContainText('曼联');
    await expect(match).toContainText('利兹联');
    await expect(match).toContainText('00:30');
    await expect(page.getByRole('button', { name: '只看关注', exact: true })).toHaveAttribute('aria-pressed', String(onlyFollowed));
    expect(await page.evaluate(() => ({ enabled: localStorage.getItem('fs1.enabled'), followed: localStorage.getItem('fs1.followed') }))).toEqual(preferences);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    // Subsequent controller ticks must leave the user's new focus and scroll alone.
    await page.locator('#followToggle').click();
    await expect(page.getByRole('searchbox')).toHaveValue('曼联');
    await page.getByRole('searchbox').focus();
    await expect(page.getByRole('searchbox')).toBeFocused();
    const scroll = await page.evaluate(() => scrollY);
    await page.clock.runFor(60_000);
    await expect(page.getByRole('searchbox')).toBeFocused();
    expect(await page.evaluate(() => scrollY)).toBe(scroll);
    const remove = page.locator('#followTeams').getByRole('button', { name: '取消关注 曼联', exact: true });
    await remove.focus();
    await remove.press('Enter');
    const remaining = page.locator('#followTeams').getByRole('button', { name: '取消关注 阿森纳', exact: true });
    await expect(remaining).toBeFocused();
    await remaining.press('Enter');
    await expect(page.getByRole('searchbox')).toBeFocused();
    await page.getByRole('button', { name: '完成', exact: true }).click();
    await expect(page.locator('#followToggle')).toBeFocused();
  });
}

async function delayedPreviewFixtures(page: Page, outcome: 'match' | 'empty' | 'failed' = 'match', cold = false) {
  const target = {
    id: 'delayed-preview', league: 'eng.1', start: '2026-10-06T12:00:00Z', status: 'SCHEDULED',
    home: { name: 'Manchester United', teamId: '360' }, away: { name: 'Leeds United', teamId: '357' },
  };
  await fixtures(page, { followed: [{ id: '360', name: 'Manchester United', names: ['manchesterunited'], leagues: ['eng.1'] }], events: [
    { ...target, id: 'current-unrelated', start: '2026-09-30T12:00:00Z', home: { name: 'Liverpool', teamId: '364' } }, target,
  ] });
  // Seed through the shared helper, then change cache freshness before the test's
  // navigation reloads the controller. This avoids init-script ordering races.
  await page.goto('./');
  await expect(page.locator('#list .match')).toHaveCount(1);
  await page.evaluate((cold) => {
    const key = 'fs1|m|eng.1|202610';
    if (cold) {
      // The preview remains in the earlier cached month; the destination has no data.
      localStorage.removeItem(key);
      localStorage.removeItem('fs1|m|esp.1|202610');
      return;
    }
    const cache = JSON.parse(localStorage.getItem(key)!);
    cache.fetchedAt = Date.parse('2026-09-01T12:00:00+08:00');
    cache.events = cache.events.filter((event: { id: string }) => event.id === 'delayed-preview');
    localStorage.setItem(key, JSON.stringify(cache));
  }, cold);
  let release!: () => void;
  let received!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const requested = new Promise<void>((resolve) => { received = resolve; });
  await page.route('https://site.api.espn.com/**', async (route) => {
    if (!route.request().url().includes('/eng.1/scoreboard?dates=202610')) return route.abort();
    received();
    await gate;
    if (outcome === 'failed') return route.abort();
    return route.fulfill({ json: { events: outcome === 'empty' ? [] : [{ id: target.id, date: target.start,
      status: { type: { name: 'STATUS_SCHEDULED', state: 'pre' } },
      competitions: [{ competitors: [
        { homeAway: 'home', team: { id: target.home.teamId, displayName: target.home.name } },
        { homeAway: 'away', team: { id: target.away.teamId, displayName: target.away.name } },
      ] }],
    }] } });
  });
  return { release, requested };
}

for (const outcome of ['match', 'empty', 'failed'] as const) {
  test(`follow preview waits for refreshing data and reveals the ${outcome} result`, async ({ page }) => {
    const pending = await delayedPreviewFixtures(page, outcome);
    try {
      await page.goto('./');
      await expect(page.locator('#list .match')).toHaveCount(1);
      await page.locator('#followToggle').click();
      const preview = page.locator('#followTeams').getByRole('button', { name: /查看当天比赛.*曼联.*2026-10-06/ });
      await preview.focus();
      await preview.press('Enter');
      await pending.requested;
      await expect(page.locator('#followManager')).toBeHidden();
      await expect(page.locator('#updated')).toContainText('更新中');
      const results = page.getByRole('main', { name: '赛程结果', exact: true });
      await expect(results).toBeFocused();
      await expect(results).toBeInViewport();
      const target = page.locator('#list .match[data-match="delayed-preview"][data-league="eng.1"][data-copy="followed"]');
      await expect(target).toHaveCount(1);
      await expect(target).not.toBeFocused();
      pending.release();
      await expect(page.locator('#updated')).not.toContainText('更新中');
      if (outcome === 'match') await expectRevealed(target);
      else if (outcome === 'empty') {
        const empty = page.locator('#list .panel.empty');
        await expect(empty).toContainText('当天暂无所选赛事或关注球队的比赛');
        await expectRevealed(empty);
        await expect(page.locator('#list .match')).toHaveCount(0);
      } else {
        const notice = page.locator('#list .warn');
        await expect(notice).toContainText('比赛时间和比分可能有变动');
        await expectRevealed(notice);
        await expect(target).not.toBeFocused();
      }
    } finally {
      pending.release();
    }
  });
}

test('a cold preview destination keeps named result focus through its skeleton and then focuses the honest fallback', async ({ page }) => {
  const pending = await delayedPreviewFixtures(page, 'empty', true);
  try {
    await page.goto('./');
    await expect(page.locator('#list .match')).toHaveCount(1);
    await page.locator('#followToggle').click();
    const preview = page.locator('#followTeams').getByRole('button', { name: /查看当天比赛.*曼联.*2026-10-06/ });
    await preview.focus();
    await preview.press('Enter');
    await pending.requested;
    await expect(page.locator('#followManager')).toBeHidden();
    await expect(page.locator('#list .skel')).toHaveCount(1);
    const results = page.getByRole('main', { name: '赛程结果', exact: true });
    await expect(results).toBeFocused();
    await expect(results).toBeInViewport();
    await expect(page.locator('#list .match')).toHaveCount(0);
    pending.release();
    await expect(page.locator('#updated')).not.toContainText('更新中');
    const fallback = page.locator('#list .panel').first();
    await expect(fallback).toContainText('暂时无法确认当天是否有比赛');
    await expectRevealed(fallback);
    await expect(page.locator('#list .match[data-match="delayed-preview"]')).toHaveCount(0);
  } finally {
    pending.release();
  }
});

test('reopening the manager during preview loading preserves search focus, text and scroll after delivery settles', async ({ page }) => {
  const pending = await delayedPreviewFixtures(page);
  try {
    await page.goto('./');
    await expect(page.locator('#list .match')).toHaveCount(1);
    await page.locator('#followToggle').click();
    const preview = page.locator('#followTeams').getByRole('button', { name: /查看当天比赛.*曼联.*2026-10-06/ });
    await preview.focus();
    await preview.press('Enter');
    await pending.requested;
    await expect(page.locator('#updated')).toContainText('更新中');
    await expect(page.getByRole('main', { name: '赛程结果', exact: true })).toBeFocused();
    await page.locator('#followToggle').click();
    const search = page.getByRole('searchbox');
    await search.focus();
    await expect(search).toBeFocused();
    await search.fill('ars');
    await expect(page.locator('#followResults')).toContainText('未找到「ars」');
    const scroll = await page.evaluate(() => scrollY);
    pending.release();
    await expect(page.locator('#updated')).not.toContainText('更新中');
    await expect(page.locator('#followManager')).toBeVisible();
    await expect(search).toHaveValue('ars');
    await expect(search).toBeFocused();
    expect(await page.evaluate(() => scrollY)).toBe(scroll);
    await page.clock.runFor(60_000);
    await expect(search).toHaveValue('ars');
    await expect(search).toBeFocused();
    expect(await page.evaluate(() => scrollY)).toBe(scroll);
  } finally {
    pending.release();
  }
});

test('opening filters during preview loading cancels late result focus and scroll', async ({ page }) => {
  const pending = await delayedPreviewFixtures(page);
  try {
    await page.goto('./');
    await page.locator('#followToggle').click();
    await page.locator('#followTeams').getByRole('button', { name: /查看当天比赛.*曼联.*2026-10-06/ }).click();
    await pending.requested;
    await expect(page.getByRole('main', { name: '赛程结果', exact: true })).toBeFocused();
    await page.locator('#filterToggle').click();
    const title = page.getByRole('dialog', { name: '赛事筛选', exact: true }).getByRole('heading');
    await expect(title).toBeFocused();
    const scroll = await page.evaluate(() => scrollY);
    pending.release();
    await expect(page.locator('#updated')).not.toContainText('更新中');
    await expect(title).toBeFocused();
    expect(await page.evaluate(() => scrollY)).toBe(scroll);
    await page.getByRole('button', { name: '完成', exact: true }).click();
    await expect(page.locator('#filterToggle')).toBeFocused();
    await page.clock.runFor(60_000);
    await expect(page.locator('#filterToggle')).toBeFocused();
  } finally {
    pending.release();
  }
});

test('a later date choice cancels preview focus and scroll when its delayed refresh completes', async ({ page }) => {
  const pending = await delayedPreviewFixtures(page);
  try {
    await page.goto('./');
    await expect(page.locator('#list .match')).toHaveCount(1);
    await page.locator('#followToggle').click();
    await page.locator('#followTeams').getByRole('button', { name: /查看当天比赛.*曼联.*2026-10-06/ }).click();
    await pending.requested;
    await expect(page.locator('#updated')).toContainText('更新中');
    const today = page.getByRole('button', { name: '今天', exact: true });
    await today.focus();
    await today.press('Enter');
    await expect(page.locator('#heroDate')).toHaveText('09.30');
    await expect(page.locator('#list .match[data-match="current-unrelated"]')).toHaveCount(1);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    pending.release();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fs1|m|eng.1|202610')!).fetchedAt)).toBeGreaterThanOrEqual(Date.parse('2026-09-30T12:00:00+08:00'));
    await page.clock.runFor(60_000);
    await expect(today).toBeFocused();
    await expect(page.locator('#heroDate')).toHaveText('09.30');
    await expect(page.locator('#list .match[data-match="delayed-preview"]')).toHaveCount(0);
    expect(await page.evaluate(() => scrollY)).toBe(0);
  } finally {
    pending.release();
  }
});

for (const status of ['POSTPONED', 'CANCELLED']) {
  test(`${status} and unavailable follow previews offer no date navigation`, async ({ page }) => {
    await followPreviewFixtures(page, status);
    await page.goto('./');
    await page.locator('#followToggle').click();
    const rows = page.locator('#followTeams');
    await expect(rows.getByRole('button', { name: /查看当天比赛/ })).toHaveCount(0);
    await expect(rows).toContainText('暂未查到赛程');
    if (status === 'POSTPONED') {
      await expect(rows).toContainText('延期');
      await expect(rows).toContainText('时间待定');
      await expect(rows).toContainText('英超');
      await expect(rows).toContainText('利兹联');
      await expect(rows).not.toContainText('00:30');
      await expect(rows).not.toContainText('10/1');
    }
    await expect(page.locator('[data-day="2026-09-30"]')).toHaveAttribute('aria-pressed', 'true');
  });
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
  await page.getByRole('searchbox').focus();
  await expect(page.getByRole('searchbox')).toBeFocused();
  await page.getByRole('searchbox').fill('曼联');
  await page.locator('#followResults').getByRole('button', { name: '关注 曼联', exact: true }).click();
  await expect(page.locator('#list .match')).toHaveCount(1);
  await page.locator('#followTeams').getByRole('button', { name: '取消关注 曼联', exact: true }).click();
  await expect(page.locator('#list')).toContainText('还没有关注球队');
  await expect(page.locator('#list .match')).toHaveCount(0);
  await page.getByRole('button', { name: '完成', exact: true }).click();
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
