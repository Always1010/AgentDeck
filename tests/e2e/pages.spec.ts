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
const activePanel = (page: Page) => page.getByRole('tabpanel');
const openFile = (page: Page, name: string) => page.getByRole('treeitem', { name, exact: true });
const tab = (page: Page, name: string) => page.getByRole('tab', { name: new RegExp(name.replace('.', '\\.')) });
test.beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-pages-'));
  for (const name of ['a', 'b', 'c']) await fs.writeFile(path.join(root, `${name}.html`), `<title>${name}</title><input id="draft"><div style="height:1200px">研究报告 ${name}</div><a href="https://sources.example/research" target="_blank" rel="noopener noreferrer">原始出处</a><div style="height:1800px">报告结尾</div>`);
  for (const name of ['one', 'two']) await fs.writeFile(path.join(root, `${name}.md`), `# ${name}\n\n[查看结论](#结论)\n\n${'阅读内容。\n\n'.repeat(100)}\n\n## 结论\n\n共同标题，不应跳转到其他报告。`);
  for (const name of ['行业甲', '行业乙']) {
    await fs.mkdir(path.join(root, name));
    await fs.writeFile(path.join(root, name, 'index.html'), `<h1>${name}</h1>`);
  }
});
test.afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  const snapshot = await json(page, '/api/projects');
  for (const item of snapshot.projects) await json(page, `/api/projects/${item.id}`, 'DELETE');
  await json(page, '/api/projects', 'POST', { name: '报告阅读', mount: { label: '研究报告', absolutePath: root } });
  await openFile(page, '报告阅读').click();
});

test('temporary preview, double-click retention, open list, deduplication and recent close order', async ({ page }) => {
  await openFile(page, 'a.html').click();
  await expect(page.getByRole('tab')).toHaveCount(1);
  await openFile(page, 'b.html').click();
  await expect(page.getByRole('tab')).toHaveCount(1);
  await expect(tab(page, 'a.html')).toHaveCount(0);
  await openFile(page, 'b.html').dblclick();
  await expect(page.locator('.page-tab.temporary')).toHaveCount(0);
  await openFile(page, 'a.html').click();
  await tab(page, 'a.html').dblclick();
  await openFile(page, 'c.html').click();
  await expect(page.getByRole('tab')).toHaveCount(3);
  const opened = page.getByRole('region', { name: '已打开页面', exact: true });
  await expect(opened.locator('.open-page-row')).toHaveCount(3);
  await tab(page, 'b.html').click();
  await openFile(page, 'b.html').click();
  await expect(page.getByRole('tab')).toHaveCount(3);
  await page.screenshot({ path: 'test-results/pages-desktop.png' });
  await page.getByRole('tablist').getByRole('button', { name: '关闭页面：b.html', exact: true }).click();
  await expect(tab(page, 'c.html')).toHaveAttribute('aria-selected', 'true');
  await opened.getByRole('button', { name: '关闭页面：a.html', exact: true }).click();
  await expect(tab(page, 'c.html')).toHaveAttribute('aria-selected', 'true');
  await opened.getByRole('button', { name: /已打开页面/ }).click();
  await expect(opened.locator('.open-pages-list')).toHaveCount(0);
  await page.getByRole('tablist').getByRole('button', { name: '关闭页面：c.html', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '打开报告，专注阅读。' })).toBeVisible();
});

