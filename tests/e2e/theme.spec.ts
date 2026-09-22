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
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-theme-'));
  await fs.writeFile(path.join(root, 'report.html'), '<meta charset="utf-8"><style>body{background:#fff;color:#123}</style><h1>研究报告</h1><input id="draft"><div style="height:2000px">原始 HTML 自行决定配色</div>');
  await fs.writeFile(path.join(root, 'notes.md'), '# 研究报告 · 阅读核验\n\n## 主要结论\n\n这是一份用于核对主题和阅读状态的示例资料。报告与原始来源可以在浏览器中来回查看。\n\n> 保留报告页面，切换后继续阅读。\n\n## 数据对照\n\n| 项目 | 本期 | 上期 |\n| --- | --- | --- |\n| 样本 A | 120 | 100 |\n| 样本 B | 85 | 90 |\n\n## 口径说明\n\n```json\n{"period":"本期","unit":"示例单位"}\n```\n\n[原始出处](https://example.com/research)\n\n' + '阅读笔记。\n\n'.repeat(60));
});
test.afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

test('default follows system live, manual choice persists, and startup theme precedes the application', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const html = page.locator('html');
  const theme = page.getByRole('combobox', { name: '界面主题' });
  await expect(theme).toHaveValue('system'); await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' }); await expect(html).toHaveAttribute('data-theme', 'light');
  await theme.selectOption('dark');
  await page.emulateMedia({ colorScheme: 'dark' }); await page.emulateMedia({ colorScheme: 'light' });
  await expect(html).toHaveAttribute('data-theme', 'dark');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/assets/*.js', async route => { await gate; await route.continue(); });
  await page.reload({ waitUntil: 'commit' });
  try {
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('#root')).toBeAttached();
    expect(await page.locator('#root').evaluate(el => el.childElementCount)).toBe(0);
  } finally { release(); }
  await expect(theme).toHaveValue('dark');
  await theme.selectOption('light'); await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await theme.selectOption('system'); await page.emulateMedia({ colorScheme: 'dark' });
  await expect(html).toHaveAttribute('data-theme', 'dark');
});

test('theme covers reading, help and dialogs while kept HTML remains intact', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: 'light' }); await page.goto('/');
  const snapshot = await json(page, '/api/projects');
  for (const project of snapshot.projects) await json(page, `/api/projects/${project.id}`, 'DELETE');
  await json(page, '/api/projects', 'POST', { name: '报告资料', mount: { label: '研究报告', absolutePath: root } });
  await page.getByRole('treeitem', { name: '报告资料', exact: true }).click();
  await page.getByRole('treeitem', { name: 'report.html', exact: true }).dblclick();
  await page.getByRole('tabpanel').frameLocator('iframe').locator('#draft').fill('主题切换保留输入');
  const frame = page.frames().find(f => f.url().endsWith('/report.html'))!;
  await frame.evaluate(() => window.scrollTo(0, 300));
  const iframe = await page.locator('iframe').elementHandle();
  await page.getByRole('treeitem', { name: 'notes.md', exact: true }).dblclick();
  await expect(page.getByRole('tabpanel').locator('.markdown h1')).toHaveText('研究报告 · 阅读核验');
  const light = await page.getByRole('tabpanel').evaluate(el => getComputedStyle(el).backgroundColor);
  await page.screenshot({ path: 'test-results/theme-light.png' });
  await page.getByRole('combobox', { name: '界面主题' }).selectOption('dark');
  const dark = await page.getByRole('tabpanel').evaluate(el => getComputedStyle(el).backgroundColor);
  expect(dark).not.toBe(light);
  await page.screenshot({ path: 'test-results/theme-dark.png' });
  await page.getByRole('button', { name: '使用帮助', exact: true }).click();
  const help = page.getByRole('dialog', { name: '使用帮助', exact: true });
  expect(await help.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(dark);
  await page.screenshot({ path: 'test-results/theme-help-dark.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '添加项目', exact: true }).click();
  expect(await page.getByRole('dialog').evaluate(el => getComputedStyle(el).backgroundColor)).toBe(dark);
  await expect(page.getByRole('textbox', { name: '项目名称', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'report.html', exact: true }).click();
  expect(await iframe!.evaluate(el => el.isConnected)).toBe(true);
  expect(await frame.evaluate(() => window.scrollY)).toBe(300);
  await expect(frame.locator('#draft')).toHaveValue('主题切换保留输入');
  expect(await frame.locator('body').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('combobox', { name: '界面主题' })).toBeInViewport();
  await expect(page.getByRole('button', { name: '使用帮助', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: '收起文件侧栏', exact: true }).click();
  await page.getByRole('tab', { name: 'notes.md', exact: true }).click();
  await page.screenshot({ path: 'test-results/theme-mobile-dark.png' });
});

test('invalid saved theme falls back to system', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('theme', '"unsupported"'));
  await page.emulateMedia({ colorScheme: 'dark' }); await page.goto('/');
  await expect(page.getByRole('combobox', { name: '界面主题' })).toHaveValue('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('blocked preference storage still permits a session theme choice', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('blocked'); };
    Storage.prototype.setItem = () => { throw new Error('blocked'); };
  });
  await page.emulateMedia({ colorScheme: 'light' }); await page.goto('/');
  await page.getByRole('combobox', { name: '界面主题' }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '使用帮助', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '使用帮助', exact: true })).toBeVisible();
});
