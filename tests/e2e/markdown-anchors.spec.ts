import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('outline links find parsed heading anchors and reopen the matching collapsed section', async ({ page }) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-markdown-anchors-'));
  try {
    const file = path.join(root, 'guide.md');
    await fs.writeFile(file, '#### 重复\n\n## 重复\n\n正文\n\n## foo_bar &amp; **bold**\n\n- [x] GFM任务\n\n| Key | Value |\n| --- | --- |\n| one | two |');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/');
    await page.locator('.workspace-header').getByRole('button', { name: '打开本机文件', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '打开本机文件', exact: true });
    await dialog.getByLabel('文件路径').fill(file);
    await dialog.getByRole('button', { name: '打开', exact: true }).click();
    const article = page.getByRole('tabpanel').locator('.markdown');
    await expect(article.locator('h2')).toHaveCount(2);
    await expect(article.getByRole('table')).toBeVisible();
    const ids = await article.locator('h4, h2').evaluateAll(elements => elements.map(element => element.id));
    expect(ids[1]).toBe(ids[0] + '-2');
    expect(ids[2]).toMatch(/foo_bar-bold$/);
    await article.evaluate(element => {
      Element.prototype.scrollIntoView = function () { element.setAttribute('data-last-target', this.id); };
      element.querySelectorAll('details').forEach(details => { details.open = false; });
    });
    const toc = page.getByRole('navigation', { name: '标题目录' });
    await toc.getByRole('button', { name: '重复', exact: true }).click();
    await expect(article).toHaveAttribute('data-last-target', ids[1]);
    await expect(article.locator('h2').filter({ hasText: '重复' }).locator('xpath=ancestor::details')).toHaveAttribute('open', '');
    await toc.getByRole('button', { name: 'foo_bar & bold', exact: true }).click();
    await expect(article).toHaveAttribute('data-last-target', ids[2]);
    await expect(article.getByRole('table')).toBeVisible();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
