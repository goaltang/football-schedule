import { test, expect } from '@playwright/test';
import { fixtures } from './fixtures';

test('panels start closed, preserve the schedule layout and adapt to the screen', async ({ page }, testInfo) => {
  await fixtures(page, { followed: ['manchesterunited'] });
  await page.goto('./');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#filterToggle')).toHaveAttribute('aria-expanded', 'false');
  const scheduleTop = await page.locator('#list').evaluate((element) => element.getBoundingClientRect().top);
  await page.screenshot({ path: testInfo.outputPath('schedule.png'), fullPage: true, animations: 'disabled' });
  const viewport = page.viewportSize()!;

  for (const [button, title] of [['#filterToggle', '赛事筛选'], ['#followToggle', '我的关注']]) {
    await page.locator(button).click();
    const dialog = page.getByRole('dialog', { name: title, exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect.poll(() => dialog.locator('.panel-surface').evaluate((element) => element.getAnimations().length)).toBe(0);
    expect(await page.locator('#list').evaluate((element) => element.getBoundingClientRect().top)).toBe(scheduleTop);
    const surface = await dialog.locator('.panel-surface').boundingBox();
    expect(surface).not.toBeNull();
    if (testInfo.project.name === 'mobile') {
      await expect(dialog.getByRole('heading', { name: title, exact: true })).toBeFocused();
      expect(surface!.x).toBe(0);
      expect(surface!.width).toBe(viewport.width);
      expect(surface!.y + surface!.height).toBeCloseTo(viewport.height, 0);
    } else if (title === '赛事筛选') {
      expect(surface!.x + surface!.width / 2).toBeCloseTo(viewport.width / 2, 0);
      expect(surface!.y + surface!.height / 2).toBeCloseTo(viewport.height / 2, 0);
    } else {
      await expect(page.getByRole('searchbox')).toBeFocused();
      expect(surface!.x + surface!.width).toBeCloseTo(viewport.width, 0);
      expect(surface!.height).toBe(viewport.height);
    }
    await page.screenshot({ path: testInfo.outputPath(title === '赛事筛选' ? 'filters.png' : 'following.png'), animations: 'disabled' });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.screenshot({ path: testInfo.outputPath(title === '赛事筛选' ? 'filters-dark.png' : 'following-dark.png'), animations: 'disabled' });
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
    await dialog.getByRole('button', { name: '完成', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(button)).toBeFocused();
    await expect(page.locator('body')).not.toHaveCSS('position', 'fixed');
  }
});

test('keyboard focus stays in the dialog and Escape returns to its opener', async ({ page }) => {
  await fixtures(page);
  await page.goto('./');
  await page.locator('#filterToggle').click();
  const dialog = page.getByRole('dialog', { name: '赛事筛选', exact: true });
  const close = dialog.getByRole('button', { name: '关闭赛事筛选', exact: true });
  const done = dialog.getByRole('button', { name: '完成', exact: true });
  await done.focus();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(done).toBeFocused();
  await page.keyboard.press('t');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#heroDate')).toHaveText('09.30');
  await page.locator('#goToday').evaluate((button: HTMLButtonElement) => button.focus());
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#filterToggle')).toBeFocused();
  await page.locator('#followToggle').click();
  await page.getByRole('searchbox').fill('曼联');
  await page.getByRole('searchbox').evaluate((input) => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true })));
  await expect(page.getByRole('dialog', { name: '我的关注', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#followToggle')).toBeFocused();
});

test('backdrop dismisses the panel while dragging out of its content keeps it open', async ({ page }) => {
  await fixtures(page);
  await page.goto('./');
  await page.locator('#filterToggle').click();
  const dialog = page.getByRole('dialog', { name: '赛事筛选', exact: true });
  const heading = await dialog.getByRole('heading').boundingBox();
  await page.mouse.move(heading!.x + 8, heading!.y + 8);
  await page.mouse.down();
  await page.mouse.move(4, 4);
  await page.mouse.up();
  await expect(dialog).toBeVisible();
  await page.mouse.click(4, 4);
  await expect(dialog).toBeHidden();
  await expect(page.locator('#filterToggle')).toBeFocused();
  await page.locator('#followToggle').click();
  await page.getByRole('button', { name: '关闭我的关注', exact: true }).click();
  await expect(page.locator('#followToggle')).toBeFocused();
});

test('a long team list scrolls inside the panel and closing restores the page position', async ({ page }) => {
  const followed = Array.from({ length: 30 }, (_, index) => ({ id: String(index + 10000), name: `Team ${index}`,
    names: [`team${index}`], leagues: ['eng.1'] }));
  const events = Array.from({ length: 20 }, (_, index) => ({ id: `long-${index}`, league: 'eng.1',
    start: '2026-09-30T20:00:00+08:00', status: 'SCHEDULED', home: { name: 'Manchester United', teamId: '360' }, away: { name: 'Arsenal', teamId: '359' } }));
  await fixtures(page, { followed, events });
  await page.goto('./');
  await expect(page.locator('#list .match')).toHaveCount(20);
  await page.evaluate(() => window.scrollTo(0, 100));
  const scroll = await page.evaluate(() => scrollY);
  const scheduleTop = await page.locator('#list').evaluate((element) => element.getBoundingClientRect().top);
  await page.locator('#followToggle').click();
  const dialog = page.getByRole('dialog', { name: '我的关注', exact: true });
  await expect(page.locator('body')).toHaveCSS('position', 'fixed');
  expect(await page.locator('#list').evaluate((element) => element.getBoundingClientRect().top)).toBe(scheduleTop);
  const content = dialog.locator('.panel-body');
  expect(await content.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await content.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(dialog.getByRole('button', { name: '取消关注 Team 29', exact: true })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: '关闭我的关注', exact: true })).toBeInViewport();
  const done = dialog.getByRole('button', { name: '完成', exact: true });
  await expect(done).toBeInViewport();
  await done.click();
  expect(await page.evaluate(() => scrollY)).toBe(scroll);
  await expect(page.locator('#followToggle')).toBeFocused();
});

test('filters remain usable on a short narrow viewport with the footer always visible', async ({ page }) => {
  await fixtures(page);
  await page.setViewportSize({ width: 320, height: 420 });
  await page.goto('./');
  await page.locator('#filterToggle').click();
  const dialog = page.getByRole('dialog', { name: '赛事筛选', exact: true });
  await dialog.getByRole('tab', { name: /国家队/ }).click();
  expect(await dialog.locator('.panel-body').evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await dialog.getByRole('button', { name: '美洲杯', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fs1.enabled')!))).toContain('conmebol.america');
  await expect(dialog.getByRole('button', { name: '关闭赛事筛选', exact: true })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: '完成', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole('button', { name: '完成', exact: true }).click();
  await page.locator('#followToggle').click();
  await page.getByRole('searchbox').fill('曼联');
  await page.locator('#followResults').getByRole('button', { name: '关注 曼联', exact: true }).click();
  await expect(page.locator('#followTeams')).toContainText('曼联');
  await expect(page.getByRole('button', { name: '完成', exact: true })).toBeInViewport();
});

test('closing from the empty-schedule entry restores a connected opener', async ({ page }) => {
  await fixtures(page);
  await page.goto('./');
  await page.locator('#onlyFollowed').click();
  const add = page.getByRole('button', { name: '添加关注球队', exact: true });
  await add.click();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(add).toBeFocused();
  await add.click();
  await page.getByRole('searchbox').fill('曼联');
  await page.locator('#followResults').getByRole('button', { name: '关注 曼联', exact: true }).click();
  await expect(add).toHaveCount(0);
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.locator('#followToggle')).toBeFocused();
});
