import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileReference } from '../../app/shared/model.js';

let root: string;
async function json(page: Page, url: string, method = 'GET', body?: unknown) {
  return page.evaluate(async ({ url, method, body }) => {
    const response = await fetch(url, { method, headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Workbench': '1' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }, { url, method, body });
}
async function mount(page: Page, name: string, folder: string, enabled = true) {
  await json(page, '/api/projects', 'POST', { name, mount: { label: '成果', absolutePath: path.join(root, folder), enabled } });
  const snapshot = await json(page, '/api/projects');
  const project = snapshot.projects.find((p: { name: string }) => p.name === name);
  return snapshot.mounts.find((m: { projectId: string }) => m.projectId === project.id);
}
test.beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-help-'));
  for (const folder of ['one', 'two', 'disabled']) await fs.mkdir(path.join(root, folder));
  await fs.writeFile(path.join(root, 'one', 'index.html'), '<title>帮助验证工具</title><input id="draft"><div style="height:5000px">长内容</div>');
  await fs.writeFile(path.join(root, 'one', 'notes.md'), '# 阅读位置\n\n' + '帮助关闭后继续阅读。\n\n'.repeat(180));
});
test.afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  const snapshot = await json(page, '/api/projects');
  for (const project of snapshot.projects) await json(page, `/api/projects/${project.id}`, 'DELETE');
});

test('empty workspace offers help and usable templates without invented paths', async ({ page }) => {
  await page.getByRole('button', { name: '如何使用与协作' }).click();
  const help = page.getByRole('dialog', { name: '使用帮助', exact: true });
  await expect(help.getByRole('heading', { level: 1 })).toContainText('让 Agent 的成果');
  expect((await help.boundingBox())!.width).toBeGreaterThan(1000);
  await page.screenshot({ path: 'test-results/help-desktop.png' });
  await help.getByRole('button', { name: /任务模板.*复制后/ }).click();
  await expect(help.getByLabel('成果所在目录')).toHaveValue('');
  await expect(help.getByLabel('任务提示词')).toHaveValue(/【填写实际输出目录的绝对路径】/);
  await help.getByRole('button', { name: '制作工具', exact: true }).click();
  await expect(help.getByLabel('任务提示词')).toHaveValue(/正常输入、空输入、错误输入/);
  await help.getByRole('button', { name: '交接任务', exact: true }).click();
  await expect(help.getByLabel('任务提示词')).toHaveValue(/已经完成：【当前成果/);
  await page.screenshot({ path: 'test-results/help-prompts.png' });
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
  await expect(page.getByRole('button', { name: '如何使用与协作' })).toBeFocused();
});

test('templates copy real context, switch mounts safely and preserve a running preview', async ({ page, context }) => {
  const first = await mount(page, '第一个项目', 'one');
  const second = await mount(page, '第二个项目', 'two');
  await mount(page, '停用项目', 'disabled', false);
  await page.goto(`/?entry=${encodeURIComponent(fileReference(first.id, 'index.html'))}`);
  const frame = page.frameLocator('iframe');
  await frame.locator('#draft').fill('保留工具输入');
  await frame.locator('body').evaluate(() => window.scrollTo(0, 400));
  const frameElement = await page.locator('iframe').elementHandle();
  await page.getByRole('button', { name: '使用帮助', exact: true }).click();
  const help = page.getByRole('dialog', { name: '使用帮助', exact: true });
  await help.getByRole('button', { name: /任务模板.*复制后/ }).click();
  await expect(help.getByLabel('成果所在目录')).toHaveValue(first.id);
  await expect(help.getByLabel('成果所在目录').locator('option')).toHaveCount(3);
  await help.getByRole('button', { name: '反馈修改', exact: true }).click();
  const prompt = help.getByLabel('任务提示词');
  expect(await prompt.inputValue()).toContain(path.join(first.absolutePath, 'index.html'));
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await help.getByRole('button', { name: '复制任务模板' }).click();
  await expect(help.getByRole('status')).toContainText('已复制');
  // Windows clipboard uses CRLF while textarea values use LF.
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.replace(/\r\n/g, '\n')).toBe(await prompt.inputValue());
  await help.getByLabel('成果所在目录').selectOption(second.id);
  expect(await prompt.inputValue()).toContain(second.absolutePath);
  expect(await prompt.inputValue()).not.toContain(first.absolutePath);
  expect(await prompt.inputValue()).toContain('【填写需要处理的文件绝对路径】');
  await expect(help.getByRole('status')).toBeEmpty();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '使用帮助', exact: true })).toBeFocused();
  await expect(frame.locator('#draft')).toHaveValue('保留工具输入');
  expect(await frame.locator('body').evaluate(() => window.scrollY)).toBe(400);
  expect(await frameElement!.evaluate(el => el.isConnected)).toBe(true);
});

test('copy denial selects text for manual copying and nested shortcut help closes one layer', async ({ page }) => {
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } }));
  await page.getByRole('button', { name: '使用帮助', exact: true }).click();
  const help = page.getByRole('dialog', { name: '使用帮助', exact: true });
  await help.getByRole('button', { name: /任务模板.*复制后/ }).click();
  await help.getByRole('button', { name: '复制任务模板' }).click();
  await expect(help.getByRole('status')).toContainText('文本已选中');
  const prompt = help.getByLabel('任务提示词');
  await expect(prompt).toBeFocused();
  expect(await prompt.evaluate((el: HTMLTextAreaElement) => el.selectionStart === 0 && el.selectionEnd === el.value.length)).toBe(true);
  const shortcuts = help.getByRole('button', { name: /快捷键.*查看操作/ });
  await shortcuts.click();
  await expect(page.getByRole('dialog', { name: '快捷键', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(help).toBeVisible();
  await expect(shortcuts).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(help.getByLabel('帮助正文')).toBeFocused();
  await help.getByRole('button', { name: '关闭使用帮助' }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(help.getByRole('button', { name: '复制任务模板' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('help works on narrow screens with all topics reachable and no horizontal content overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '使用帮助', exact: true }).click();
  const help = page.getByRole('dialog', { name: '使用帮助', exact: true });
  expect(await help.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/help-mobile.png' });
  for (const topic of ['高效使用', '与 Agent 沟通', '任务模板', '常见问题']) {
    await help.getByRole('navigation', { name: '帮助主题' }).getByRole('button', { name: new RegExp(topic) }).click();
    const content = help.getByLabel('帮助正文');
    expect(await content.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await expect(help.getByRole('button', { name: '关闭使用帮助' })).toBeInViewport();
  }
  await help.getByRole('button', { name: '关闭使用帮助' }).click();
  await expect(help).toHaveCount(0);
});

test('help preserves Markdown reading position and immersion', async ({ page }) => {
  const item = await mount(page, '阅读项目', 'one');
  await page.goto(`/preview?entry=${encodeURIComponent(fileReference(item.id, 'notes.md'))}`);
  await expect(page.locator('.markdown h1')).toHaveText('阅读位置');
  await page.locator('.reader').evaluate(el => { el.scrollTop = 500; });
  await page.getByRole('button', { name: '使用帮助', exact: true }).click();
  await page.keyboard.press('Escape');
  expect(await page.locator('.reader').evaluate(el => el.scrollTop)).toBe(500);
  await expect(page.locator('.shell')).toHaveClass(/immersive/);
});
