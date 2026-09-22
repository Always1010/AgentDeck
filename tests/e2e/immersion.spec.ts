import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

let root: string;
const pane = (page: Page, id: number) => page.locator(`[data-pane="${id}"]`);
test.beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-immersion-'));
  await fs.writeFile(path.join(root, 'report.html'), '<title>Report</title><input id="draft"><div style="height:3000px">Report</div>');
  await fs.writeFile(path.join(root, 'note.md'), '# Note\n\n' + 'reading\n\n'.repeat(200));
});
test.afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.evaluate(async root => {
    const request = (url: string, method = 'GET', body?: unknown) => fetch(url, { method, headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Workbench': '1' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) }).then(async response => {
      if (!response.ok) throw new Error(await response.text()); return response.json();
    });
    const snapshot = await request('/api/projects');
    for (const project of snapshot.projects) await request(`/api/projects/${project.id}`, 'DELETE');
    await request('/api/projects', 'POST', { name: '沉浸验证', mount: { label: '文件', absolutePath: root } });
  }, root);
  await page.getByRole('treeitem', { name: '沉浸验证', exact: true }).click();
});

test('F shows only the active HTML content and restores live split panes without reloading', async ({ page }) => {
  await page.getByRole('treeitem', { name: 'report.html', exact: true }).dblclick();
  await pane(page, 0).frameLocator('iframe').locator('#draft').fill('左侧输入');
  await page.getByRole('button', { name: '左右分屏', exact: true }).click();
  const right = pane(page, 1);
  await right.frameLocator('iframe').locator('#draft').fill('右侧输入');
  const original = page.frames().find(frame => frame.url().endsWith('/report.html'))!;
  await original.evaluate(() => { (window as unknown as { token: string }).token = 'alive'; });
  await right.getByRole('tab').click();
  await page.keyboard.press('f');
  await expect(page.locator('.shell')).toHaveClass(/immersive/);
  await expect(pane(page, 0)).toBeHidden();
  await expect(right).toBeVisible();
  for (const selector of ['.workspace-header', '.explorer', '.catalog-resizer', '.pane-navigation', '.page-tabs', '.toolbar', '.bridge-state', '.reading-resizer']) {
    await expect(page.locator(selector).first()).toBeHidden();
  }
  const box = await right.boundingBox();
  expect(box).toMatchObject({ x: 0, y: 0, width: 1440, height: 900 });
  await page.screenshot({ path: 'test-results/immersion-current-file.png' });
  await expect(page.getByRole('button', { name: '退出沉浸' })).toBeFocused();
  await expect(right.frameLocator('iframe').locator('#draft')).toHaveValue('右侧输入');
  expect(await original.evaluate(() => (window as unknown as { token: string }).token)).toBe('alive');
  await page.keyboard.press('Escape');
  await expect(page.locator('.shell')).not.toHaveClass(/immersive/);
  await expect(pane(page, 0).frameLocator('iframe').locator('#draft')).toHaveValue('左侧输入');
  await expect(right.frameLocator('iframe').locator('#draft')).toHaveValue('右侧输入');
  await expect(page.locator('.reading-resizer')).toBeVisible();
  await right.getByRole('tab').click();
  await page.keyboard.press('f');
  await page.reload();
  await expect(page.locator('.shell')).toHaveClass(/immersive/);
  await expect(pane(page, 0)).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(pane(page, 0)).toBeVisible();
  await expect(right).toBeVisible();
});

test('F overlays ordinary maximization and restores the prior sidebar and layout state', async ({ page }) => {
  await page.getByRole('treeitem', { name: 'note.md', exact: true }).dblclick();
  await page.getByRole('button', { name: '上下分屏', exact: true }).click();
  await pane(page, 1).getByRole('tab').click();
  await page.keyboard.press('x');
  await expect(pane(page, 0)).toBeHidden();
  await page.keyboard.press('b');
  await expect(page.locator('.explorer')).toBeHidden();
  await page.keyboard.press('f');
  await expect(pane(page, 0)).toBeHidden();
  await expect(page.locator('.workspace-header')).toBeHidden();
  await expect(page.locator('.markdown h1').last()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.shell')).not.toHaveClass(/immersive/);
  await expect(pane(page, 0)).toBeHidden();
  await expect(page.locator('.explorer')).toBeHidden();
  await expect(page.getByRole('button', { name: '恢复分屏' })).toBeVisible();
  await pane(page, 1).getByRole('tab').click();
  await page.keyboard.press('f');
  await page.locator('.immersion-exit-zone').hover();
  await page.getByRole('button', { name: '退出沉浸' }).click();
  await expect(pane(page, 0)).toBeHidden();
  await page.keyboard.press('x');
  await expect(pane(page, 0)).toBeVisible();
  await expect(page.locator('.explorer')).toBeHidden();
});


test('X leaves immersion in ordinary maximization and search exposes the file list', async ({ page }) => {
  await page.getByRole('treeitem', { name: 'note.md', exact: true }).dblclick();
  await page.getByRole('button', { name: '左右分屏', exact: true }).click();
  await pane(page, 1).getByRole('tab').click();
  await page.keyboard.press('f');
  await page.keyboard.press('x');
  await expect(page.locator('.shell')).not.toHaveClass(/immersive/);
  await expect(pane(page, 0)).toBeHidden();
  await expect(page.getByRole('button', { name: '恢复分屏' })).toBeVisible();
  await pane(page, 1).getByRole('tab').click();
  await page.keyboard.press('f');
  await page.keyboard.press('/');
  await expect(page.locator('.shell')).not.toHaveClass(/immersive/);
  await expect(page.getByLabel('筛选文件', { exact: true })).toBeFocused();
  await expect(page.locator('.explorer')).toBeVisible();
  await page.keyboard.press('Escape');
  await pane(page, 1).getByRole('tab').click();
  await page.keyboard.press('f');
  await page.keyboard.press('o');
  await expect(page.locator('.shell')).not.toHaveClass(/immersive/);
  await expect(page.locator('.reading-pane')).toHaveCount(3);
  await expect(pane(page, 2).getByRole('tab')).toHaveText('note.md');
});


test('entering immersion dismisses a viewer menu rendered outside the workbench', async ({ page }) => {
  await page.getByRole('treeitem', { name: 'report.html', exact: true }).dblclick();
  await pane(page, 0).getByRole('button', { name: '更多设置' }).click();
  await expect(page.locator('[data-viewer-settings]')).toBeVisible();
  await page.keyboard.press('f');
  await expect(page.locator('.shell')).toHaveClass(/immersive/);
  await expect(page.locator('[data-viewer-settings]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-viewer-settings]')).toHaveCount(0);
});
