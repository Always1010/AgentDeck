import { BRIDGE_MARKER, BRIDGE_VERSION } from '../shared/bridge.js';

export const bridgeScriptPath = '/__agentdeck/bridge.js';

/** Add a parser-blocking script before page scripts without rewriting the source file. */
export function injectHtmlBridge(html: string): string {
  const script = `<script src="${bridgeScriptPath}"></script>`;
  let position = html.startsWith('\uFEFF') ? 1 : 0;
  // Only inspect the document prolog: a later comment or script can contain literal <head> text.
  while (position < html.length) {
    const next = /^(?:\s+|<!--[\s\S]*?-->|<!doctype\b[^>]*>|<html\b(?:[^>"']|"[^"]*"|'[^']*')*>|<head\b(?:[^>"']|"[^"]*"|'[^']*')*>)/i.exec(html.slice(position));
    if (!next) break;
    position += next[0].length;
    if (/^<head\b/i.test(next[0])) break;
  }
  // The external script tag is short enough to keep an early charset declaration early.
  return html.slice(0, position) + script + html.slice(position);
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
    if (!data || data.marker !== marker || data.version !== version || data.session !== session) return;
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
