import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import type { ReadingSnapshot } from '../../app/web/readingSessions.js';

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
  for (let index = 0; index < 24; index++) await fs.writeFile(path.join(root, `scale-${index}.html`), `<h1>scale-${index}</h1><input id="draft">`);
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

test('a restored 24-tab scene starts one iframe and keeps visited documents alive', async ({ page }) => {
  await page.goto('/');
  for (const project of (await json(page, '/api/projects')).projects) await json(page, `/api/projects/${project.id}`, 'DELETE');
  const project = await json(page, '/api/projects', 'POST', { name: '恢复规模', mount: { label: '报告', absolutePath: root } });
  const mount = (await json(page, '/api/projects')).mounts.find((item: { projectId: string }) => item.projectId === project.id);
  const ids = Array.from({ length: 24 }, (_, index) => `file:${mount.id}:scale-${index}.html`);
  const snapshot: ReadingSnapshot = {
    version: 1,
    workspace: { panes: { 0: { items: ids.map((id, index) => ({ id, kept: true, title: `scale-${index}.html` })), active: ids[23], recent: [...ids].reverse() } }, active: 0,
      histories: { 0: { entries: ids, index: 23 } }, root: { type: 'pane', pane: 0 }, maximized: null, nextPane: 1 },
    view: { immersive: false, collapsed: true, width: 280, openedExpanded: true, view: 'files', query: '' }, positions: {}, expanded: {},
  };
  const scene = crypto.randomUUID();
  await page.evaluate(async record => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('agentdeck-reading-sessions', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('sessions', 'readwrite'); tx.objectStore('sessions').put(record); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    db.close();
  }, { id: scene, updatedAt: Date.now(), activeAt: Date.now(), snapshot });
  const entries: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/entries/')) entries.push(decodeURIComponent(request.url())); });
  await page.goto(`/?ws=${scene}`);
  await expect(page.getByRole('tab')).toHaveCount(24);
  await expect(page.getByRole('tabpanel').frameLocator('iframe').getByRole('heading')).toHaveText('scale-23');
  await expect(page.locator('.viewer iframe')).toHaveCount(1);
  expect(entries.every(url => url.endsWith(':scale-23.html'))).toBe(true);
  await page.getByRole('tabpanel').frameLocator('iframe').locator('#draft').fill('第 24 页输入');
  await page.getByRole('tab', { name: 'scale-0.html', exact: true }).click();
  await expect(page.getByRole('tabpanel').frameLocator('iframe').getByRole('heading')).toHaveText('scale-0');
  await expect(page.locator('.viewer iframe')).toHaveCount(2);
  await page.getByRole('tab', { name: 'scale-23.html', exact: true }).click();
  await expect(page.getByRole('tabpanel').frameLocator('iframe').locator('#draft')).toHaveValue('第 24 页输入');
});
