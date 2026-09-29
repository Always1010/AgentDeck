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
test.beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-resources-viewer-'));
  await fs.writeFile(path.join(root, 'report.html'), '<link rel="stylesheet" href="style.css"><h1>资源提示</h1><input id="draft">');
  await fs.writeFile(path.join(root, 'style.css'), 'h1 { color: blue; }');
});
test.afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

test('optional resource checks notify without reloading or losing HTML input', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  for (const project of (await json(page, '/api/projects')).projects) await json(page, `/api/projects/${project.id}`, 'DELETE');
  await json(page, '/api/projects', 'POST', { name: '资源变化', mount: { label: '报告', absolutePath: root } });
  await page.getByRole('treeitem', { name: '资源变化', exact: true }).click();
  const resourceRequests: string[] = [];
  page.on('request', request => { if (request.url().includes('/resource-version?')) resourceRequests.push(request.url()); });
  await page.getByRole('treeitem', { name: 'report.html', exact: true }).click();
  const panel = page.getByRole('tabpanel');
  await panel.frameLocator('iframe').locator('#draft').fill('资源变化时保留输入');
  expect(resourceRequests).toEqual([]);
  await panel.getByRole('button', { name: '更多设置', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '提示同目录资源变化', exact: true })).not.toBeChecked();
  await Promise.all([
    page.waitForResponse(response => response.url().includes('/resource-version?') && response.ok()),
    // Changing the preference closes this menu, so check() cannot inspect its detached input.
    page.getByRole('checkbox', { name: '提示同目录资源变化', exact: true }).click(),
  ]);
  await panel.getByRole('button', { name: '更多设置', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '提示同目录资源变化', exact: true })).toBeChecked();
  await panel.getByRole('button', { name: '更多设置', exact: true }).click();
  // A completed baseline request precedes the disk change.
  const temporaryResource = path.join(root, 'temporary.css');
  await fs.writeFile(temporaryResource, '/* an unreferenced direct sibling */');
  await expect(panel.getByRole('status')).toContainText('同目录资源有变化', { timeout: 12000 });
  await fs.unlink(temporaryResource);
  await expect(panel.getByText('同目录资源有变化', { exact: false })).toHaveCount(0, { timeout: 12000 });
  await expect(panel.frameLocator('iframe').locator('#draft')).toHaveValue('资源变化时保留输入');
  await fs.writeFile(path.join(root, 'style.css'), 'h1 { color: red; font-weight: 500; }');
  await expect(panel.getByRole('status')).toContainText('同目录资源有变化', { timeout: 12000 });
  await expect(panel.frameLocator('iframe').locator('#draft')).toHaveValue('资源变化时保留输入');
  await expect(panel.frameLocator('iframe').getByRole('heading')).toHaveCSS('color', 'rgb(0, 0, 255)');
  await panel.getByRole('button', { name: '重新加载页面', exact: true }).click();
  await expect(panel.frameLocator('iframe').getByRole('heading')).toHaveCSS('color', 'rgb(255, 0, 0)');
  await expect(panel.frameLocator('iframe').locator('#draft')).toHaveValue('');
  await expect(panel.getByText('同目录资源有变化', { exact: false })).toHaveCount(0);
});
