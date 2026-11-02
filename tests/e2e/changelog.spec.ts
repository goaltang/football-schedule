import { test, expect } from '@playwright/test';
import { fixtures } from './fixtures';

test('changelog opens from the footer, clears its unread dot and remembers it', async ({ page }, testInfo) => {
  await fixtures(page);
  await page.goto('./');
  const toggle = page.locator('#changelogToggle');
  await expect(toggle).toHaveAttribute('aria-label', '更新日志，有新内容');
  await expect(toggle.locator('.changelog-dot')).toHaveCount(1);
  await toggle.click();
  const dialog = page.getByRole('dialog', { name: '更新日志', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog.getByRole('heading', { name: '更新日志', exact: true })).toBeFocused();
  await expect(dialog.locator('.changelog-item').first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('changelog.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(toggle.locator('.changelog-dot')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#changelogToggle')).toHaveAttribute('aria-label', '更新日志');
});

test('changelog still opens when storage is full', async ({ page }) => {
  await fixtures(page);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'fs1.changelogSeen') throw new DOMException('full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.goto('./');
  await page.locator('#changelogToggle').click();
  await expect(page.getByRole('dialog', { name: '更新日志', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#changelogToggle .changelog-dot')).toHaveCount(0);
});
