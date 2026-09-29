import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

let root: string;
async function json(page: Page, url: string, method = 'GET', body?: unknown) {
  return page.evaluate(async ({ url, method, body }) => {
    const response = await fetch(url, { method, headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Workbench': '1' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }, { url, method, body });
}
test.beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-lazy-viewers-'));
  for (const name of ['a', 'b', 'c']) await fs.writeFile(path.join(root, `${name}.html`), `<h1>${name}</h1><input id="draft">`);
});
test.afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

test('restored background tabs first load on activation and retain inputs afterward', async ({ page }) => {
  await page.goto('/');
  for (const project of (await json(page, '/api/projects')).projects) await json(page, `/api/projects/${project.id}`, 'DELETE');
  await json(page, '/api/projects', 'POST', { name: '延迟加载', mount: { label: '报告', absolutePath: root } });
  await page.getByRole('treeitem', { name: '延迟加载', exact: true }).click();
  for (const name of ['a', 'b', 'c']) {
    await page.getByRole('treeitem', { name: `${name}.html`, exact: true }).dblclick();
    await expect(page.getByRole('tabpanel').frameLocator('iframe').getByRole('heading')).toHaveText(name);
  }
  const entries: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/entries/')) entries.push(decodeURIComponent(request.url())); });
  await page.reload();
  await expect(page.getByRole('tab')).toHaveCount(3);
  await expect(page.getByRole('tabpanel').frameLocator('iframe').getByRole('heading')).toHaveText('c');
  expect(entries.some(url => url.endsWith(':a.html') || url.endsWith(':b.html'))).toBe(false);
  await expect(page.locator('.viewer iframe')).toHaveCount(1);
  await page.getByRole('tabpanel').frameLocator('iframe').locator('#draft').fill('保留 C 输入');
  await page.getByRole('tab', { name: 'a.html', exact: true }).click();
  await expect(page.getByRole('tabpanel').frameLocator('iframe').getByRole('heading')).toHaveText('a');
  await page.getByRole('tabpanel').frameLocator('iframe').locator('#draft').fill('保留 A 输入');
  await expect(page.locator('.viewer iframe')).toHaveCount(2);
  await page.getByRole('tab', { name: 'c.html', exact: true }).click();
  await expect(page.getByRole('tabpanel').frameLocator('iframe').locator('#draft')).toHaveValue('保留 C 输入');
  await page.getByRole('tab', { name: 'a.html', exact: true }).click();
  await expect(page.getByRole('tabpanel').frameLocator('iframe').locator('#draft')).toHaveValue('保留 A 输入');
  expect(entries.some(url => url.endsWith(':b.html'))).toBe(false);
});

test('development StrictMode restarts a cancelled first load', async ({ page }) => {
  const state = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-viewers-dev-'));
  const child = spawn(process.execPath, ['--import', 'tsx', 'app/server/main.ts', '--dev', '--state-dir', state, '--port', '4430', '--preview-port', '4431'], { windowsHide: true, stdio: 'pipe' });
  try {
    await expect.poll(async () => { try { return (await fetch('http://127.0.0.1:4430/')).status; } catch { return 0; } }, { timeout: 15000 }).toBe(200);
    await page.goto('http://127.0.0.1:4430/');
    await json(page, '/api/projects', 'POST', { name: '开发查看器', mount: { label: '报告', absolutePath: root } });
    await page.getByRole('treeitem', { name: '开发查看器', exact: true }).click();
    await page.getByRole('treeitem', { name: 'a.html', exact: true }).click();
    await expect(page.getByRole('tabpanel').frameLocator('iframe').getByRole('heading')).toHaveText('a');
    await expect(page.getByRole('tabpanel').getByRole('alert')).toHaveCount(0);
  } finally {
    if (child.exitCode === null) { const exited = new Promise<void>(resolve => child.once('exit', () => resolve())); child.kill(); await exited; }
    await fs.rm(state, { recursive: true, force: true });
  }
});
