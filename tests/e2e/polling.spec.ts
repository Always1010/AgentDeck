import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

let root: string;
async function json(page: Page, url: string, method = 'GET', body?: unknown) {
  return page.evaluate(async ({ url, method, body }) => {
    const response = await fetch(url, { method, headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Workbench': '1' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }, { url, method, body });
}
function observeTreeRequests(page: Page) {
  const requests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/tree')) requests.push(request.url()); });
  return requests;
}
async function expectPollingPaused(page: Page, requests: string[]) {
  const count = requests.length;
  await page.waitForTimeout(4300);
  expect(requests).toHaveLength(count);
}

test.beforeEach(async ({ page }) => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-polling-'));
  await fs.mkdir(path.join(root, 'folder'));
  await fs.writeFile(path.join(root, 'report.html'), '<title>Report</title><input id="draft">');
  await fs.writeFile(path.join(root, 'folder', 'note.md'), '# Note');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await json(page, '/api/file-updates/filter', 'PUT', { filter: { mode: 'all', extensions: [], custom: [] } });
  const snapshot = await json(page, '/api/projects');
  for (const project of snapshot.projects) await json(page, `/api/projects/${project.id}`, 'DELETE');
  await json(page, '/api/projects', 'POST', { name: '目录轮询', mount: { label: '文件', absolutePath: root } });
  await page.getByRole('treeitem', { name: '目录轮询', exact: true }).click();
  await page.getByRole('treeitem', { name: 'folder', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: 'note.md', exact: true })).toBeVisible();
});

test.afterEach(async ({ page }) => {
  const snapshot = await json(page, '/api/projects');
  for (const project of snapshot.projects) await json(page, `/api/projects/${project.id}`, 'DELETE');
  await fs.rm(root, { recursive: true, force: true });
});

test('favorites and tools defer hidden directory requests, including registry refresh and scene restoration', async ({ page }) => {
  test.setTimeout(60000);
  const requests = observeTreeRequests(page);
  await expect.poll(() => requests.length, { timeout: 6000 }).toBeGreaterThan(0);
  await page.getByRole('button', { name: '收藏', exact: true }).click();
  const beforeChange = requests.length;
  const snapshot = await json(page, '/api/projects');
  await json(page, `/api/projects/${snapshot.projects[0].id}`, 'PATCH', { name: '目录轮询已改名' });
  await expect(page.locator('.mount-tree .filename').first()).toHaveText('目录轮询已改名');
  expect(requests).toHaveLength(beforeChange);
  await expectPollingPaused(page, requests);

  const beforeReload = requests.length;
  await page.reload();
  await expect(page.getByRole('button', { name: '收藏', exact: true })).toHaveClass('active');
  await expect(page.locator('.mount-tree')).toHaveCount(1);
  expect(requests).toHaveLength(beforeReload);
  await expectPollingPaused(page, requests);
  await page.getByRole('button', { name: '工具', exact: true }).click();
  await expectPollingPaused(page, requests);

  await fs.writeFile(path.join(root, 'folder', 'returned.md'), '# Returned');
  await page.getByRole('button', { name: '文件', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: 'returned.md', exact: true })).toBeVisible({ timeout: 2000 });
  await expect(page.getByRole('treeitem', { name: '目录轮询已改名', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('treeitem', { name: 'folder', exact: true })).toHaveAttribute('aria-expanded', 'true');
});

test('collapsed sidebar, immersion and closed mobile drawer pause polling and preserve the reading scene', async ({ page }) => {
  test.setTimeout(60000);
  await page.getByRole('treeitem', { name: 'report.html', exact: true }).click();
  const draft = page.frameLocator('iframe').locator('#draft');
  await draft.fill('保留输入');
  const requests = observeTreeRequests(page);

  await page.getByRole('button', { name: '收起文件侧栏', exact: true }).click();
  await expect(page.locator('.explorer')).toBeHidden();
  await expectPollingPaused(page, requests);
  await fs.writeFile(path.join(root, 'after-sidebar.md'), '# Sidebar');
  await page.getByRole('button', { name: '展开文件侧栏', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: 'after-sidebar.md', exact: true })).toBeVisible({ timeout: 2000 });

  await page.getByRole('button', { name: '沉浸', exact: true }).click();
  await expect(page.locator('.explorer')).toBeHidden();
  await expectPollingPaused(page, requests);
  await fs.writeFile(path.join(root, 'after-immersion.md'), '# Immersion');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('treeitem', { name: 'after-immersion.md', exact: true })).toBeVisible({ timeout: 2000 });

  await page.setViewportSize({ width: 500, height: 900 });
  await page.getByRole('treeitem', { name: 'report.html', exact: true }).click();
  await expect(page.locator('.explorer')).toBeHidden();
  await expectPollingPaused(page, requests);
  await fs.writeFile(path.join(root, 'after-mobile.md'), '# Mobile');
  await page.getByRole('button', { name: '展开文件侧栏', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: 'after-mobile.md', exact: true })).toBeVisible({ timeout: 2000 });
  await expect(page.getByRole('treeitem', { name: 'folder', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(draft).toHaveValue('保留输入');
});

test('document visibility pauses directory polling and refreshes immediately on return', async ({ page }) => {
  const requests = observeTreeRequests(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expectPollingPaused(page, requests);
  await fs.writeFile(path.join(root, 'folder', 'after-visible.md'), '# Visible');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('treeitem', { name: 'after-visible.md', exact: true })).toBeVisible({ timeout: 2000 });

  await page.getByRole('treeitem', { name: '目录轮询', exact: true }).click();
  await expectPollingPaused(page, requests);
  await page.getByRole('treeitem', { name: '目录轮询', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: 'folder', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('treeitem', { name: 'after-visible.md', exact: true })).toBeVisible();
});
