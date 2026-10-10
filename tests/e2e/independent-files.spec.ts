import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

let root: string;
async function json(page: Page, url: string, method = 'GET', body?: unknown) {
  return page.evaluate(async ({ url, method, body }) => {
    const response = await fetch(url, { method, headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Workbench': '1' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }, { url, method, body });
}
async function openFile(page: Page, file: string) {
  await page.locator('.workspace-header').getByRole('button', { name: '打开本机文件', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '打开本机文件', exact: true });
  await dialog.getByLabel('文件路径', { exact: true }).fill(file);
  await dialog.getByRole('button', { name: '打开', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
test.beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-local-ui-'));
  await fs.writeFile(path.join(root, 'notes.md'), '# 独立笔记\n\n![本地图片](./image.svg)\n\n[下一篇](./next.md)\n\n[越界](../outside.md)');
  await fs.writeFile(path.join(root, 'next.md'), '# 下一篇笔记');
  await fs.writeFile(path.join(root, 'image.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>');
  await fs.writeFile(path.join(root, 'tool.html'), '<input id="draft"><p>独立 HTML</p>');
  await fs.writeFile(path.join(root, 'data.csv'), 'name,value\napple,12');
  await fs.writeFile(path.join(root, 'archive.zip'), Buffer.from([0, 1, 2]));
  await fs.writeFile(path.join(root, 'plain.txt'), '独立文本');
  await fs.writeFile(path.join(root, 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhS8AAAAASUVORK5CYII=', 'base64'));
});

test('reselecting an image exits source mode for HTML, SVG and plain text references', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const name of ['tool.html', 'image.svg', 'plain.txt']) {
    await openFile(page, path.join(root, name));
    const viewer = page.getByRole('tabpanel');
    await viewer.getByRole('button', { name: '查看源码', exact: true }).click();
    await expect(viewer.getByRole('button', { name: '返回阅读', exact: true })).toBeEnabled();
    await expect(viewer.locator('pre')).toBeVisible();
    const id = new URL(page.url()).searchParams.get('entry');
    await viewer.getByRole('button', { name: '更多设置', exact: true }).click();
    await page.getByRole('button', { name: '重新选择文件', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '重新选择文件', exact: true });
    const target = path.join(root, `pixel-${name}.png`);
    await fs.copyFile(path.join(root, 'pixel.png'), target);
    await dialog.getByLabel('文件路径').fill(target);
    await dialog.getByRole('button', { name: '保存路径', exact: true }).click();
    await expect(viewer.getByRole('img')).toBeVisible();
    await expect(viewer.getByText('1 × 1')).toBeVisible();
    await expect(viewer.locator('pre')).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: '查看源码', exact: true })).toBeDisabled();
    expect(new URL(page.url()).searchParams.get('entry')).toBe(id);
    await page.getByRole('tablist').getByRole('button', { name: /^关闭页面：/ }).click();
  }
});
test.afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('local-file-test-initialized')) {
      localStorage.setItem('html.opening', JSON.stringify('browser')); localStorage.setItem('favorites', '[]');
      localStorage.setItem('local-file-test-initialized', 'true');
    }
  });
  await page.goto(`/?ws=${randomUUID()}`);
  for (const tool of await json(page, '/api/tools')) await json(page, `/api/tools/${encodeURIComponent(tool.id)}`, 'DELETE');
  const snapshot = await json(page, '/api/projects');
  for (const project of snapshot.projects) await json(page, `/api/projects/${project.id}`, 'DELETE');
});

test('standalone Markdown supports relative assets, retained tabs, favorites and scene recovery', async ({ page }) => {
  await page.locator('.empty').getByRole('button', { name: '打开本机文件', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '打开本机文件', exact: true });
  await dialog.getByLabel('文件路径').fill(`"${path.join(root, 'notes.md')}"`);
  await dialog.getByRole('button', { name: '打开', exact: true }).click();
  await expect(page.locator('.markdown h1:visible')).toHaveText('独立笔记');
  await expect.poll(() => page.locator('.markdown img:visible').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(20);
  await expect(page.getByText('越界', { exact: true })).not.toHaveAttribute('href', /outside/);
  await expect(page.locator('.page-tab.temporary')).toHaveCount(0);
  await page.getByRole('button', { name: '收藏文件', exact: true }).click();
  await page.getByRole('link', { name: '下一篇', exact: true }).click();
  await expect(page.locator('.markdown h1:visible')).toHaveText('下一篇笔记');
  await expect(page.getByRole('tab')).toHaveCount(2);
  await openFile(page, path.join(root, 'notes.md')); await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.locator('.markdown h1:visible')).toHaveText('独立笔记');
  await page.reload(); await expect(page.locator('.markdown h1:visible')).toHaveText('独立笔记');
  await page.getByRole('button', { name: '收藏', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: 'notes.md', exact: true })).toBeVisible();
  const snapshot = await json(page, '/api/projects'); expect(snapshot.projects).toEqual([]); expect(snapshot.mounts).toEqual([]);
});

