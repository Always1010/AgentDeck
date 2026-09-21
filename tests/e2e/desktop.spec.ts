import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

let directory: string;
async function json(page: Page, url: string, method = 'GET', body?: unknown) {
  return page.evaluate(async ({ url, method, body }) => {
    const response = await fetch(url, { method, headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Workbench': '1' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }, { url, method, body });
}
test.beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-desktop-'));
  await fs.writeFile(path.join(directory, 'index.html'), '<title>布局验证工具</title><label>输入<input id="draft"></label><div style="height:5000px">长内容</div>');
});
test.afterAll(async () => { await fs.rm(directory, { recursive: true, force: true }); });
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  const snapshot = await json(page, '/api/projects');
  for (const project of snapshot.projects) await json(page, `/api/projects/${project.id}`, 'DELETE');
  await json(page, '/api/projects', 'POST', { name: '桌面布局验证', mount: { label: '工具目录', absolutePath: directory, mode: 'single-tool' } });
  await page.getByRole('treeitem',{name:'桌面布局验证',exact:true}).click();await page.getByRole('treeitem',{name:'index.html',exact:true}).click();
  await expect(page.frameLocator('iframe').locator('#draft')).toBeVisible();
});

test('sidebar resize and collapse persist without replacing the document',async({page})=>{
 await page.setViewportSize({width:1440,height:900});const input=page.frameLocator('iframe').locator('#draft');await input.fill('保持输入');
 const separator=page.getByRole('separator',{name:'调整侧栏宽度'});await separator.focus();await page.keyboard.press('Home');await expect(separator).toHaveAttribute('aria-valuenow','200');await page.keyboard.press('End');await expect(separator).toHaveAttribute('aria-valuenow','440');await page.keyboard.press('ArrowLeft');await expect(separator).toHaveAttribute('aria-valuenow','430');
 await expect(input).toHaveValue('保持输入');await page.getByRole('button',{name:'收起文件侧栏'}).click();await expect(page.locator('.explorer')).toBeHidden();await page.reload();await expect(page.locator('.explorer')).toBeHidden();await page.getByRole('button',{name:'展开文件侧栏'}).click();await expect(separator).toHaveAttribute('aria-valuenow','430');
});
