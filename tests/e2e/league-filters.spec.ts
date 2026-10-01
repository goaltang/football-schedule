import { test, expect, type Page } from '@playwright/test';
import { LEAGUES } from '../../config.js';
import { fixtures } from './fixtures';

async function openFilters(page: Page) {
  const toggle = page.getByRole('button', { name: /赛事筛选/ });
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  await expect(page.locator('#chips')).toBeVisible();
}

test('quick choices show the selected combination and persist after closing and reloading', async ({ page }) => {
  await fixtures(page);
  await page.goto('./');
  await expect(page.locator('.filter-summary')).toHaveText('英超 · 西甲');
  await openFilters(page);
  await page.getByRole('button', { name: '只看国家队', exact: true }).click();
  const national = LEAGUES.filter((league) => league.group === 'national').map((league) => league.id);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fs1.enabled')!))).toEqual(national);
  await expect(page.getByRole('tab', { name: /国家队/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#filterCount')).toHaveText(`已选 ${national.length}`);
  await page.getByRole('button', { name: '只看五大联赛', exact: true }).click();
  await expect(page.getByRole('tab', { name: /俱乐部/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.filter-summary')).toHaveText('五大联赛');
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.locator('#chips')).toBeHidden();
  await expect(page.getByRole('button', { name: /赛事筛选/ })).toBeFocused();
  await page.reload();
  await expect(page.locator('.filter-summary')).toHaveText('五大联赛');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fs1.enabled')!))).toEqual(['eng.1', 'esp.1', 'ger.1', 'ita.1', 'fra.1']);
  await expect(page.locator('#heroDate')).toHaveText('09.30');
});

test('category actions preserve the other category and guard the final competition', async ({ page }) => {
  await fixtures(page);
  await page.goto('./');
  await openFilters(page);
  await page.getByRole('tab', { name: /国家队/ }).click();
  await page.getByRole('button', { name: '世界杯', exact: true }).click();
  await page.getByRole('tab', { name: /俱乐部/ }).click();
  await page.getByRole('button', { name: '全选俱乐部赛事', exact: true }).click();
  await expect(page.getByRole('button', { name: '清除俱乐部赛事', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '清除俱乐部赛事', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fs1.enabled')!))).toEqual(['fifa.world']);
  await expect(page.locator('.filter-summary')).toHaveText('世界杯');
  await page.getByRole('tab', { name: /国家队/ }).click();
  await expect(page.getByRole('button', { name: '清除国家队赛事', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '世界杯', exact: true })).toBeDisabled();
  await expect(page.locator('#filterHelp')).toContainText('至少保留 1 项');
  await page.getByRole('button', { name: '亚洲杯', exact: true }).click();
  await expect(page.getByRole('button', { name: '世界杯', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '世界杯', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fs1.enabled')!))).toEqual(['afc.asian.cup']);
  await page.reload();
  await openFilters(page);
  await expect(page.getByRole('tab', { name: /国家队/ })).toHaveAttribute('aria-selected', 'true');
});

test('category keyboard navigation changes no preferences and Escape restores focus', async ({ page }) => {
  await fixtures(page);
  await page.goto('./');
  await openFilters(page);
  const clubs = page.getByRole('tab', { name: /俱乐部/ });
  const national = page.getByRole('tab', { name: /国家队/ });
  await clubs.focus();
  await clubs.press('ArrowRight');
  await expect(national).toBeFocused();
  await expect(national).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#nationalFilterPanel')).toBeVisible();
  await expect(page.locator('#clubFilterPanel')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('fs1.enabled'))).toBe('["eng.1","esp.1"]');
  await national.press('Home');
  await expect(clubs).toBeFocused();
  await clubs.press('End');
  await expect(national).toBeFocused();
  await national.press('Escape');
  await expect(page.locator('#chips')).toBeHidden();
  await expect(page.getByRole('button', { name: /赛事筛选/ })).toBeFocused();
});

test('both categories fit narrow and wide screens with usable touch targets', async ({ page }) => {
  await fixtures(page);
  await page.goto('./');
  await openFilters(page);
  for (const width of [320, 390, 640, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of [/俱乐部/, /国家队/]) {
      await page.getByRole('tab', { name }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const targets = await page.locator('#chips button:visible').evaluateAll((buttons) => buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }));
      for (const target of targets) {
        expect(target.width).toBeGreaterThanOrEqual(44);
        expect(target.height).toBeGreaterThanOrEqual(44);
      }
    }
  }
});
