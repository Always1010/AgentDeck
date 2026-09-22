import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { ReadingSnapshot } from '../../app/web/readingSessions.js';

let root: string;
const pane = (page: Page, id: number) => page.locator(`.reading-pane[data-pane="${id}"]`);
const sessionId = (page: Page) => new URL(page.url()).searchParams.get('ws')!;
const file = (page: Page, name: string) => page.getByRole('treeitem', { name, exact: true });
type Saved = { id: string; updatedAt: number; activeAt: number; snapshot: ReadingSnapshot };
async function saved(page: Page, id = sessionId(page)): Promise<Saved | null> {
  return page.evaluate(id => new Promise<Saved | null>((resolve, reject) => {
    const request = indexedDB.open('agentdeck-reading-sessions', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('sessions', 'readonly');
      const record = tx.objectStore('sessions').get(id);
      tx.oncomplete = () => { db.close(); resolve(record.result || null); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), id);
}
async function waitSaved(page: Page, condition: (snapshot: ReadingSnapshot) => boolean) {
  await expect.poll(async () => { const record = await saved(page); return !!record && condition(record.snapshot); }).toBe(true);
}

test.beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-sessions-'));
  for (const name of ['a', 'b', 'c', 'd']) await fs.writeFile(path.join(root, `${name}.md`), `# ${name}\n\n${'持久阅读现场。\n\n'.repeat(160)}`);
  await fs.writeFile(path.join(root, 'report.html'), '<title>HTML 阅读现场</title><input id="draft"><div style="height:5000px">持久阅读位置</div>');
});
test.afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto('/');
  await expect(page).toHaveURL(/\bws=/);
  await page.evaluate(async root => {
    const request = async (url: string, method = 'GET', body?: unknown) => {
      const response = await fetch(url, { method, headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Workbench': '1' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    };
    const projects = await request('/api/projects');
    for (const project of projects.projects) await request(`/api/projects/${project.id}`, 'DELETE');
    await request('/api/projects', 'POST', { name: '现场验证', mount: { label: '文件', absolutePath: root } });
  }, root);
  await file(page, '现场验证').click();
});

test('reload restores mixed layout, proportions, pinned tabs, local history, scroll and maximization', async ({ page }) => {
  await file(page, 'a.md').dblclick();
  await file(page, 'b.md').click();
  await file(page, 'c.md').click();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(pane(page, 0).getByRole('tab', { name: 'b.md', exact: true })).toHaveAttribute('aria-selected', 'true');
  await pane(page, 0).getByRole('tab', { name: 'b.md', exact: true }).dblclick();
  await page.keyboard.press('e');
  await file(page, 'c.md').click();
  await page.keyboard.press('o');
  await file(page, 'd.md').click();
  await expect(page.locator('.reading-pane')).toHaveCount(3);
  const divider = page.getByRole('separator', { name: '调整阅读区比例' }).first();
  const box = await divider.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + 55, box!.y + box!.height / 2);
  await page.mouse.up();
  const ratio = await divider.getAttribute('aria-valuenow');
  await pane(page, 0).locator('.viewer:not([hidden]) .reader').evaluate(element => { element.scrollTop = 480; });
  await pane(page, 1).getByRole('tab').click();
  await page.keyboard.press('x');
  await waitSaved(page, state => state.workspace.maximized === 1 && Object.keys(state.workspace.panes).length === 3 && Object.values(state.positions).some(position => position.y === 480));
  const original = (await saved(page))!.snapshot;
  const id = sessionId(page);
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`ws=${id}`));
  await expect(pane(page, 1)).toBeVisible();
  await expect(pane(page, 0)).toBeHidden();
  await expect(pane(page, 2)).toBeHidden();
  await page.getByRole('button', { name: '恢复分屏', exact: true }).click();
  await expect(pane(page, 0).getByRole('tab')).toHaveText(['a.md', 'b.md']);
  await expect(pane(page, 0).locator('.page-tab.temporary')).toHaveCount(0);
  await expect(pane(page, 1).getByRole('tab')).toHaveText('c.md');
  await expect(pane(page, 2).getByRole('tab')).toHaveText('d.md');
  await expect(divider).toHaveAttribute('aria-valuenow', ratio!);
  await expect.poll(() => pane(page, 0).locator('.viewer:not([hidden]) .reader').evaluate(element => element.scrollTop)).toBe(480);
  await expect(file(page, 'a.md')).toBeVisible();
  await pane(page, 0).getByRole('tab', { name: 'b.md', exact: true }).click();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(pane(page, 0).getByRole('tab', { name: 'c.md', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(pane(page, 0).getByRole('tab')).toHaveCount(3);
  expect(original.workspace.histories[0].entries.at(-1)).toMatch(/:c\.md$/);
});

test('duplicating an active scene creates a durable independent copy and each reload keeps its own scene', async ({ page, context }) => {
  await file(page, 'a.md').dblclick();
  await waitSaved(page, state => state.workspace.panes[0].active.endsWith(':a.md'));
  const firstId = sessionId(page);
  const duplicate = await context.newPage();
  await duplicate.setViewportSize({ width: 1500, height: 1000 });
  await duplicate.goto(page.url());
  await expect.poll(() => sessionId(duplicate)).not.toBe(firstId);
  const secondId = sessionId(duplicate);
  expect(secondId).toBeTruthy();
  await expect(pane(duplicate, 0).getByRole('tab')).toHaveText('a.md');
  await file(duplicate, 'c.md').click();
  await duplicate.keyboard.press('e');
  await file(duplicate, 'd.md').click();
  await waitSaved(duplicate, state => Object.keys(state.workspace.panes).length === 2 && state.workspace.panes[1].active.endsWith(':d.md'));
  await page.bringToFront();
  await file(page, 'b.md').click();
  await waitSaved(page, state => state.workspace.panes[0].active.endsWith(':b.md'));
  await page.reload();
  expect(sessionId(page)).toBe(firstId);
  await expect(page.locator('.reading-pane')).toHaveCount(1);
  await expect(pane(page, 0).getByRole('tab')).toHaveText(['a.md', 'b.md']);
  await duplicate.reload();
  expect(sessionId(duplicate)).toBe(secondId);
  await expect(duplicate.locator('.reading-pane')).toHaveCount(2);
  await expect(pane(duplicate, 0).getByRole('tab')).toHaveText(['a.md', 'c.md']);
  await expect(pane(duplicate, 1).getByRole('tab')).toHaveText('d.md');
});

test('a closed browser page restores its original scene URL instead of creating another copy', async ({ page, context }) => {
  await file(page, 'a.md').click();
  await page.keyboard.press('o');
  await file(page, 'b.md').click();
  await waitSaved(page, state => Object.keys(state.workspace.panes).length === 2 && state.workspace.panes[1].active.endsWith(':b.md'));
  const url = page.url(), id = sessionId(page);
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(url);
  await expect(reopened.locator('.reading-pane')).toHaveCount(2);
  expect(sessionId(reopened)).toBe(id);
  await expect(pane(reopened, 0).getByRole('tab')).toHaveText('a.md');
  await expect(pane(reopened, 1).getByRole('tab')).toHaveText('b.md');
});

test('opening the home page copies the last foreground scene, ignoring later background scroll saves', async ({ page, context }) => {
  await file(page, 'a.md').dblclick();
  await waitSaved(page, state => state.workspace.panes[0].active.endsWith(':a.md'));
  const other = await context.newPage();
  await other.goto('/');
  await expect(pane(other, 0).getByRole('tab')).toHaveText('a.md');
  await file(other, 'b.md').click();
  await waitSaved(other, state => state.workspace.panes[0].active.endsWith(':b.md'));
  const otherActiveAt = (await saved(other))!.activeAt;
  await page.bringToFront();
  await file(page, 'c.md').click();
  await waitSaved(page, state => state.workspace.panes[0].active.endsWith(':c.md'));
  expect((await saved(page))!.activeAt).toBeGreaterThan(otherActiveAt);
  await other.locator('.viewer:not([hidden]) .reader').evaluate(element => { element.scrollTop = 300; });
  await waitSaved(other, state => Object.values(state.positions).some(position => position.y === 300));
  expect((await saved(other))!.activeAt).toBe(otherActiveAt);
  const newest = await context.newPage();
  await newest.goto('/');
  await expect(pane(newest, 0).getByRole('tab')).toHaveText(['a.md', 'c.md']);
  expect(sessionId(newest)).not.toBe(sessionId(page));
});

test('an HTML pane hidden during reload restores its scroll when the maximized neighbor is restored', async ({ page }) => {
  await file(page, 'report.html').dblclick();
  await expect(pane(page, 0).frameLocator('iframe').locator('#draft')).toBeVisible();
  await expect(pane(page, 0).locator('.bridge-state')).toHaveAttribute('data-bridge-status', 'ready');
  await page.frames().find(frame => frame.url().endsWith('/report.html'))!.evaluate(() => window.scrollTo(0, 420));
  await waitSaved(page, state => Object.values(state.positions).some(position => position.y === 420));
  await pane(page, 0).getByRole('tab').click();
  await page.keyboard.press('e');
  await file(page, 'b.md').click();
  await page.keyboard.press('x');
  await waitSaved(page, state => state.workspace.maximized === 1);
  await page.reload();
  await expect(pane(page, 0)).toBeHidden();
  await page.getByRole('button', { name: '恢复分屏', exact: true }).click();
  await expect(pane(page, 0)).toBeVisible();
  await expect.poll(async () => page.frames().find(frame => frame.url().endsWith('/report.html'))?.evaluate(() => window.scrollY)).toBe(420);
});

test('recent scenes can restore a live scene as another independent browser page', async ({ page, context }) => {
  await file(page, 'a.md').dblclick();
  await waitSaved(page, state => state.workspace.panes[0].active.endsWith(':a.md'));
  const originalId = sessionId(page);
  const other = await context.newPage();
  await other.goto('/');
  await file(other, 'b.md').click();
  await waitSaved(other, state => state.workspace.panes[0].active.endsWith(':b.md'));
  await other.getByRole('button', { name: '设置', exact: true }).click();
  const settings = other.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: '阅读现场', exact: true }).click();
  await expect(settings.getByRole('heading', { name: '最近阅读现场' })).toBeVisible();
  await expect(settings.getByText('当前现场', { exact: true })).toBeVisible();
  const restoredPage = context.waitForEvent('page');
  await settings.locator(`a[href="/?ws=${originalId}"]`).click();
  const restored = await restoredPage;
  await expect(pane(restored, 0).getByRole('tab')).toHaveText('a.md');
  expect(sessionId(restored)).not.toBe(originalId);
  expect(sessionId(restored)).not.toBe(sessionId(other));
  expect((await saved(page))!.snapshot.workspace.panes[0].active).toMatch(/:a\.md$/);
});

