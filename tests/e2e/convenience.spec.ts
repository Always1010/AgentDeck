import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let root: string;
async function json(page: Page, url: string, method = 'GET', body?: unknown) {
  return page.evaluate(async ({ url, method, body }) => {
    const response = await fetch(url, { method, headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Workbench': '1' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }, { url, method, body });
}
test.beforeEach(async ({ page }) => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-convenience-'));
  await fs.writeFile(path.join(root, 'reading.md'), '# 阅读\n\n' + '长篇内容，用于恢复位置。\n\n'.repeat(200));
  await fs.writeFile(path.join(root, 'tool.html'), '<input id="draft"><p>小工具</p>');
  await fs.mkdir(path.join(root, 'nested'));
  await fs.writeFile(path.join(root, 'nested', 'detail.md'), '# 深层文档');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const previous = await json(page, '/api/projects');
  for (const project of previous.projects) await json(page, `/api/projects/${project.id}`, 'DELETE');
  await json(page, '/api/file-updates/filter', 'PUT', { filter: { mode: 'all', extensions: [], custom: [] } });
  await json(page, '/api/projects', 'POST', { name: '便捷阅读', mount: { label: '文件', absolutePath: root } });
  await page.getByRole('treeitem', { name: '便捷阅读', exact: true }).click();
});
test.afterEach(async ({ page }) => {
  const snapshot = await json(page, '/api/projects');
  for (const project of snapshot.projects) await json(page, `/api/projects/${project.id}`, 'DELETE');
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('agentdeck-convenience-')) throw new Error('Unexpected fixture path');
  await fs.rm(root, { recursive: true, force: true });
});

test('reopens a closed document with its position and keeps another tool alive', async ({ page }) => {
  await page.getByRole('treeitem', { name: 'tool.html', exact: true }).dblclick();
  await page.frameLocator('iframe').locator('#draft').fill('保留的输入');
  await page.getByRole('treeitem', { name: 'reading.md', exact: true }).dblclick();
  await page.getByRole('tabpanel').locator('.reader').evaluate(element => { element.scrollTop = 650; });
  await expect.poll(() => page.getByRole('tabpanel').locator('.reader').evaluate(element => element.scrollTop)).toBeGreaterThan(600);
  await page.getByRole('tablist').getByRole('button', { name: '关闭页面：reading.md', exact: true }).click();
  await expect(page.frameLocator('iframe').locator('#draft')).toHaveValue('保留的输入');
  await page.getByRole('button', { name: '最近关闭', exact: true }).click();
  await page.getByRole('dialog', { name: '最近关闭的页面' }).getByRole('button', { name: /reading.md/ }).click();
  await expect(page.getByRole('tab', { name: 'reading.md', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => page.getByRole('tabpanel').locator('.reader').evaluate(element => element.scrollTop)).toBeGreaterThan(600);
  await page.getByRole('tab', { name: 'tool.html', exact: true }).click();
  await expect(page.frameLocator('iframe').locator('#draft')).toHaveValue('保留的输入');
});

test('continuous scrolling coalesces storage writes and visibility flush captures the latest position', async ({ page }) => {
  await page.getByRole('treeitem', { name: 'reading.md', exact: true }).click();
  const reader = page.getByRole('tabpanel').locator('.reader');
  await expect(reader).toBeVisible();
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const counters = window as typeof window & { sceneWrites: number };
    counters.sceneWrites = 0;
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (this.transaction.db.name === 'agentdeck-reading-sessions') counters.sceneWrites++;
      return original.apply(this, args);
    };
  });
  await reader.evaluate(async element => {
    for (let step = 1; step <= 60; step++) {
      element.scrollTop = step * 10;
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(150);
  const writes = await page.evaluate(() => (window as typeof window & { sceneWrites: number }).sceneWrites);
  console.log(JSON.stringify({ measurement: 'reading-scroll-writes', animationFrames: 60, writes }));
  expect(writes).toBeLessThanOrEqual(3);
  await page.reload();
  await expect.poll(() => reader.evaluate(element => element.scrollTop)).toBeGreaterThanOrEqual(590);
});

test('reveals a deep favorite without loading unrelated directories and copies its full path', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const snapshot = await json(page, '/api/projects');
  const id = `file:${snapshot.mounts[0].id}:nested/detail.md`;
  await page.evaluate(id => { localStorage.setItem('favorites', JSON.stringify([id])); }, id);
  await page.reload();
  await page.getByRole('button', { name: '收藏', exact: true }).click();
  await page.getByRole('treeitem', { name: 'detail.md', exact: true }).click();
  await page.getByRole('button', { name: '更多设置', exact: true }).click();
  await page.getByRole('button', { name: '复制完整路径', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(path.join(snapshot.mounts[0].absolutePath, 'nested', 'detail.md'));
  const requested: string[] = [];
  page.on('request', request => { const url = new URL(request.url()); if (url.pathname.endsWith('/tree')) requested.push(url.searchParams.get('path') || ''); });
  await page.getByRole('button', { name: '更多设置', exact: true }).click();
  await page.getByRole('button', { name: '在文件树中定位', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: 'detail.md', exact: true })).toBeFocused();
  expect(requested.every(directory => directory === '' || directory === 'nested')).toBe(true);
});

test('quick open searches an explicit unloaded directory and reuses an open tool', async ({ page }) => {
  await page.getByRole('treeitem', { name: 'tool.html', exact: true }).dblclick();
  await page.frameLocator('iframe').locator('#draft').fill('搜索期间保留');
  const snapshot = await json(page, '/api/projects');
  const searches: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/search')) searches.push(request.url()); });
  await page.getByRole('button', { name: '快速打开', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '快速打开', exact: true });
  await dialog.getByRole('searchbox', { name: '查找文件' }).fill('detail');
  expect(searches).toHaveLength(0);
  await dialog.getByRole('combobox', { name: '查找范围' }).selectOption(snapshot.mounts[0].id);
  await dialog.getByRole('textbox', { name: '目录范围' }).fill('nested');
  expect(searches).toHaveLength(0);
  await dialog.getByRole('button', { name: '搜索目录', exact: true }).click();
  await expect(dialog.getByRole('button', { name: /^detail.md/ })).toBeVisible();
  expect(new URL(searches[0]).searchParams.get('path')).toBe('nested');
  await dialog.getByRole('button', { name: /^detail.md/ }).click();
  await expect(page.locator('.viewer:not([hidden]) .markdown h1')).toHaveText('深层文档');
  await page.getByRole('button', { name: '快速打开', exact: true }).click();
  await dialog.getByRole('searchbox', { name: '查找文件' }).fill('tool');
  await dialog.getByRole('button', { name: /^tool.html/ }).click();
  await expect(page.frameLocator('iframe').locator('#draft')).toHaveValue('搜索期间保留');
});

test('cancelled directory search never publishes a late response', async ({ page }) => {
  const snapshot = await json(page, '/api/projects');
  let unblock!: () => void;
  const blocked = new Promise<void>(resolve => { unblock = resolve; });
  let started!: () => void;
  const received = new Promise<void>(resolve => { started = resolve; });
  await page.route('**/api/mounts/*/search?*', async route => {
    const response = await route.fetch(); started(); await blocked;
    await route.fulfill({ response }).catch(() => undefined);
  });
  await page.getByRole('button', { name: '快速打开', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '快速打开', exact: true });
  await dialog.getByRole('combobox', { name: '查找范围' }).selectOption(snapshot.mounts[0].id);
  await dialog.getByRole('searchbox', { name: '查找文件' }).fill('detail');
  await dialog.getByRole('button', { name: '搜索目录', exact: true }).click();
  await received;
  await dialog.getByRole('button', { name: '取消搜索', exact: true }).click();
  unblock();
  await expect(dialog.getByRole('status')).toContainText('已取消搜索');
  await expect(dialog.locator('.quick-open-results li')).toHaveCount(0);
});

test('quick open clears results when the selected mount is removed', async ({ page }) => {
  const snapshot = await json(page, '/api/projects');
  await page.getByRole('button', { name: '快速打开', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '快速打开', exact: true });
  await dialog.getByRole('combobox', { name: '查找范围' }).selectOption(snapshot.mounts[0].id);
  await dialog.getByRole('searchbox', { name: '查找文件' }).fill('detail');
  await dialog.getByRole('button', { name: '搜索目录', exact: true }).click();
  await expect(dialog.getByRole('button', { name: /^detail.md/ })).toBeVisible();
  await json(page, `/api/projects/${snapshot.projects[0].id}`, 'DELETE');
  await expect(dialog.getByRole('combobox', { name: '查找范围' })).toHaveValue('known');
  await expect(dialog.locator('.quick-open-results li')).toHaveCount(0);
});