test('kept HTML input, scroll and source browsing survive switches; background polling stops', async ({ page, context }) => {
  await openFile(page, 'a.html').dblclick();
  await activePanel(page).frameLocator('iframe').locator('#draft').fill('报告 A 批注');
  const frameA = page.frames().find(f => f.url().endsWith('/a.html'))!;
  await frameA.evaluate(() => window.scrollTo(0, 500));
  await openFile(page, 'b.html').dblclick();
  await activePanel(page).frameLocator('iframe').locator('#draft').fill('报告 B 批注');
  const requests: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/entries/')) requests.push(decodeURIComponent(request.url())); });
  await page.waitForTimeout(4500);
  expect(requests.some(url => url.endsWith(':a.html'))).toBe(false);
  expect(requests.some(url => url.endsWith(':b.html'))).toBe(true);
  await tab(page, 'a.html').click();
  await expect(activePanel(page).frameLocator('iframe').locator('#draft')).toHaveValue('报告 A 批注');
  expect(await frameA.evaluate(() => window.scrollY)).toBe(500);
  await context.route('https://sources.example/research', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<meta charset="utf-8"><h1>原始研究资料</h1>' }));
  const popupPromise = page.waitForEvent('popup');
  await activePanel(page).frameLocator('iframe').getByRole('link', { name: '原始出处' }).click();
  const popup = await popupPromise;
  await expect(popup.getByRole('heading')).toHaveText('原始研究资料');
  const position = await frameA.evaluate(() => window.scrollY);
  await popup.close(); await page.bringToFront();
  expect(await frameA.evaluate(() => window.scrollY)).toBe(position);
  await expect(activePanel(page).frameLocator('iframe').locator('#draft')).toHaveValue('报告 A 批注');
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(activePanel(page).frameLocator('iframe').locator('#draft')).toHaveValue('');
  await tab(page, 'b.html').click();
  await expect(activePanel(page).frameLocator('iframe').locator('#draft')).toHaveValue('报告 B 批注');
});

test('Markdown anchors and scroll belong to each retained document; tab keyboard navigation works', async ({ page }) => {
  await openFile(page, 'one.md').dblclick();
  await expect(activePanel(page).locator('.markdown h1')).toHaveText('one');
  await activePanel(page).locator('.reader').evaluate(el => { el.scrollTop = 300; });
  const firstReader = page.locator('.reader').first();
  await openFile(page, 'two.md').dblclick();
  await expect(activePanel(page).locator('.markdown h1')).toHaveText('two');
  await activePanel(page).getByRole('link', { name: '查看结论' }).click();
  expect(await activePanel(page).locator('.reader').evaluate(el => el.scrollTop)).toBeGreaterThan(500);
  await tab(page, 'one.md').click();
  expect(await firstReader.evaluate(el => el.scrollTop)).toBe(300);
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, 'two.md')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, 'two.md')).toBeFocused();
});

test('same-name reports identify directories and favorites/tools use the same retention rules', async ({ page }) => {
  await openFile(page, '行业甲').click(); await openFile(page, '行业乙').click();
  const indexes = page.getByRole('treeitem', { name: 'index.html', exact: true });
  await indexes.nth(0).dblclick(); await indexes.nth(1).dblclick();
  await expect(page.getByRole('tab', { name: /index.html.*行业甲/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /index.html.*行业乙/ })).toBeVisible();
  await page.getByRole('button', { name: '收藏文件', exact: true }).click();
  await page.getByRole('button', { name: '更多设置', exact: true }).click();
  await page.getByRole('button', { name: '添加到工具', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('tablist').getByRole('button', { name: /关闭页面：index.html.*行业乙/ }).click();
  await page.getByRole('button', { name: '收藏', exact: true }).click();
  await openFile(page, 'index.html').dblclick();
  await expect(page.locator('.page-tab.temporary')).toHaveCount(0);
  await page.getByRole('button', { name: '工具', exact: true }).click();
  await openFile(page, '行业乙').dblclick();
  await expect(page.getByRole('tab')).toHaveCount(2);
});

test('narrow layout offers an explicit keep action and a bounded open-pages list', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFile(page, 'a.html').click();
  await tab(page, 'a.html').dblclick();
  await expect(page.locator('.page-tab.temporary')).toHaveCount(0);
  await page.getByRole('button', { name: '展开文件侧栏' }).click();
  await openFile(page, 'b.html').click();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await tab(page, 'a.html').click();
  await expect(tab(page, 'a.html')).toHaveAttribute('aria-selected', 'true');
  expect(await page.locator('.workspace-pages').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/pages-mobile.png' });
});


test('temporary tabs use italics without labels or keep buttons and explain retention', async ({ page }) => {
  await openFile(page, 'a.html').click();
  const temporary = page.locator('.page-tab.temporary');
  await expect(temporary.locator('[role=tab]>span')).toHaveCSS('font-style', 'italic');
  await expect(temporary).not.toContainText('临时');
  await expect(temporary.getByRole('button', { name: /保留/ })).toHaveCount(0);
  await tab(page, 'a.html').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '保留标签页' }).click();
  await openFile(page, 'b.html').click();
  await expect(tab(page, 'a.html')).toBeVisible();
  await tab(page, 'b.html').dblclick();
  await openFile(page, 'c.html').click();
  await expect(page.getByRole('tab')).toHaveCount(3);
  await page.getByRole('button', { name: '快捷键', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('双击文件列表中的文件，或双击标签页');
});