test('an explicit file link opens its target in a new scene without overwriting the latest saved workspace', async ({ page, context }) => {
  await file(page, 'a.md').dblclick();
  await page.keyboard.press('e');
  await file(page, 'b.md').click();
  await waitSaved(page, state => state.workspace.panes[1]?.active.endsWith(':b.md'));
  const original = (await saved(page))!.snapshot.workspace;
  const target = original.panes[0].active.replace(/:a\.md$/, ':d.md');
  const linked = await context.newPage();
  await linked.goto(`/?entry=${encodeURIComponent(target)}`);
  await expect(linked.locator('.reading-pane')).toHaveCount(1);
  await expect(pane(linked, 0).getByRole('tab')).toHaveText('d.md');
  await waitSaved(linked, state => state.workspace.panes[0].active === target);
  expect(sessionId(linked)).not.toBe(sessionId(page));
  expect((await saved(page))!.snapshot.workspace).toEqual(original);
});

test('unavailable browser storage displays the save failure while file reading remains usable', async ({ page, context }) => {
  await file(page, 'a.md').click();
  await waitSaved(page, state => state.workspace.panes[0].active.endsWith(':a.md'));
  const unavailable = await context.newPage();
  await unavailable.addInitScript(() => Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined }));
  await unavailable.goto('/');
  await expect(unavailable.getByRole('alert')).toContainText('当前阅读现场无法保存');
  await file(unavailable, '现场验证').click();
  await file(unavailable, 'b.md').click();
  await expect(pane(unavailable, 0).locator('.markdown h1')).toHaveText('b');
  expect((await saved(page))!.snapshot.workspace.panes[0].active).toMatch(/:a\.md$/);
});

