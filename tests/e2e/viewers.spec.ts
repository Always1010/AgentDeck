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
const panel = (page: Page) => page.getByRole('tabpanel');
const file = (page: Page, name: string) => page.getByRole('treeitem', { name, exact: true });

test.beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-viewers-'));
  await fs.writeFile(path.join(root, 'report.html'), '<h1>当前报告</h1><input id="draft">');
  await fs.writeFile(path.join(root, 'diagram.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="400"><rect width="1600" height="400" fill="royalblue"/><script>fetch("/svg-must-not-execute")</script></svg>');
  await fs.writeFile(path.join(root, 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhS8AAAAASUVORK5CYII=', 'base64'));
});
test.afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  for (const project of (await json(page, '/api/projects')).projects) await json(page, `/api/projects/${project.id}`, 'DELETE');
  await json(page, '/api/projects', 'POST', { name: '查看器验证', mount: { label: '资料', absolutePath: root } });
  await file(page, '查看器验证').click();
});

test('refresh cancels pending source reads without entering stale source mode', async ({ page }) => {
  await file(page, 'report.html').click();
  await expect(panel(page).frameLocator('iframe').getByRole('heading')).toHaveText('当前报告');
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const received = new Promise<void>(resolve => { started = resolve; });
  await page.route('**/api/mounts/*/file?path=report.html', async route => {
    started(); await waiting;
    await route.fulfill({ json: { text: '<h1>过期源码</h1>', fileVersion: 'old' } }).catch(() => undefined);
  });
  await panel(page).getByRole('button', { name: '查看源码', exact: true }).click();
  await received;
  await panel(page).getByRole('button', { name: '刷新', exact: true }).click();
  release();
  await expect(panel(page).frameLocator('iframe').getByRole('heading')).toHaveText('当前报告');
  await expect(panel(page).getByRole('button', { name: '查看源码', exact: true })).toBeEnabled();
  await expect(panel(page).locator('pre')).toHaveCount(0);
  await expect(panel(page).getByRole('alert')).toHaveCount(0);
});

test('images support fit, original size and zoom; SVG is an image with optional source', async ({ page }) => {
  const scriptRequests: string[] = [];
  page.on('request', request => { if (request.url().includes('svg-must-not-execute')) scriptRequests.push(request.url()); });
  await file(page, 'diagram.svg').click();
  await expect(panel(page).getByRole('img', { name: 'diagram.svg' })).toBeVisible();
  await expect(panel(page).getByText('1600 × 400')).toBeVisible();
  await expect(panel(page).locator('iframe')).toHaveCount(0);
  await panel(page).getByRole('button', { name: '原始尺寸', exact: true }).click();
  await expect(panel(page).getByText('100%', { exact: true })).toBeVisible();
  await panel(page).getByRole('button', { name: '放大图片', exact: true }).click();
  await expect(panel(page).getByText('125%', { exact: true })).toBeVisible();
  await panel(page).getByRole('button', { name: '查看源码', exact: true }).click();
  await expect(panel(page).locator('pre')).toContainText('<svg');
  await panel(page).getByRole('button', { name: '返回阅读', exact: true }).click();
  await expect(panel(page).getByRole('img')).toBeVisible();
  expect(scriptRequests).toEqual([]);
  await file(page, 'pixel.png').click();
  await expect(panel(page).getByText('1 × 1')).toBeVisible();
  await expect(panel(page).getByRole('button', { name: '查看源码', exact: true })).toBeDisabled();
  await expect(panel(page).getByRole('button', { name: '复制原文', exact: true })).toBeDisabled();
});
