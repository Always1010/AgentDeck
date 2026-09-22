import { BRIDGE_MARKER, BRIDGE_VERSION } from '../shared/bridge.js';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

export const bridgeScriptPath = '/__agentdeck/bridge.js';
const scriptTag = `<script src="${bridgeScriptPath}"></script>`;
export const htmlBridgePrefixLimit = 64 * 1024;

function injectionPosition(html: string, complete: boolean): number | null {
  let position = html.startsWith('\uFEFF') ? 1 : 0;
  // Only inspect the document prolog: a later comment or script can contain literal <head> text.
  while (position < html.length) {
    const rest = html.slice(position);
    const next = /^(?:\s+|<!--[\s\S]*?-->|<!doctype\b(?:[^>"']|"[^"]*"|'[^']*')*>|<html\b(?:[^>"']|"[^"]*"|'[^']*')*>|<head\b(?:[^>"']|"[^"]*"|'[^']*')*>)/i.exec(rest);
    if (!next) {
      // A very long prolog must remain untouched rather than inserting before an unseen doctype.
      if (!complete && /^(?:<!--|<!doctype\b|<html\b|<head\b)/i.test(rest)) return null;
      return position;
    }
    position += next[0].length;
    if (/^<head\b/i.test(next[0])) return position;
  }
  return complete ? position : null;
}

/** Add a parser-blocking script before page scripts without rewriting the source file. */
export function injectHtmlBridge(html: string): string {
  const position = injectionPosition(html, true)!;
  return html.slice(0, position) + scriptTag + html.slice(position);
}

/** Plan an ASCII/UTF-16 insertion, preserving every original byte, including legacy encodings. */
export function planHtmlBridge(prefix: Buffer, totalSize = prefix.length) {
  const bom = prefix[0] === 0xff && prefix[1] === 0xfe ? 'utf-16le' : prefix[0] === 0xfe && prefix[1] === 0xff ? 'utf-16be' : prefix.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? 'utf-8' : null;
  const wide = bom === 'utf-16le' || bom === 'utf-16be';
  const bomBytes = wide ? 2 : bom === 'utf-8' ? 3 : 0;
  const raw = prefix.subarray(bomBytes, wide ? prefix.length - (prefix.length - bomBytes) % 2 : prefix.length);
  const html = wide ? (bom === 'utf-16be' ? Buffer.from(raw).swap16() : raw).toString('utf16le') : raw.toString('latin1');
  let charset = bom || 'utf-8';
  if (!bom) {
    // HTTP charset takes precedence over <meta>; retain a declared encoding instead of overriding it.
    const head = html.slice(0, 1024);
    const tokens = /<!--[\s\S]*?(?:-->|$)|<(script|style|title|textarea)\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?(?:<\/\1\s*>|$)|<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
    for (const match of head.matchAll(tokens)) {
      if (!/^<meta\b/i.test(match[0])) continue;
      const attributes = new Map<string, string>();
      for (const attribute of match[0].slice(5, -1).matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        const name = attribute[1].toLowerCase();
        if (!attributes.has(name)) attributes.set(name, attribute[2] ?? attribute[3] ?? attribute[4] ?? '');
      }
      const label = attributes.get('charset') || (attributes.get('http-equiv')?.toLowerCase() === 'content-type' ? /\bcharset\s*=\s*([\w-]+)/i.exec(attributes.get('content') || '')?.[1] : undefined);
      if (!label) continue;
      try {
        const encoding = new TextDecoder(label).encoding;
        // The HTML encoding algorithm treats UTF-16 declarations without a BOM as UTF-8.
        charset = encoding.startsWith('utf-16') ? 'utf-8' : encoding;
        break;
      } catch { /* Ignore unsupported declarations, retaining the existing UTF-8 default. */ }
    }
  }
  const position = injectionPosition(html, prefix.length >= totalSize);
  const script = position === null ? Buffer.alloc(0) : Buffer.from(scriptTag, wide ? 'utf16le' : 'ascii');
  if (bom === 'utf-16be') script.swap16();
  return { offset: position === null ? 0 : bomBytes + position * (wide ? 2 : 1), script, contentType: `text/html; charset=${charset}` };
}

/** HEAD inspects at most a fixed prefix; GET streams the rest without decoding the document. */
export async function prepareHtmlBridge(file: string, size: number) {
  const handle = await fs.open(file, 'r');
  const buffer = Buffer.alloc(Math.min(size, htmlBridgePrefixLimit));
  let bytesRead = 0;
  try {
    while (bytesRead < buffer.length) {
      const read = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (!read.bytesRead) break;
      bytesRead += read.bytesRead;
    }
  } finally { await handle.close(); }
  const prefix = buffer.subarray(0, bytesRead);
  const plan = planHtmlBridge(prefix, size);
  return {
    contentType: plan.contentType,
    contentLength: size + plan.script.length,
    stream: () => Readable.from((async function* () {
      yield prefix.subarray(0, plan.offset);
      yield plan.script;
      yield prefix.subarray(plan.offset);
      if (size > prefix.length) yield* createReadStream(file, { start: prefix.length });
    })()),
  };
}

