import { describe, test, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createWorkbench } from '../app/server/server.js';
import { bridgeScriptPath, htmlBridgePrefixLimit, htmlBridgeScript, injectHtmlBridge, planHtmlBridge, prepareHtmlBridge } from '../app/server/html-bridge.js';
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
  const keyboard = (type: 'keydown' | 'keyup', key: string, extra: Record<string, unknown> = {}, nodes: FakeElement[] = []) => {
    const event = { key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, repeat: false, isComposing: false, keyCode: 0, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, composedPath: () => nodes, ...extra };
    dispatch(type, event); return event;
  };
  const key = (key: string, extra: Record<string, unknown> = {}, nodes: FakeElement[] = []) => keyboard('keydown', key, extra, nodes);
  const keyup = (key: string, extra: Record<string, unknown> = {}, nodes: FakeElement[] = []) => keyboard('keyup', key, extra, nodes);
  return { sent, dispatch, configure, key, keyup, parent, window };
}

describe('HTML response injection', () => {
  test('preserves legacy and UTF-16 bytes and honors actual encoding declarations', () => {
    const legacy = Buffer.concat([Buffer.from('<!doctype html><html><head><meta charset="GBK"></head><body>'), Buffer.from([0xd6, 0xd0, 0xce, 0xc4]), Buffer.from('</body></html>')]);
    const plan = planHtmlBridge(legacy);
    expect(plan.contentType).toBe('text/html; charset=gbk');
    const injected = Buffer.concat([legacy.subarray(0, plan.offset), plan.script, legacy.subarray(plan.offset)]);
    expect(injected.includes(Buffer.from([0xd6, 0xd0, 0xce, 0xc4]))).toBe(true);
    expect(Buffer.concat([injected.subarray(0, plan.offset), injected.subarray(plan.offset + plan.script.length)])).toEqual(legacy);
    for (const endian of ['le', 'be']) {
      const source = Buffer.from('\uFEFF<!doctype html><html><head></head><body>中文 🧭</body></html>', 'utf16le');
      if (endian === 'be') source.swap16();
      const wide = planHtmlBridge(source);
      expect(wide.contentType).toBe(`text/html; charset=utf-16${endian}`);
      const result = Buffer.concat([source.subarray(0, wide.offset), wide.script, source.subarray(wide.offset)]);
      if (endian === 'be') result.swap16();
      expect(result.toString('utf16le')).toBe(injectHtmlBridge('\uFEFF<!doctype html><html><head></head><body>中文 🧭</body></html>'));
    }
    for (const decoy of ['<!-- <meta charset="gbk"> -->', '<script>const x = \'<meta charset="gbk">\';</script>', '<meta data-charset="gbk">', '<meta content="text/html; charset=gbk">']) {
      expect(planHtmlBridge(Buffer.from(`<!doctype html><html><head>${decoy}</head><body>中文</body></html>`)).contentType).toBe('text/html; charset=utf-8');
    }
    expect(planHtmlBridge(Buffer.from('<meta http-equiv="Content-Type" content="text/html; charset=GBK">')).contentType).toBe('text/html; charset=gbk');
    expect(planHtmlBridge(Buffer.from('\uFEFF<meta charset="gbk">')).contentType).toBe('text/html; charset=utf-8');
  });

  test('bounds prefix reads for HEAD and streams the unchanged document remainder', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-bridge-large-'));
    const file = path.join(directory, 'large.html');
    const source = Buffer.from('<!doctype html><head><meta charset="utf-8"></head><body>' + '中文'.repeat(htmlBridgePrefixLimit) + '</body>');
    try {
      await fs.writeFile(file, source);
      const response = await prepareHtmlBridge(file, source.length);
      const plan = planHtmlBridge(source.subarray(0, htmlBridgePrefixLimit), source.length);
      expect(response.contentLength).toBe(source.length + plan.script.length);
      const chunks: Buffer[] = []; for await (const chunk of response.stream()) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      expect(body.length).toBe(response.contentLength);
      expect(Buffer.concat([body.subarray(0, plan.offset), body.subarray(plan.offset + plan.script.length)])).toEqual(source);
      // An unfinished prolog beyond the read budget is served intact rather than placing a script before its doctype.
      const longProlog = Buffer.from('<!--' + 'x'.repeat(htmlBridgePrefixLimit));
      expect(planHtmlBridge(longProlog.subarray(0, htmlBridgePrefixLimit), longProlog.length + 100).script.length).toBe(0);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });

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
      const encoded = [
        { name: 'legacy.html', bytes: Buffer.concat([Buffer.from('<!doctype html><head><meta charset="GBK"></head><p>'), Buffer.from([0xd6, 0xd0, 0xce, 0xc4]), Buffer.from('</p>')]), charset: 'gbk' },
        { name: 'wide.html', bytes: Buffer.from('\uFEFF<!doctype html><head></head><p>中文 🧭</p>', 'utf16le'), charset: 'utf-16le' },
      ];
      for (const fixture of encoded) {
        await fs.writeFile(path.join(root, fixture.name), fixture.bytes);
        const served = await app.preview.inject({ url: `/m/${id}/${fixture.name}`, headers: previewHeaders });
        const metadata = await app.preview.inject({ method: 'HEAD', url: `/m/${id}/${fixture.name}`, headers: previewHeaders });
        const plan = planHtmlBridge(fixture.bytes);
        expect(served.headers['content-type']).toBe(`text/html; charset=${fixture.charset}`);
        expect(served.rawPayload).toEqual(Buffer.concat([fixture.bytes.subarray(0, plan.offset), plan.script, fixture.bytes.subarray(plan.offset)]));
        expect(metadata.headers['content-length']).toBe(String(served.rawPayload.length));
        expect((await app.main.inject({ url: `/api/mounts/${id}/download?path=${fixture.name}`, headers })).rawPayload).toEqual(fixture.bytes);
      }
    } finally { await app.close(); await fs.rm(temp, { recursive: true, force: true }); }
  });
});

