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
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-shortcuts-'));
  await fs.mkdir(path.join(root, 'tools'));
  await fs.writeFile(path.join(root, 'tools', 'index.html'), '<title>键盘验证工具</title><input id="draft"><div style="height:5000px">长内容</div>');
  await fs.writeFile(path.join(root, 'a.md'), '# 第一篇笔记\n\n' + '保留阅读位置。\n\n'.repeat(150));
  await fs.writeFile(path.join(root, 'b.md'), '# 第二篇笔记');
});
test.afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const snapshot = await json(page, '/api/projects');
  for (const project of snapshot.projects) await json(page, `/api/projects/${project.id}`, 'DELETE');
  await json(page, '/api/projects', 'POST', { name: '键盘验证', mount: { label: '主目录', absolutePath: root, toolDirectories: ['tools'] } });
  await page.getByRole('treeitem',{name:'键盘验证',exact:true}).click();await page.getByRole('treeitem',{name:'tools',exact:true}).click();await page.getByRole('treeitem',{name:'index.html',exact:true}).click();
  await expect(page.frameLocator('iframe').locator('#draft')).toBeVisible();
});

test('single F toggles without reload; iframe typing is untouched; Escape closes one layer', async ({ page }) => {
  const input = page.frameLocator('iframe').locator('#draft');
  await input.fill('保留输入');
  await page.locator('.file-row.selected .node-main').focus();
  await page.keyboard.press('f');
  await expect(page.locator('.shell')).toHaveClass(/immersive/);
  await expect(page.getByRole('button', { name: '退出沉浸', exact: true })).toBeFocused();
  await input.focus(); await page.keyboard.type('f/?');
  await expect(input).toHaveValue('保留输入f/?');
  await page.keyboard.press('Escape');
  await expect(page.locator('.shell')).toHaveClass(/immersive/);
  await page.getByRole('button', { name: '更多设置' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-viewer-settings]')).toHaveCount(0);
  await expect(page.locator('.shell')).toHaveClass(/immersive/);
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: '快捷键', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.shell')).toHaveClass(/immersive/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.shell')).not.toHaveClass(/immersive/);
  await expect(page.locator('.file-row.selected .node-main')).toBeFocused();
  await expect(input).toHaveValue('保留输入f/?');
});

test('immersive search is temporary and list arrows do not replace a live tool', async ({ page }) => {
  await page.getByRole('button', { name: '收起文件侧栏', exact: true }).click();
  await page.getByRole('button', { name: '沉浸', exact: true }).click();
  await page.keyboard.press('/');
  const search = page.getByLabel('筛选文件', { exact: true });
  await expect(search).toBeFocused(); await expect(page.locator('.explorer')).toBeVisible();
  await search.fill('没有结果');
  await page.keyboard.press('Escape');
  await expect(page.locator('.shell')).toHaveClass(/immersive/);
  await expect(search).toHaveValue('');
  await page.keyboard.press('/');
  await search.fill('.md');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('treeitem',{name:'a.md',exact:true})).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('treeitem',{name:'b.md',exact:true})).toBeFocused();
  await expect(page.frameLocator('iframe').locator('#draft')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.shell')).toHaveClass(/immersive/);
  await expect(page.locator('.markdown h1')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.explorer')).toBeHidden();
  await page.reload();
  await expect(page.locator('.explorer')).toBeHidden();
});

test('form input, composition and modified shortcuts remain unhandled', async ({ page }) => {
  const search = page.getByLabel('筛选文件', { exact: true });
  await search.fill('f/?');
  await expect(page.locator('.shell')).not.toHaveClass(/immersive/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await search.fill('');
  const unhandled = await page.evaluate(() => {
    const target = document.querySelector('.immersion-toggle')!;
    return [
      { key: 'f', ctrlKey: true }, { key: 'k', ctrlKey: true }, { key: 'l', ctrlKey: true }, { key: 'j', ctrlKey: true },
      { key: 'f', metaKey: true }, { key: 'f', altKey: true }, { key: 'F11' }, { key: 'f', repeat: true },
      { key: 'f', isComposing: true }, { key: 'f', keyCode: 229 },
    ].every(options => target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...options })));
  });
  expect(unhandled).toBe(true);
  await expect(page.locator('.shell')).not.toHaveClass(/immersive/);
  await page.getByRole('button', { name: '添加项目', exact: true }).click();
  await expect(page.getByLabel('项目名称', { exact: true })).toBeFocused();
  await page.getByLabel('项目名称', { exact: true }).fill('f/?');
  await page.getByRole('button', { name: '选择本机文件夹' }).click();
  await expect(page.getByRole('dialog', { name: '选择本机目录', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '选择本机目录', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '添加项目', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '选择本机文件夹' })).toBeFocused();
  await page.getByRole('button', { name: '取消', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '关闭', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '添加项目', exact: true })).toBeFocused();
});

