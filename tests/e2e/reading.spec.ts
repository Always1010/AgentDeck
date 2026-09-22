import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

let root: string;
export const pane = (page: Page, index: number) => page.locator(`[data-pane="${index}"]`);
test.beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-reading-'));
  for (const name of ['a', 'b', 'c', 'd']) {
    await fs.writeFile(path.join(root, `${name}.html`), `<title>${name}</title><input id="draft"><div style="height:3000px">${name}</div><script>window.pageKeys=0;window.addEventListener('keydown',e=>{if(e.key==='f')window.pageKeys++;},true)</script>`);
    await fs.writeFile(path.join(root, `${name}.md`), `# ${name}\n\n${'阅读内容\n\n'.repeat(200)}`);
  }
});
test.afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.evaluate(async root => {
    const request = (url: string, method = 'GET', body?: unknown) => fetch(url, { method, headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Workbench': '1' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) }).then(async r => { const data = await r.json(); if (!r.ok) throw new Error(JSON.stringify(data)); return data; });
    const snapshot = await request('/api/projects');
    for (const p of snapshot.projects) await request(`/api/projects/${p.id}`, 'DELETE');
    await request('/api/projects', 'POST', { name: '阅读验证', mount: { label: '文件', absolutePath: root } });
  }, root);
  await page.getByRole('treeitem', { name: '阅读验证', exact: true }).click();
});

test('two panes retain same-file instances through orientation, resize and single view', async ({ page }) => {
  await page.getByRole('treeitem', { name: 'a.html', exact: true }).dblclick();
  const left = pane(page, 0), right = pane(page, 1);
  await left.frameLocator('iframe').locator('#draft').fill('左侧输入');
  const original = page.frames().find(f => f.url().endsWith('/a.html'))!;
  await original.evaluate(() => { (window as unknown as { identity: string }).identity = 'original'; window.scrollTo(0, 400); });
  await left.getByRole('button', { name: '更多设置' }).click();
  await left.getByRole('button', { name: '在另一阅读区打开' }).click();
  await right.frameLocator('iframe').locator('#draft').fill('右侧输入');
  await expect(page.getByRole('tabpanel')).toHaveCount(2);
  await expect(page.locator('[role=tab][id]')).toHaveCount(2);
  const ids = await page.locator('[role=tab][id]').evaluateAll(elements => elements.map(el => el.id));
  expect(new Set(ids).size).toBe(2);
  await page.getByLabel('阅读布局', { exact: true }).selectOption('rows');
  const upper = await left.boundingBox(), lower = await right.boundingBox();
  expect(lower!.y).toBeGreaterThan(upper!.y + upper!.height);
  await expect(left.frameLocator('iframe').locator('#draft')).toHaveValue('左侧输入');
  await expect(right.frameLocator('iframe').locator('#draft')).toHaveValue('右侧输入');
  expect(await original.evaluate(() => (window as unknown as { identity: string }).identity)).toBe('original');
  const divider = page.getByRole('separator', { name: '调整阅读区比例' });
  await divider.focus(); await page.keyboard.press('ArrowUp');
  await expect(divider).toHaveAttribute('aria-valuenow', '48');
  await right.getByRole('tab').click();
  await page.getByLabel('阅读布局', { exact: true }).selectOption('single');
  await expect(left).toBeHidden(); await expect(right).toBeVisible();
  await page.getByLabel('阅读布局', { exact: true }).selectOption('columns');
  await expect(left.frameLocator('iframe').locator('#draft')).toHaveValue('左侧输入');
  await expect(right.frameLocator('iframe').locator('#draft')).toHaveValue('右侧输入');
  await page.setViewportSize({ width: 900, height: 1440 });
  await page.getByLabel('阅读布局', { exact: true }).selectOption('rows');
  await expect(divider).toHaveAttribute('aria-valuenow', '48');
  await page.screenshot({ path: 'test-results/reading-portrait.png' });
});

