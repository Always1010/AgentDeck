import { test, expect } from '@playwright/test';

test('directory picker preserves new input and ignores superseded directory responses', async ({ page }) => {
  let releaseLocations!: () => void;
  let locationsStarted!: () => void;
  const locationsGate = new Promise<void>(resolve => { releaseLocations = resolve; });
  const locationsReceived = new Promise<void>(resolve => { locationsStarted = resolve; });
  await page.route('**/api/fs/locations', async route => {
    locationsStarted(); await locationsGate;
    await route.fulfill({ json: { locations: ['C:\\initial'] } });
  });
  let releaseSlow!: () => void;
  let slowStarted!: () => void;
  const slowGate = new Promise<void>(resolve => { releaseSlow = resolve; });
  const slowReceived = new Promise<void>(resolve => { slowStarted = resolve; });
  let releaseFast!: () => void;
  let fastStarted!: () => void;
  const fastGate = new Promise<void>(resolve => { releaseFast = resolve; });
  const fastReceived = new Promise<void>(resolve => { fastStarted = resolve; });
  const requests: string[] = [];
  await page.route('**/api/fs/directories?*', async route => {
    const current = new URL(route.request().url()).searchParams.get('absolutePath')!;
    requests.push(current);
    if (current === 'C:\\slow') { slowStarted(); await slowGate; }
    if (current === 'C:\\fast') { fastStarted(); await fastGate; }
    await route.fulfill({ json: { current, parent: 'C:\\', directories: [{ name: current === 'C:\\fast' ? '最新目录' : '旧目录', path: current + '\\child' }] } }).catch(() => undefined);
  });
  await page.goto('/');
  await page.locator('.explorer-header').getByRole('button', { name: '添加项目', exact: true }).click();
  await page.getByRole('button', { name: '选择本机文件夹', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '选择本机目录', exact: true });
  await locationsReceived;
  await picker.getByLabel('当前位置').fill('C:\\slow');
  releaseLocations();
  await expect(picker.getByRole('button', { name: 'C:\\initial', exact: true })).toBeVisible();
  await expect(picker.getByLabel('当前位置')).toHaveValue('C:\\slow');
  expect(requests).toEqual([]);
  await picker.getByRole('button', { name: '前往', exact: true }).click();
  await slowReceived;
  await expect(picker.getByRole('button', { name: '选择此目录', exact: true })).toBeDisabled();
  await picker.getByLabel('当前位置').fill('C:\\fast');
  await picker.getByRole('button', { name: '前往', exact: true }).click();
  await fastReceived;
  await picker.getByLabel('当前位置').fill('C:\\正在编辑');
  releaseFast();
  await expect(picker.getByRole('button', { name: '▸ 最新目录', exact: true })).toBeVisible();
  await expect(picker.getByLabel('当前位置')).toHaveValue('C:\\正在编辑');
  releaseSlow();
  await expect(picker.getByRole('button', { name: '▸ 旧目录', exact: true })).toHaveCount(0);
  await picker.getByRole('button', { name: '选择此目录', exact: true }).click();
  await expect(page.getByLabel('真实绝对路径')).toHaveValue('C:\\fast');
});
