import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

let root: string;
test.beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-settings-'));
  await fs.writeFile(path.join(root, 'report.html'), '<title>独立报告</title><input id="draft"><h1>独立报告</h1>');
  await fs.writeFile(path.join(root, 'note.md'), '# 笔记');
});
test.afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async root => {
    const request = (url: string, method = 'GET', body?: unknown) => fetch(url, { method, headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Workbench': '1' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) }).then(async r => { const data = await r.json(); if (!r.ok) throw new Error(JSON.stringify(data)); return data; });
    const snapshot = await request('/api/projects');
    for (const p of snapshot.projects) await request(`/api/projects/${p.id}`, 'DELETE');
    await request('/api/projects', 'POST', { name: '设置验证', mount: { label: '文件', absolutePath: root } });
  }, root);
  await page.getByRole('treeitem', { name: '设置验证', exact: true }).click();
});

test('settings is a persistent page and preserves the mounted report and theme', async ({ page }) => {
  await page.getByRole('treeitem', { name: 'report.html', exact: true }).dblclick();
  const input = page.frameLocator('iframe').locator('#draft');
  await input.fill('继续阅读');
  const frame = page.frames().find(f => f.url().endsWith('/report.html'))!;
  await frame.evaluate(() => (window as unknown as { identity: string }).identity = 'same-frame');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page).toHaveURL(/#settings$/);
  const settings = page.getByRole('main', { name: '设置页面' });
  await expect(settings).toBeVisible();
  await expect(settings.getByLabel('HTML 默认打开方式')).toHaveValue('workbench');
  await settings.getByLabel('HTML 默认打开方式').selectOption('browser');
  await settings.getByRole('button', { name: '外观', exact: true }).click();
  await settings.getByLabel('界面主题').selectOption('dark');
  await settings.getByRole('button', { name: '返回工作台' }).click();
  await expect(input).toHaveValue('继续阅读');
  expect(await frame.evaluate(() => (window as unknown as { identity: string }).identity)).toBe('same-frame');
  await expect(page.getByLabel('界面主题')).toHaveValue('dark');
  await page.goto('/#settings');
  await expect(page.getByLabel('HTML 默认打开方式')).toHaveValue('browser');
});

test('HTML preference opens the raw page once and explicit internal opening overrides it', async ({ page, context }) => {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('HTML 默认打开方式').selectOption('browser');
  await page.getByRole('button', { name: '返回工作台' }).click();
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('treeitem', { name: 'report.html', exact: true }).dblclick();
  const popup = await popupPromise;
  await expect(popup.getByRole('heading', { name: '独立报告' })).toBeVisible();
  await expect(popup.locator('.shell')).toHaveCount(0);
  expect(context.pages()).toHaveLength(2);
  await expect(page.getByRole('tab')).toHaveCount(0);
  await popup.close();
  await page.getByLabel('打开方式：report.html', { exact: true }).click();
  await page.getByRole('button', { name: '在工作台标签页打开', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(1);
  await page.getByRole('tab').click();
  expect(context.pages()).toHaveLength(1);
  await page.getByRole('treeitem', { name: 'note.md', exact: true }).click();
  await expect(page.locator('.markdown h1')).toHaveText('笔记');
});