test('new files replace only the selected pane temporary page', async ({ page }) => {
  await page.getByRole('treeitem', { name: 'a.md', exact: true }).click();
  await page.getByLabel('阅读布局', { exact: true }).selectOption('columns');
  await pane(page, 1).getByRole('button', { name: '选择文件', exact: true }).click();
  await page.getByRole('treeitem', { name: 'b.md', exact: true }).click();
  await page.getByRole('treeitem', { name: 'c.md', exact: true }).click();
  await expect(pane(page, 0).getByRole('tab')).toHaveText('a.md');
  await expect(pane(page, 1).getByRole('tab')).toHaveText('c.md');
  await expect(pane(page, 0).locator('.markdown h1')).toHaveText('a');
  await pane(page, 0).getByRole('tab').click();
  await page.getByRole('treeitem', { name: 'd.md', exact: true }).dblclick();
  await expect(pane(page, 1).locator('.markdown h1')).toHaveText('c');
  await expect(pane(page, 0).locator('.page-tab.temporary')).toHaveCount(0);
});

test('Alt history restores replaced text previews, isolates panes and truncates forward visits', async ({ page }) => {
  const first = pane(page, 0), second = pane(page, 1);
  await page.getByRole('treeitem', { name: 'a.md', exact: true }).click();
  await expect(first.locator('.markdown h1')).toHaveText('a');
  await first.locator('.reader').evaluate(el => { el.scrollTop = 450; });
  await page.getByRole('treeitem', { name: 'b.md', exact: true }).click();
  await page.getByRole('treeitem', { name: 'c.md', exact: true }).click();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(first.locator('.markdown h1')).toHaveText('b');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(first.locator('.markdown h1')).toHaveText('a');
  await expect.poll(()=>first.locator('.reader').evaluate(el=>el.scrollTop)).toBe(450);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(first.locator('.markdown h1')).toHaveText('a');
  await expect(page).toHaveURL(/127\.0\.0\.1:4410/);
  await page.keyboard.press('Alt+ArrowRight');
  await expect(first.locator('.markdown h1')).toHaveText('b');
  await page.getByRole('treeitem', { name: 'd.md', exact: true }).click();
  await expect(first.getByRole('button', { name: '前进', exact: true })).toBeDisabled();
  await page.getByLabel('阅读布局', { exact: true }).selectOption('rows');
  await second.getByRole('button', { name: '选择文件', exact: true }).click();
  await page.getByRole('treeitem', { name: 'a.md', exact: true }).click();
  await page.getByRole('treeitem', { name: 'c.md', exact: true }).click();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(second.locator('.markdown h1')).toHaveText('a');
  await expect(first.locator('.markdown h1')).toHaveText('d');
});

test('HTML focus routes shortcuts to its own pane, protects typing and supports file overrides', async ({ page }) => {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const settings = page.getByRole('main', { name: '设置页面' });
  await settings.getByRole('button', { name: '快捷键', exact: true }).click();
  await settings.getByLabel('HTML 内快捷键处理').selectOption('workbench');
  await settings.getByRole('button', { name: '返回工作台' }).click();
  await page.getByRole('treeitem', { name: 'a.html', exact: true }).dblclick();
  const first = pane(page, 0), second = pane(page, 1);
  await expect(first.locator('.bridge-state')).toHaveText('工作台快捷键优先');
  const frameA = page.frames().find(f => f.url().endsWith('/a.html'))!;
  await first.frameLocator('iframe').locator('body').click({position:{x:60,y:150}});
  await page.keyboard.press('f');
  await expect(page.locator('.shell')).toHaveClass(/immersive/);
  expect(await frameA.evaluate(()=>(window as unknown as {pageKeys:number}).pageKeys)).toBe(0);
  await first.frameLocator('iframe').locator('#draft').fill('输入');
  await page.keyboard.type('fb/?');
  await expect(first.frameLocator('iframe').locator('#draft')).toHaveValue('输入fb/?');
  await page.keyboard.press('Escape');
  await expect(page.locator('.shell')).not.toHaveClass(/immersive/);
  await page.getByLabel('阅读布局', { exact: true }).selectOption('columns');
  await second.getByRole('button', { name: '选择文件', exact: true }).click();
  await page.getByRole('treeitem', { name: 'b.html', exact: true }).click();
  await page.getByRole('treeitem', { name: 'c.html', exact: true }).click();
  await expect(second.locator('.bridge-state')).toHaveText('工作台快捷键优先');
  await first.frameLocator('iframe').locator('body').click({position:{x:60,y:150}});
  await second.frameLocator('iframe').locator('body').click({position:{x:60,y:150}});
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(second.getByRole('tab')).toHaveText('b.html');
  await expect(first.getByRole('tab')).toHaveText('a.html');
  await second.getByRole('button', { name: '更多设置' }).click();
  await second.getByLabel('此 HTML 快捷键').selectOption('web');
  await page.keyboard.press('Escape');
  await expect(second.locator('.bridge-state')).toHaveText('网页快捷键优先');
  await second.frameLocator('iframe').locator('body').click({position:{x:60,y:150}});
  await page.keyboard.press('f');
  await expect(page.locator('.shell')).not.toHaveClass(/immersive/);
  const frameB = page.frames().find(f=>f.url().endsWith('/b.html'))!;
  expect(await frameB.evaluate(()=>(window as unknown as {pageKeys:number}).pageKeys)).toBe(1);
});

