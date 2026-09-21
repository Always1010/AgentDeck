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
  await page.locator('.entry').filter({ hasText: '布局验证工具' }).click();
  await expect(page.frameLocator('iframe').locator('#draft')).toBeVisible();
});

test('desktop orientation, collapse and immersion preserve the same tool and scroll', async ({ page }) => {
  const input = page.frameLocator('iframe').locator('#draft');
  await input.fill('跨屏保留输入');
  const frame = page.frames().find(f => f.url().includes('/m/'))!;
  await frame.evaluate(() => { window.scrollTo(0, 400); (window as Window & { marker?: string }).marker = 'same-document'; });
  for (const [width, height] of [[1920, 1080], [1080, 1920], [1440, 2560], [900, 1440], [1280, 720]]) {
    await page.setViewportSize({ width, height });
    const catalog = (await page.locator('.catalog').boundingBox())!;
    const viewer = (await page.locator('.viewer').boundingBox())!;
    if (width <= height) {
      expect(viewer.width).toBe(width);
      expect(viewer.y).toBeGreaterThanOrEqual(catalog.y + catalog.height - 1);
      expect(viewer.height).toBeGreaterThan(height * .5);
    } else {
      expect(viewer.x).toBeGreaterThan(catalog.x);
      expect(viewer.width).toBeGreaterThan(width * .5);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(input).toHaveValue('跨屏保留输入');
    expect(await frame.evaluate(() => (window as Window & { marker?: string }).marker)).toBe('same-document');
    expect(await frame.evaluate(() => scrollY)).toBe(400);
    await page.screenshot({ path: `test-results/desktop-${width}x${height}.png` });
  }
  await page.getByRole('button', { name: '内容列表', exact: true }).click();
  await expect(page.locator('.catalog')).toBeHidden();
  await page.getByRole('button', { name: '沉浸', exact: true }).click();
  await expect(page.locator('aside')).toBeHidden();
  await page.getByRole('button', { name: '退出沉浸', exact: true }).click();
  await expect(page.locator('.catalog')).toBeHidden();
  await expect(input).toHaveValue('跨屏保留输入');
  await page.getByRole('button', { name: '内容列表', exact: true }).click();
  await expect(page.locator('.catalog')).toBeVisible();
});

test('desktop list width and visibility persist, filters have a recovery action', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const divider = page.getByRole('separator', { name: '调整内容列表宽度' });
  await divider.focus(); await page.keyboard.press('End');
  await expect(divider).toHaveAttribute('aria-valuenow', '420');
  await page.reload();
  await expect(divider).toHaveAttribute('aria-valuenow', '420');
  expect((await page.locator('.catalog').boundingBox())!.width).toBe(420);
  await page.getByRole('button', { name: '项目导航', exact: true }).click();
  await page.reload(); await expect(page.locator('aside')).toBeHidden();
  await page.getByLabel('搜索', { exact: true }).fill('没有这个文件');
  await expect(page.getByText('没有匹配的内容', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清除筛选' }).click();
  await expect(page.locator('.entry')).toHaveCount(1);
  await page.getByLabel('排序', { exact: true }).selectOption('name');
  await page.reload(); await expect(page.getByLabel('排序', { exact: true })).toHaveValue('name');
});


