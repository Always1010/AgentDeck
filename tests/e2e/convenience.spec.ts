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
