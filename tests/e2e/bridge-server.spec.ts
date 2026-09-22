import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('injected bridge intercepts before page handlers, preserves editors, and routes external links independently', async ({ page, context }) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-bridge-browser-'));
  await fs.writeFile(path.join(root, 'probe.html'), `<!doctype html><html><head><meta charset="utf-8"><script>
    window.pageKeys = [];
    window.pageReleases = [];
    window.addEventListener('keydown', event => window.pageKeys.push(event.key), true);
    window.addEventListener('keyup', event => window.pageReleases.push(event.key), true);
  </script></head><body style="min-height:650px"><h1>中文桥接</h1><input id="draft"><div contenteditable="true" id="editor"></div>
  <a id="external" href="https://example.com/bridge-test">外链</a><a id="local" href="#section">目录</a><section id="section">章节</section></body></html>`);
  let projectId: string | undefined;
  try {
    await page.goto('/');
    const project = await page.evaluate(async root => {
      const result = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workbench': '1' }, body: JSON.stringify({ name: '桥接集成验证', mount: { label: '页面', absolutePath: root } }) });
      return result.json();
    }, root);
    projectId = project.id;
    const mountId = await page.evaluate(async projectId => {
      const data = await (await fetch('/api/projects')).json();
      return data.mounts.find((m: { projectId: string }) => m.projectId === projectId).id as string;
    }, projectId);
    const url = `http://127.0.0.1:4411/m/${mountId}/probe.html`;
    // A minimal host on the real workbench origin exercises the server contract independently of React UI.
    await page.evaluate(url => {
      document.body.innerHTML = '<iframe id="bridge-probe" style="width:800px;height:600px"></iframe>';
      const frame = document.querySelector<HTMLIFrameElement>('#bridge-probe')!;
      const state = window as unknown as { bridgeMessages: { type: string; action?: string }[]; bridgeConfig: Record<string, unknown>; bridgeSession: string; configureBridge: () => void };
      state.bridgeMessages = [];
      state.bridgeConfig = { mode: 'workbench', singles: true, navigation: true, escape: true, active: true };
      state.configureBridge = () => frame.contentWindow!.postMessage({ marker: 'agentdeck-bridge', version: 1, session: state.bridgeSession, type: 'config', config: state.bridgeConfig }, 'http://127.0.0.1:4411');
      window.addEventListener('message', event => {
        if (event.source !== frame.contentWindow || event.origin !== 'http://127.0.0.1:4411' || event.data?.marker !== 'agentdeck-bridge') return;
        state.bridgeMessages.push(event.data);
        if (event.data.type === 'ready') { state.bridgeSession = event.data.session; state.configureBridge(); }
      });
      frame.src = url;
    }, url);
    const frame = page.frameLocator('#bridge-probe');
    await expect(frame.getByRole('heading')).toHaveText('中文桥接');
    await expect.poll(() => page.evaluate(() => (window as any).bridgeMessages.some((m: any) => m.type === 'ready'))).toBe(true);
    await frame.locator('body').click({ position: { x: 600, y: 300 } });
    await page.keyboard.press('f');
    await expect.poll(() => page.evaluate(() => (window as any).bridgeMessages.some((m: any) => m.action === 'immersive'))).toBe(true);
    const child = page.frames().find(f => f.url() === url)!;
    expect(await child.evaluate(() => (window as any).pageKeys)).not.toContain('f');
    expect(await child.evaluate(() => (window as any).pageReleases)).not.toContain('f');
    await frame.locator('#draft').fill(''); await frame.locator('#draft').press('f'); await expect(frame.locator('#draft')).toHaveValue('f');
    await frame.locator('#editor').press('b'); await expect(frame.locator('#editor')).toHaveText('b');
    await frame.locator('#draft').press('Alt+ArrowLeft');
    await expect.poll(() => page.evaluate(() => (window as any).bridgeMessages.some((m: any) => m.action === 'back'))).toBe(true);
    expect(await child.evaluate(() => (window as any).pageReleases)).not.toContain('ArrowLeft');
    expect(page.url()).toBe('http://127.0.0.1:4410/');
    await page.evaluate(() => { (window as any).bridgeConfig.mode = 'web'; (window as any).configureBridge(); });
    const releasesBefore = await child.evaluate(() => (window as any).pageReleases.filter((key: string) => key === 'f').length);
    await frame.locator('body').click({ position: { x: 600, y: 300 } }); await page.keyboard.press('f');
    await expect.poll(() => child.evaluate(() => (window as any).pageKeys.includes('f'))).toBe(true);
    await expect.poll(() => child.evaluate(() => (window as any).pageReleases.filter((key: string) => key === 'f').length)).toBe(releasesBefore + 1);
    await context.route('https://example.com/bridge-test', route => route.fulfill({ contentType: 'text/html', body: '<h1>external</h1>' }));
    const popupEvent = page.waitForEvent('popup'); await frame.locator('#external').click(); const popup = await popupEvent;
    await popup.waitForLoadState(); expect(popup.url()).toBe('https://example.com/bridge-test'); expect(await popup.evaluate(() => window.opener)).toBeNull(); await popup.close();
    await frame.locator('#local').click(); expect(child.url()).toBe(`${url}#section`);
    const raw = await context.newPage(); await raw.goto(url); await raw.locator('body').click({ position: { x: 600, y: 300 } }); await raw.keyboard.press('f');
    expect(await raw.evaluate(() => (window as any).pageKeys)).toContain('f'); await raw.close();
  } finally {
    if (projectId) await page.evaluate(async id => { await fetch(`/api/projects/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', 'X-Workbench': '1' }, body: '{}' }); }, projectId).catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  }
});