test('file picker opens data and download files; HTML stays in the workbench and converts without refreshing input', async ({ page }) => {
  await page.locator('.workspace-header').getByRole('button', { name: '打开本机文件', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '打开本机文件', exact: true });
  await dialog.getByRole('button', { name: '浏览本机文件' }).click();
  const picker = page.getByRole('dialog', { name: '选择本机文件', exact: true });
  await picker.getByLabel('当前位置').fill(root); await picker.getByRole('button', { name: '前往此路径' }).click();
  await expect(picker.getByRole('button', { name: '选择文件：notes.md', exact: true })).toBeVisible();
  await picker.getByRole('button', { name: '选择文件：data.csv', exact: true }).click();
  await picker.getByRole('button', { name: '选择文件', exact: true }).click();
  await dialog.getByRole('button', { name: '打开', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'apple', exact: true })).toBeVisible();
  await openFile(page, path.join(root, 'archive.zip'));
  await expect(page.getByRole('tabpanel').locator('.empty')).toContainText('暂不支持');
  await expect(page.getByRole('link', { name: '下载原文件', exact: true })).toBeVisible();
  const popups: Page[] = []; page.on('popup', popup => popups.push(popup));
  await openFile(page, path.join(root, 'tool.html'));
  await expect(page.frameLocator('iframe:visible').locator('p')).toHaveText('独立 HTML'); expect(popups).toHaveLength(0);
  const input = page.frameLocator('iframe:visible').locator('#draft'); await input.fill('保留输入');
  await page.getByRole('button', { name: '更多设置' }).click(); await page.getByRole('button', { name: '添加到工具', exact: true }).click();
  await expect(input).toHaveValue('保留输入');
  const id = new URL(page.url()).searchParams.get('entry');
  await expect.poll(async () => (await json(page, '/api/tools')).some((item: { id: string }) => item.id === id)).toBe(true);
  const before = (await json(page, '/api/projects')).fileSources.length;
  await openFile(page, path.join(root, 'tool.html')); await expect(input).toHaveValue('保留输入');
  expect((await json(page, '/api/projects')).fileSources.length).toBe(before);
  await page.getByRole('button', { name: '分屏打开', exact: true }).click();
  await expect(page.locator('.reading-pane')).toHaveCount(2); await expect(page.locator('iframe:visible')).toHaveCount(2);
});

test('missing files can be reselected with the same reference and the open dialog fits narrow dark layouts', async ({ page }) => {
  const file = path.join(root, 'move-me.md'), moved = path.join(root, 'moved.md');
  await fs.writeFile(file, '# 移动前'); await openFile(page, file);
  await expect(page.locator('.markdown h1')).toHaveText('移动前');
  await page.getByRole('button', { name: '收藏文件', exact: true }).click();
  const id = new URL(page.url()).searchParams.get('entry');
  await fs.rename(file, moved); await page.reload();
  await expect(page.getByRole('tabpanel').getByRole('alert')).toContainText('不存在');
  await page.getByRole('tabpanel').getByRole('button', { name: '重新选择文件', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '重新选择文件', exact: true });
  await dialog.getByLabel('文件路径').fill(moved); await dialog.getByRole('button', { name: '保存路径' }).click();
  await expect(page.locator('.markdown h1')).toHaveText('移动前');
  expect(new URL(page.url()).searchParams.get('entry')).toBe(id);
  await expect(page.getByRole('button', { name: '取消收藏文件', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'dark' });
  await page.locator('.workspace-header').getByRole('button', { name: '打开本机文件', exact: true }).scrollIntoViewIfNeeded();
  await page.locator('.workspace-header').getByRole('button', { name: '打开本机文件', exact: true }).click();
  const openDialog = page.getByRole('dialog', { name: '打开本机文件', exact: true });
  await expect(openDialog).toBeVisible(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const box = await openDialog.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/local-file-narrow-dark.png' });
  await page.keyboard.press('Escape'); await expect(openDialog).toHaveCount(0);
});