test('a real browser relaunch with the same profile restores the scene, proportions and file history', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-scene-profile-'));
  let browser: BrowserContext | undefined;
  const launch = () => chromium.launchPersistentContext(profile, {
    headless: true,
    channel: testInfo.project.use.channel || process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined),
    viewport: { width: 1500, height: 1000 },
  });
  try {
    browser = await launch();
    const first = browser.pages()[0] || await browser.newPage();
    await first.goto(new URL(page.url()).origin);
    await file(first, '现场验证').click();
    await file(first, 'a.md').click();
    await file(first, 'b.md').click();
    await pane(first, 0).getByRole('tab').dblclick();
    await first.keyboard.press('e');
    await file(first, 'c.md').click();
    const divider = first.getByRole('separator', { name: '调整阅读区比例' });
    const box = await divider.boundingBox();
    await first.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await first.mouse.down();
    await first.mouse.move(box!.x + 60, box!.y + box!.height / 2);
    await first.mouse.up();
    const ratio = await divider.getAttribute('aria-valuenow');
    await waitSaved(first, state => state.workspace.root.type === 'split' && Math.round(state.workspace.root.ratio) === Number(ratio) && state.workspace.panes[1].active.endsWith(':c.md'));
    const url = first.url(), id = sessionId(first);
    await browser.close();
    browser = undefined;

    // Launch a different browser process, retaining only the on-disk profile and original scene URL.
    browser = await launch();
    const restored = browser.pages()[0] || await browser.newPage();
    await restored.goto(url);
    await expect(restored.locator('.reading-pane')).toHaveCount(2);
    expect(sessionId(restored)).toBe(id);
    await expect(pane(restored, 0).getByRole('tab')).toHaveText('b.md');
    await expect(pane(restored, 0).locator('.page-tab.temporary')).toHaveCount(0);
    await expect(pane(restored, 1).getByRole('tab')).toHaveText('c.md');
    await expect(restored.getByRole('separator', { name: '调整阅读区比例' })).toHaveAttribute('aria-valuenow', ratio!);
    await pane(restored, 0).getByRole('tab').click();
    await restored.keyboard.press('Alt+ArrowLeft');
    await expect(pane(restored, 0).getByRole('tab')).toHaveText(['b.md', 'a.md']);
    await expect(pane(restored, 0).getByRole('tab', { name: 'a.md', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(pane(restored, 1).getByRole('tab')).toHaveText('c.md');
  } finally {
    await browser?.close();
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
});
