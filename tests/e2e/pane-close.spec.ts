import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

let root: string;
const pane = (page: Page, index: number) => page.locator(`[data-pane="${index}"]`);
test.beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-pane-close-'));
  for (const name of ['a', 'b', 'c', 'd']) {
    await fs.writeFile(path.join(root, `${name}.html`), `<title>${name}</title><input id="draft"><div style="height:3000px">${name}</div><script>window.pageKeys=0;window.addEventListener('keydown',e=>{if(e.key==='f')window.pageKeys++;},true)</script>`);
    await fs.writeFile(path.join(root, `${name}.md`), `# ${name}\n\n${'阅读内容\n\n'.repeat(200)}`);
    await fs.writeFile(path.join(root, `${name}.txt`), `纯文本 ${name}\n`);
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
    await request('/api/projects', 'POST', { name: '关闭验证', mount: { label: '文件', absolutePath: root } });
  }, root);
  await page.getByRole('treeitem', { name: '关闭验证', exact: true }).click();
});


test('pane close button collapses its split and leaves the sibling HTML instance intact', async ({ page }) => {
  await page.getByRole('treeitem', { name: 'a.html', exact: true }).dblclick();
  await pane(page, 0).frameLocator('iframe').locator('#draft').fill('保留输入');
  await page.getByRole('button', { name: '左右分屏', exact: true }).click();
  await pane(page, 1).getByRole('button', { name: '关闭阅读区 2', exact: true }).click();
  await expect(page.locator('.reading-pane')).toHaveCount(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(pane(page, 0).frameLocator('iframe').locator('#draft')).toHaveValue('保留输入');
  await expect(pane(page, 0).getByRole('tab')).toBeFocused();
  await page.reload();
  await expect(page.locator('.reading-pane')).toHaveCount(1);
  await expect(pane(page, 0).getByRole('tab')).toHaveText('a.html');
});

test('Q confirms multiple tabs with the confirm button focused; Escape cancels and Enter closes', async ({ page }) => {
  await page.getByRole('treeitem', { name: 'a.md', exact: true }).dblclick();
  await page.keyboard.press('e');
  await page.getByRole('treeitem', { name: 'b.md', exact: true }).dblclick();
  await pane(page, 1).getByRole('tab', { name: 'b.md', exact: true }).click();
  await page.keyboard.press('q');
  const dialog = page.getByRole('dialog', { name: '关闭阅读区' });
  await expect(dialog).toContainText('2 个标签页');
  await page.screenshot({ path: 'test-results/pane-close-confirm.png' });
  await expect(dialog.getByRole('button', { name: '确定关闭', exact: true })).toBeFocused();
  await page.keyboard.press('q');
  await expect(page.locator('.reading-pane')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(pane(page, 1).getByRole('tab')).toHaveCount(2);
  await pane(page, 1).getByRole('button', { name: '关闭阅读区 2', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '确定关闭', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.reading-pane')).toHaveCount(1);
  await expect(pane(page, 0).getByRole('tab')).toBeFocused();
});

test('pane confirmation preference persists and Q clears the final pane while W remains tab-only', async ({ page }) => {
  await page.getByRole('treeitem', { name: 'a.md', exact: true }).dblclick();
  await page.getByRole('treeitem', { name: 'b.md', exact: true }).dblclick();
  await pane(page, 0).getByRole('tab', { name: 'b.md', exact: true }).click();
  await page.keyboard.press('w');
  await expect(pane(page, 0).getByRole('tab')).toHaveCount(1);
  await page.getByRole('treeitem', { name: 'b.md', exact: true }).dblclick();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '阅读布局', exact: true }).click();
  await page.getByRole('checkbox', { name: '关闭阅读区时提示确认', exact: true }).uncheck();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.reload();
  await expect(pane(page, 0).getByRole('tab')).toHaveCount(2);
  await pane(page, 0).getByRole('tab', { name: 'b.md', exact: true }).click();
  await page.keyboard.press('q');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.reading-pane')).toHaveCount(1);
  await expect(pane(page, 0).getByRole('tab')).toHaveCount(0);
  await expect(pane(page, 0).getByRole('button', { name: '后退', exact: true })).toBeDisabled();
  await expect(pane(page, 0).getByRole('button', { name: '关闭阅读区 1', exact: true })).toBeVisible();
  await page.reload();
  await expect(pane(page, 0).getByRole('tab')).toHaveCount(0);
  await expect(pane(page, 0).getByRole('button', { name: '关闭阅读区 1', exact: true })).toBeVisible();
});

test('HTML workbench Q respects input focus and closes a maximized pane', async ({ page }) => {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('dialog', { name: '设置', exact: true }).getByRole('button', { name: '快捷键', exact: true }).click();
  await page.getByRole('dialog', { name: '设置', exact: true }).getByLabel('HTML 内快捷键处理').selectOption('workbench');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByRole('treeitem', { name: 'a.html', exact: true }).dblclick();
  await page.getByRole('button', { name: '左右分屏', exact: true }).click();
  const right = pane(page, 1);
  await right.getByRole('tab').click();
  await page.keyboard.press('x');
  const input = right.frameLocator('iframe').locator('#draft');
  await input.fill('draft');
  await input.press('q');
  await expect(page.locator('.reading-pane')).toHaveCount(2);
  const frame = page.frames().filter(f => f.url().endsWith('/a.html')).at(-1)!;
  await frame.evaluate(() => { (document.activeElement as HTMLElement).blur(); document.body.tabIndex = -1; document.body.focus(); });
  await page.keyboard.press('q');
  await expect(page.locator('.reading-pane')).toHaveCount(1);
  await expect(pane(page, 0)).toBeVisible();
});


test('holding Q removes only the initial pane and never cascades into the next pane', async ({ page }) => {
  await page.getByRole('treeitem', { name: 'a.md', exact: true }).dblclick();
  await page.keyboard.press('e');
  await pane(page, 1).getByRole('tab').click();
  await page.keyboard.down('q');
  await expect(page.locator('.reading-pane')).toHaveCount(1);
  await expect(pane(page, 0).getByRole('tab')).toBeFocused();
  await page.keyboard.down('q');
  await page.keyboard.down('q');
  await page.keyboard.up('q');
  await expect(pane(page, 0).getByRole('tab')).toHaveText('a.md');
  await page.keyboard.press('q');
  await expect(pane(page, 0).getByRole('tab')).toHaveCount(0);
});
