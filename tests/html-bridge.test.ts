import { describe, test, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createWorkbench } from '../app/server/server.js';
import { bridgeScriptPath, htmlBridgeScript, injectHtmlBridge } from '../app/server/html-bridge.js';
import { BRIDGE_MARKER, BRIDGE_VERSION, type BridgeConfig, type BridgeMessage } from '../app/shared/bridge.js';

const mainOrigin = 'http://127.0.0.1:4310';
const fullConfig: BridgeConfig = { mode: 'workbench', singles: true, navigation: true, escape: true, active: true };

class FakeElement {
  constructor(public tagName = 'DIV', public attributes: Record<string, string> = {}, public isContentEditable = false) {}
  getAttribute(key: string) { return this.attributes[key] ?? null; }
  hasAttribute(key: string) { return key in this.attributes; }
  setAttribute(key: string, value: string) { this.attributes[key] = value; }
  matches(selector: string) { return selector.startsWith('a[') && ['A', 'AREA'].includes(this.tagName) && this.hasAttribute('href'); }
}

function browser(embedded = true) {
  type Handler = (event: any) => void;
  const handlers = new Map<string, Handler[]>();
  const sent: BridgeMessage[] = [];
  const parent = { postMessage: (message: BridgeMessage, origin: string) => { expect(origin).toBe(mainOrigin); sent.push(message); } };
  const window = { parent: null as unknown, addEventListener: (type: string, fn: Handler) => handlers.set(type, [...handlers.get(type) || [], fn]), scrollTo: (_x: number, _y: number) => {} };
  window.parent = embedded ? parent : window;
  const document = { addEventListener: window.addEventListener, baseURI: 'http://127.0.0.1:4311/m/id/page.html' };
  vm.runInNewContext(htmlBridgeScript(mainOrigin), { window, document, location: { origin: 'http://127.0.0.1:4311' }, crypto: { randomUUID: () => 'session-one' }, Element: FakeElement, URL, requestAnimationFrame: (fn: () => void) => fn(), scrollX: 0, scrollY: 42 });
  const dispatch = (type: string, event = {}) => { for (const fn of handlers.get(type) || []) fn(event); };
  const configure = (config: BridgeConfig = fullConfig, extra: Record<string, unknown> = {}) => dispatch('message', { source: parent, origin: mainOrigin, data: { marker: BRIDGE_MARKER, version: BRIDGE_VERSION, session: 'session-one', type: 'config', config }, ...extra });
  const key = (key: string, extra: Record<string, unknown> = {}, nodes: FakeElement[] = []) => {
    const event = { key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, repeat: false, isComposing: false, keyCode: 0, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, composedPath: () => nodes, ...extra };
    dispatch('keydown', event); return event;
  };
  return { sent, dispatch, configure, key, parent };
}

describe('HTML response injection', () => {
  test('retains doctype, Unicode, charset and inserts before document scripts', () => {
    const html = '<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8"><script>网页脚本()</script></head><body>中文 🧭</body></html>';
    const result = injectHtmlBridge(html);
    expect(result).toBe(html.replace('<head>', `<head><script src="${bridgeScriptPath}"></script>`));
    expect(result.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(result.indexOf('charset')).toBeLessThan(1024);
    expect(injectHtmlBridge('<!doctype html><p>正文')).toMatch(/^<!doctype html><script/);
    expect(injectHtmlBridge('\uFEFF<p>片段')).toMatch(/^\uFEFF<script/);
    const commented = '<!doctype html><!-- example <head> --><html><head><title>标题</title></head></html>';
    expect(injectHtmlBridge(commented)).toContain(`--><html><head><script src="${bridgeScriptPath}"></script><title>`);
  });

  test('GET and HEAD lengths agree; download, raw text and assets remain original', async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-bridge-'));
    const root = path.join(temp, 'files'); await fs.mkdir(root);
    const html = '<!doctype html><html><head><meta charset="utf-8"></head><body>中文 🧭</body></html>';
    await fs.writeFile(path.join(root, 'index.html'), html);
    await fs.writeFile(path.join(root, 'data.csv'), 'x,y\n1,2');
    const app = await createWorkbench({ stateDir: path.join(temp, 'state'), port: 4310, previewPort: 4311 });
    const headers = { host: '127.0.0.1:4310', 'sec-fetch-site': 'same-origin', origin: mainOrigin, 'x-workbench': '1', 'content-type': 'application/json' };
    try {
      expect((await app.main.inject({ method: 'POST', url: '/api/projects', headers, payload: { name: '桥接', mount: { label: '网页', absolutePath: root } } })).statusCode).toBe(200);
      const id = app.registry.data.mounts[0].id;
      const previewHeaders = { host: '127.0.0.1:4311' };
      const url = `/m/${id}/index.html`;
      const get = await app.preview.inject({ url, headers: previewHeaders });
      const head = await app.preview.inject({ method: 'HEAD', url, headers: previewHeaders });
      expect(get.body).toBe(injectHtmlBridge(html));
      expect(Number(get.headers['content-length'])).toBe(Buffer.byteLength(get.body));
      expect(head.headers['content-length']).toBe(get.headers['content-length']); expect(head.body).toBe('');
      expect((await app.preview.inject({ url: bridgeScriptPath, headers: previewHeaders })).body).toBe(htmlBridgeScript(mainOrigin));
      expect((await app.main.inject({ url: `/api/mounts/${id}/download?path=index.html`, headers })).body).toBe(html);
      expect((await app.main.inject({ url: `/api/mounts/${id}/file?path=index.html`, headers })).json().text).toBe(html);
      expect((await app.preview.inject({ url: `/m/${id}/data.csv`, headers: previewHeaders })).body).toBe('x,y\n1,2');
      expect(await fs.readFile(path.join(root, 'index.html'), 'utf8')).toBe(html);
    } finally { await app.close(); await fs.rm(temp, { recursive: true, force: true }); }
  });
});