export function htmlBridgeScript(mainOrigin: string): string {
  return `(() => {
  'use strict';
  const origin = ${JSON.stringify(mainOrigin)};
  const marker = ${JSON.stringify(BRIDGE_MARKER)};
  const version = ${BRIDGE_VERSION};
  const embedded = window.parent !== window;
  const session = crypto.randomUUID();
  let config = { mode: 'web', singles: false, navigation: false, escape: false, active: false };
  let configured = false;
  let composing = false;
  const send = (type, fields = {}) => {
    if (embedded) window.parent.postMessage({ marker, version, session, type, ...fields }, origin);
  };
  window.addEventListener('message', event => {
    if (!embedded || event.source !== window.parent || event.origin !== origin) return;
    const data = event.data;
    if (!data || data.marker !== marker || data.version !== version) return;
    if (data.type === 'probe') { send('ready'); return; }
    if (data.session !== session) return;
    if (data.type === 'config') {
      const value = data.config;
      if (!value || !['web', 'workbench'].includes(value.mode) ||
          !['singles', 'navigation', 'escape', 'active'].every(key => typeof value[key] === 'boolean')) return;
      config = value;
      configured = true;
    } else if (data.type === 'restore-scroll' && configured && Number.isFinite(data.x) && Number.isFinite(data.y)) {
      window.scrollTo(data.x, data.y);
    }
  });
  const focus = () => send('focus');
  window.addEventListener('pointerdown', focus, true);
  window.addEventListener('focus', focus, true);
  window.addEventListener('focusin', focus, true);
  window.addEventListener('compositionstart', () => { composing = true; }, true);
  window.addEventListener('compositionend', () => { composing = false; }, true);
  const editing = event => event.composedPath().some(node => {
    if (!(node instanceof Element)) return false;
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName) || node.isContentEditable ||
      node.getAttribute('contenteditable') === '' || node.getAttribute('contenteditable') === 'true' ||
      ['textbox', 'searchbox', 'combobox', 'spinbutton'].includes(node.getAttribute('role')) ||
      node.matches('.monaco-editor, .cm-editor, .CodeMirror');
  });
  window.addEventListener('keydown', event => {
    if (!embedded || !configured || !config.active || config.mode !== 'workbench' || composing || event.isComposing || event.keyCode === 229) return;
    let action;
    if (config.navigation && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      if (event.key === 'ArrowLeft') action = 'back';
      if (event.key === 'ArrowRight') action = 'forward';
    } else if (!event.ctrlKey && !event.metaKey && !event.altKey) {
      if (event.key === 'Escape' && config.escape) action = 'escape';
      else if (config.singles && !editing(event)) {
        if (!event.shiftKey && event.key.toLowerCase() === 'f') action = 'immersive';
        else if (!event.shiftKey && event.key.toLowerCase() === 'b') action = 'sidebar';
        else if (!event.shiftKey && event.key === '/') action = 'search';
        else if (event.key === '?') action = 'help';
      }
    }
    if (!action) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // Repeats stay suppressed, but cannot toggle a layout or race through history.
    if (!event.repeat) { focus(); send('action', { action }); }
  }, true);
  const externalLink = event => {
    if (event.defaultPrevented) return;
    const anchor = event.composedPath().find(node => node instanceof Element && node.matches('a[href], area[href]'));
    if (!anchor || anchor.hasAttribute('download')) return;
    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#')) return;
    let target;
    try { target = new URL(href, document.baseURI); } catch { return; }
    if (!['http:', 'https:'].includes(target.protocol) || target.origin === location.origin) return;
    anchor.setAttribute('target', '_blank');
    const rel = new Set((anchor.getAttribute('rel') || '').split(/\\s+/).filter(Boolean));
    rel.add('noopener'); rel.add('noreferrer');
    anchor.setAttribute('rel', Array.from(rel).join(' '));
  };
  window.addEventListener('click', externalLink, true);
  window.addEventListener('auxclick', externalLink, true);
  let scrollQueued = false;
  window.addEventListener('scroll', () => {
    if (!configured || scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => { scrollQueued = false; send('scroll', { x: scrollX, y: scrollY }); });
  }, { passive: true });
  send('ready');
  document.addEventListener('DOMContentLoaded', () => send('ready'), { once: true });
})();`;
}