test('HTML history restores document scroll and failed bridge exposes unavailable status', async ({ page }) => {
  await page.getByRole('treeitem', { name: 'a.html', exact: true }).click();
  const first = pane(page, 0);
  await expect(first.locator('.bridge-state')).toHaveAttribute('data-bridge-status','ready');
  const frame = page.frames().find(f=>f.url().endsWith('/a.html'))!;
  await frame.evaluate(()=>window.scrollTo(0,500));
  // Give the scroll bridge a rendering frame to report the reading position.
  await frame.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  await page.getByRole('treeitem', { name: 'b.html', exact: true }).click();
  await first.getByRole('button', { name: '后退', exact: true }).click();
  await expect.poll(async()=>page.frames().find(f=>f.url().endsWith('/a.html'))?.evaluate(()=>window.scrollY)).toBe(500);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('main', { name: '设置页面' }).getByRole('button', { name: '快捷键', exact: true }).click();
  await page.getByLabel('HTML 内快捷键处理').selectOption('workbench');
  await page.getByRole('button', { name: '返回工作台' }).click();
  await page.route('**/__agentdeck/bridge.js',route=>route.abort());
  await first.getByRole('button', { name: '刷新', exact: true }).click();
  await expect(first.locator('.bridge-state')).toContainText('当前页面未接管快捷键');
});

test('Escape closes only the current pane settings', async ({ page }) => {
  await page.getByRole('treeitem', { name: 'a.md', exact: true }).click();
  await page.getByLabel('阅读布局', { exact: true }).selectOption('columns');
  const first = pane(page, 0), second = pane(page, 1);
  await second.getByRole('button', { name: '选择文件', exact: true }).click();
  await page.getByRole('treeitem', { name: 'b.md', exact: true }).click();
  await first.getByRole('button', { name: '更多设置' }).click();
  await second.getByRole('button', { name: '更多设置' }).click();
  await page.keyboard.press('Escape');
  await expect(second.locator('[data-viewer-settings]')).toHaveCount(0);
  await expect(first.locator('[data-viewer-settings]')).toBeVisible();
});

test('Alt navigation wins over splitter and folder arrow handling', async ({ page }) => {
  await page.getByRole('treeitem', { name: 'a.md', exact: true }).click();
  await page.getByRole('treeitem', { name: 'b.md', exact: true }).click();
  await page.getByLabel('阅读布局', { exact: true }).selectOption('columns');
  const sidebar = page.getByRole('separator', { name: '调整侧栏宽度' });
  const split = page.getByRole('separator', { name: '调整阅读区比例' });
  const sidebarWidth = await sidebar.getAttribute('aria-valuenow');
  const ratio = await split.getAttribute('aria-valuenow');
  await sidebar.focus(); await page.keyboard.press('Alt+ArrowLeft');
  await expect(pane(page, 0).locator('.markdown h1')).toHaveText('a');
  await expect(sidebar).toHaveAttribute('aria-valuenow', sidebarWidth!);
  await split.focus(); await page.keyboard.press('Alt+ArrowRight');
  await expect(pane(page, 0).locator('.markdown h1')).toHaveText('b');
  await expect(split).toHaveAttribute('aria-valuenow', ratio!);
  const folder = page.getByRole('treeitem', { name: '阅读验证', exact: true });
  await folder.focus(); await page.keyboard.press('Alt+ArrowLeft');
  await expect(pane(page, 0).locator('.markdown h1')).toHaveText('a');
  await expect(folder).toHaveAttribute('aria-expanded', 'true');
});