describe('bridge runtime', () => {
  test('requires parent source, origin, current session and explicit configuration', () => {
    const b = browser(); expect(b.sent[0].type).toBe('ready'); expect(b.key('f').prevented).toBe(false);
    b.configure(fullConfig, { origin: 'https://elsewhere.example' }); expect(b.key('f').prevented).toBe(false);
    b.configure(fullConfig, { source: {} }); expect(b.key('f').prevented).toBe(false);
    b.configure(fullConfig, { data: { marker: BRIDGE_MARKER, version: 1, session: 'stale', type: 'config', config: fullConfig } }); expect(b.key('f').prevented).toBe(false);
    b.configure(); expect(b.key('f')).toMatchObject({ prevented: true, stopped: true });
    expect(b.sent.at(-1)).toMatchObject({ type: 'action', action: 'immersive' });
    expect(b.sent.at(-2)?.type).toBe('focus');
    b.configure({ ...fullConfig, mode: 'web' }); expect(b.key('f').prevented).toBe(false);
    b.configure({ ...fullConfig, active: false }); expect(b.key('f').prevented).toBe(false);
  });

  test('protects editors, IME and repeats while blocking owned navigation', () => {
    const b = browser(); b.configure();
    for (const element of [new FakeElement('INPUT'), new FakeElement('SELECT'), new FakeElement('TEXTAREA'), new FakeElement('SPAN', { role: 'textbox' }), new FakeElement('DIV', {}, true)]) {
      expect(b.key('f', {}, [element]).prevented).toBe(false);
      expect(b.key('ArrowLeft', { altKey: true }, [element]).prevented).toBe(true);
    }
    expect(b.key('f', { isComposing: true }).prevented).toBe(false);
    b.dispatch('compositionstart'); expect(b.key('f').prevented).toBe(false); b.dispatch('compositionend');
    expect(b.key('f', { keyCode: 229 }).prevented).toBe(false);
    const before = b.sent.length; expect(b.key('f', { repeat: true }).prevented).toBe(true); expect(b.sent.length).toBe(before);
    expect(b.key('ArrowRight', { altKey: true }).prevented).toBe(true); expect(b.sent.at(-1)).toMatchObject({ action: 'forward' });
    expect(b.key('f', { ctrlKey: true }).prevented).toBe(false);
    b.configure({ ...fullConfig, escape: false, singles: false }); expect(b.key('Escape').prevented).toBe(false); expect(b.key('f').prevented).toBe(false);
    expect(b.key('ArrowLeft', { altKey: true }).prevented).toBe(true);
    b.configure({ ...fullConfig, navigation: false }); expect(b.key('ArrowLeft', { altKey: true }).prevented).toBe(false);
  });

  test('external links use a new browser tab even when top level; local navigation and downloads stay intact', () => {
    const b = browser(false); b.configure(); expect(b.key('f').prevented).toBe(false); expect(b.sent).toEqual([]);
    const link = new FakeElement('A', { href: 'https://example.com/report', rel: 'author' });
    b.dispatch('click', { composedPath: () => [new FakeElement('SPAN'), link] });
    expect(link.attributes).toMatchObject({ target: '_blank', rel: 'author noopener noreferrer' });
    for (const href of ['#section', './other.html', '?query=yes', 'mailto:a@example.com']) {
      const local = new FakeElement('A', { href }); b.dispatch('click', { composedPath: () => [local] }); expect(local.hasAttribute('target')).toBe(false);
    }
    const download = new FakeElement('A', { href: 'https://example.com/file', download: '' });
    b.dispatch('click', { composedPath: () => [download] }); expect(download.hasAttribute('target')).toBe(false);
  });
});