test('single-key opt-out persists while buttons and Escape remain usable', async ({ page }) => {
  await page.getByRole('button', { name: '快捷键', exact: true }).click();
  await page.getByLabel('启用单键快捷键').uncheck();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '沉浸', exact: true }).focus();
  await page.keyboard.press('f');
  await expect(page.locator('.shell')).not.toHaveClass(/immersive/);
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '沉浸', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.shell')).not.toHaveClass(/immersive/);
  await page.reload();
  await page.getByRole('button', { name: '快捷键', exact: true }).click();
  await expect(page.getByLabel('启用单键快捷键')).not.toBeChecked();
});

test('Markdown reading position survives keyboard immersion and standalone preview can exit', async ({ page }) => {
  await page.getByRole('treeitem',{name:'a.md',exact:true}).click();
  await expect(page.locator('.markdown h1')).toHaveText('第一篇笔记');
  await page.locator('.reader').evaluate(el => { el.scrollTop = 500; });
  await page.getByRole('button', { name: '沉浸', exact: true }).focus();
  await page.keyboard.press('f');
  expect(await page.locator('.reader').evaluate(el => el.scrollTop)).toBe(500);
  await page.keyboard.press('f');
  expect(await page.locator('.reader').evaluate(el => el.scrollTop)).toBe(500);
  const preview = await page.getByRole('link', { name: '新标签', exact: true }).getAttribute('href');
  await page.goto(preview!);
  await expect(page.locator('.shell')).toHaveClass(/immersive/);
  await page.getByRole('button', { name: '退出沉浸', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('.shell')).not.toHaveClass(/immersive/);
  await expect(page.locator('.markdown h1')).toHaveText('第一篇笔记');
  await page.getByRole('tablist').getByRole('button',{name:'关闭页面：a.md'}).click();
  await expect(page.locator('.reading-pane')).toHaveCount(1);
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'打开报告，专注阅读。'})).toBeVisible();
});

test('B toggles sidebar, leaves typing alone, and preserves the current tool',async({page})=>{
 const input=page.frameLocator('iframe').locator('#draft');await input.fill('保持输入');const sidebar=page.locator('.sidebar-toggle');await expect(sidebar).toHaveAttribute('title',/B/);await sidebar.focus();await page.keyboard.press('b');await expect(page.locator('.explorer')).toBeHidden();await expect(sidebar).toBeFocused();await page.keyboard.press('b');await expect(page.locator('.explorer')).toBeVisible();await expect(input).toHaveValue('保持输入');
 const search=page.getByLabel('筛选文件',{exact:true});await search.focus();await page.keyboard.press('b');await expect(search).toHaveValue('b');await expect(page.locator('.explorer')).toBeVisible();await search.fill('');
 await input.focus();await page.keyboard.press('b');await expect(input).toHaveValue('保持输入b');await expect(page.locator('.explorer')).toBeVisible();
 await page.getByRole('button',{name:'沉浸',exact:true}).click();await page.keyboard.press('b');await expect(page.locator('.explorer')).toBeVisible();await expect(page.locator('.shell')).not.toHaveClass(/immersive/);await expect(input).toHaveValue('保持输入b');
 await page.getByRole('button',{name:'快捷键',exact:true}).click();await page.getByLabel('启用单键快捷键').uncheck();await page.keyboard.press('Escape');await sidebar.focus();await page.keyboard.press('b');await expect(page.locator('.explorer')).toBeVisible();await expect(sidebar.locator('kbd')).toHaveCount(0);await expect(page.locator('.immersion-toggle kbd')).toHaveCount(0);
});
