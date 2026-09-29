import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { PersonalBackup } from '../../app/web/personalBackup.js';
import type { SavedReadingSession } from '../../app/web/readingSessions.js';

let root: string;
const sceneId = (page: Page) => new URL(page.url()).searchParams.get('ws')!;
const file = (page: Page, name: string) => page.getByRole('treeitem', { name, exact: true });
async function records(page: Page): Promise<any[]> {
  return page.evaluate(() => new Promise<any[]>((resolve, reject) => {
    const request = indexedDB.open('agentdeck-reading-sessions', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('sessions', 'readonly');
      const result = tx.objectStore('sessions').getAll();
      tx.oncomplete = () => { db.close(); resolve(result.result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
}
async function settings(page: Page, section = '阅读现场') {
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  if (!await dialog.isVisible()) await page.getByRole('button', { name: '设置', exact: true }).click();
  await dialog.getByRole('button', { name: section, exact: true }).click();
  return dialog;
}
async function saveCombination(page: Page, name: string) {
  const dialog = await settings(page);
  await dialog.getByRole('textbox', { name: '常用组合名称', exact: true }).fill(name);
  await dialog.getByRole('button', { name: '将当前现场另存为组合', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('已另存常用组合。');
  return (await records(page)).find(record => record.collection && record.name === name) as SavedReadingSession;
}
async function exportBackup(page: Page) {
  const dialog = await settings(page, '备份与恢复');
  const downloading = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '导出个人备份', exact: true }).click();
  const download = await downloading;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as PersonalBackup;
}

test.beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-personal-state-'));
  await fs.writeFile(path.join(root, 'a.md'), '# 阅读组合 A');
  await fs.writeFile(path.join(root, 'b.md'), '# 阅读组合 B');
});
test.afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto('/');
  await page.evaluate(async root => {
    const request = async (url: string, method = 'GET', body?: unknown) => {
      const response = await fetch(url, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(method === 'GET' ? {} : { 'X-Workbench': '1' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    };
    const current = await request('/api/projects');
    for (const project of current.projects) await request(`/api/projects/${project.id}`, 'DELETE', {});
    await request('/api/projects', 'POST', { name: '个人设置验证', mount: { label: '文件', absolutePath: root } });
  }, root);
  await file(page, '个人设置验证').click();
  await file(page, 'a.md').dblclick();
  await expect(page.locator('.markdown h1')).toHaveText('阅读组合 A');
});

test('named combinations open independent copies and live scenes cannot be deleted', async ({ page, context }) => {
  const originalId = sceneId(page);
  const combination = await saveCombination(page, '每日阅读');
  const dialog = await settings(page);
  const current = dialog.locator('.managed-reading-session').filter({ hasText: '当前现场' });
  await expect(current.getByRole('button', { name: '删除', exact: true })).toBeDisabled();
  await current.getByRole('button', { name: '命名', exact: true }).click();
  await current.getByRole('textbox', { name: '现场名称', exact: true }).fill('原始现场');
  await current.getByRole('button', { name: '保存名称', exact: true }).click();
  await expect(current.locator('strong')).toHaveText('原始现场');
  const opening = context.waitForEvent('page');
  await dialog.locator(`a[href="/?ws=${combination.id}"]`).click();
  const copy = await opening;
  await expect(copy.getByRole('tab', { name: 'a.md', exact: true })).toBeVisible();
  expect(sceneId(copy)).not.toBe(combination.id);
  await file(copy, 'b.md').click();
  await expect(copy.locator('.viewer:not([hidden]) .markdown h1')).toHaveText('阅读组合 B');
  await expect.poll(async () => (await records(copy)).find(record => record.id === sceneId(copy))?.snapshot.workspace.panes[0].active).toMatch(/:b\.md$/);
  expect((await records(copy)).find(record => record.id === combination.id)?.snapshot).toEqual(combination.snapshot);
  const copySettings = await settings(copy);
  const original = copySettings.locator('.managed-reading-session').filter({ hasText: '原始现场' });
  await expect(original.getByRole('button', { name: '删除', exact: true })).toBeDisabled();
  await page.close();
  await copySettings.getByRole('button', { name: '外观', exact: true }).click();
  await copySettings.getByRole('button', { name: '阅读现场', exact: true }).click();
  await expect(original.getByRole('button', { name: '删除', exact: true })).toBeEnabled();
  copy.once('dialog', prompt => void prompt.accept());
  await original.getByRole('button', { name: '删除', exact: true }).click();
  await expect(original).toHaveCount(0);
  expect((await records(copy)).some(record => record.id === originalId)).toBe(false);
});

test('backup round-trip restores whitelisted preferences and favorites after refresh with new combination IDs', async ({ page }) => {
  await page.getByRole('combobox', { name: '界面主题', exact: true }).selectOption('dark');
  await page.locator('.viewer:not([hidden])').getByRole('button', { name: '收藏文件', exact: true }).click();
  const combination = await saveCombination(page, '备份组合');
  const exported = await exportBackup(page);
  expect(exported.preferences.theme).toBe('dark');
  expect(exported.favorites).toHaveLength(1);
  expect(exported.collections).toHaveLength(1);
  let dialog = await settings(page, '备份与恢复');
  await dialog.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByRole('combobox', { name: '界面主题', exact: true }).selectOption('light');
  await page.locator('.viewer:not([hidden])').getByRole('button', { name: '取消收藏文件', exact: true }).click();
  const activeId = sceneId(page);
  dialog = await settings(page, '备份与恢复');
  await dialog.getByLabel('选择个人备份文件', { exact: true }).setInputFiles({ name: 'personal.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
  await dialog.getByRole('button', { name: '导入备份', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('将在刷新后应用');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('theme')!))).toBe('light');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('favorites')!))).toEqual([]);
  const imported = (await records(page)).filter(record => record.collection);
  expect(imported).toHaveLength(2);
  expect(new Set(imported.map(record => record.id)).size).toBe(2);
  expect(imported.some(record => record.id === combination.id)).toBe(true);
  await dialog.getByRole('button', { name: '刷新并应用设置', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '界面主题', exact: true })).toHaveValue('dark');
  expect(sceneId(page)).toBe(activeId);
  await expect(page.locator('.viewer:not([hidden])').getByRole('button', { name: '取消收藏文件', exact: true })).toBeVisible();
  expect((await records(page)).some(record => record.id === '__agentdeck_pending_personal_preferences__')).toBe(false);
});

test('malformed backups are rejected and an aborted IndexedDB transaction imports no partial records', async ({ page }) => {
  await saveCombination(page, '事务验证');
  const exported = await exportBackup(page);
  const dialog = await settings(page, '备份与恢复');
  const invalid = { ...exported, preferences: { 'unrelated-secret': 'injected' } };
  await dialog.getByLabel('选择个人备份文件', { exact: true }).setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)) });
  await expect(dialog.getByRole('alert')).toContainText('无效');
  await expect(dialog.getByRole('button', { name: '导入备份', exact: true })).toHaveCount(0);
  const before = (await records(page)).filter(record => record.collection).map(record => record.id);
  exported.collections.push({ ...exported.collections[0], name: '第二个组合' });
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    let imports = 0;
    IDBObjectStore.prototype.add = function(value, key) {
      if (value?.collection && ++imports === 2) throw new DOMException('模拟存储空间不足', 'QuotaExceededError');
      return original.call(this, value, key);
    };
  });
  await dialog.getByLabel('选择个人备份文件', { exact: true }).setInputFiles({ name: 'quota.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
  await dialog.getByRole('button', { name: '导入备份', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('模拟存储空间不足');
  const after = await records(page);
  expect(after.filter(record => record.collection).map(record => record.id)).toEqual(before);
  expect(after.some(record => record.id === '__agentdeck_pending_personal_preferences__')).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('unrelated-secret'))).toBeNull();
});