describe('bridge runtime', () => {
  test('suppresses only matching key releases, including after config changes, and clears ownership on window blur', () => {
    const b = browser(); b.configure();
    expect(b.key('ArrowLeft', { altKey: true, code: 'ArrowLeft' }).prevented).toBe(true);
    // Releasing Alt first must not expose the paired ArrowLeft release to the page.
    expect(b.keyup('ArrowLeft', { code: 'ArrowLeft' })).toMatchObject({ prevented: true, stopped: true });
    expect(b.keyup('ArrowLeft', { code: 'ArrowLeft' }).prevented).toBe(false);
    b.key('f', { code: 'KeyF' }); b.configure({ ...fullConfig, mode: 'web' });
    expect(b.keyup('F', { code: 'KeyF', shiftKey: true }).prevented).toBe(true);
    expect(b.key('b', { code: 'KeyB' }).prevented).toBe(false); expect(b.keyup('b', { code: 'KeyB' }).prevented).toBe(false);
    b.configure(); const input = new FakeElement('INPUT');
    expect(b.key('f', { code: 'KeyF' }, [input]).prevented).toBe(false); expect(b.keyup('f', { code: 'KeyF' }, [input]).prevented).toBe(false);
    b.key('f', { code: 'KeyF' }); b.dispatch('blur', { target: input }); expect(b.keyup('f', { code: 'KeyF' }).prevented).toBe(true);
    b.key('f', { code: 'KeyF' }); b.dispatch('blur', { target: b.window }); expect(b.keyup('f', { code: 'KeyF' }).prevented).toBe(false);
  });

  test('a trusted parent can probe a new session while other sources and stale config remain rejected', () => {
    const b = browser();
    const data = { marker: BRIDGE_MARKER, version: BRIDGE_VERSION, type: 'probe', session: '' };
    const original = b.sent.length;
    b.dispatch('message', { source: b.parent, origin: 'https://elsewhere.example', data });
    b.dispatch('message', { source: {}, origin: mainOrigin, data });
    expect(b.sent.length).toBe(original);
    b.dispatch('message', { source: b.parent, origin: mainOrigin, data });
    expect(b.sent.length).toBe(original + 1);
    expect(b.sent.at(-1)).toMatchObject({ type: 'ready', session: 'session-one' });
    expect(b.key('f').prevented).toBe(false);
    b.configure(fullConfig, { data: { ...data, type: 'config', session: 'old-document', config: fullConfig } });
    expect(b.key('f').prevented).toBe(false);
    b.configure(); expect(b.key('f').prevented).toBe(true);
  });

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
