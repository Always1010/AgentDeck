import path from 'node:path';
import { fileReference, parseFileReference, type RegistryData, type ToolItem } from '../shared/model.js';
import { legacyId } from './files.js';

/** Explicit registrations and known legacy tool locations only; no filesystem discovery. */
export function listTools(registry: RegistryData, aliases: Map<string, { mountId: string; relativePath: string }>): ToolItem[] {
  const candidates = new Map<string, string | undefined>();
  for (const [old, ref] of aliases) {
    if (old !== legacyId(ref.mountId, ref.relativePath) || registry.entryPreferences[old]?.kind === 'tool') {
      candidates.set(fileReference(ref.mountId, ref.relativePath), registry.entryPreferences[old]?.title);
    }
  }
  for (const m of registry.mounts) {
    if (m.mode === 'single-tool') {
      const override = registry.toolOverrides.find(o => o.mountId === m.id && o.toolRoot === '');
      const id = fileReference(m.id, override?.entry || m.entry);
      if (!candidates.has(id)) candidates.set(id, m.label);
    }
  }
  for (const o of registry.toolOverrides) {
    const id = fileReference(o.mountId, [o.toolRoot, o.entry].filter(Boolean).join('/'));
    if (!candidates.has(id)) candidates.set(id, undefined);
  }
  for (const [id, prefs] of Object.entries(registry.entryPreferences)) {
    if (parseFileReference(id) && prefs.kind === 'tool') candidates.set(id, prefs.title);
  }
  const result: ToolItem[] = [];
  for (const [id, oldTitle] of candidates) {
    const ref = parseFileReference(id)!;
    if (!/\.html?$/i.test(ref.relativePath)) continue;
    const prefs = registry.entryPreferences[id];
    if (prefs?.kind && prefs.kind !== 'tool') continue; // Explicit removal overrides legacy membership.
    const explicit = prefs?.kind === 'tool';
    if (!explicit && !registry.mounts.some(m => m.id === ref.mountId)) continue;
    const filename = path.posix.basename(ref.relativePath);
    const fallback = /^index\.html?$/i.test(filename) && path.posix.dirname(ref.relativePath) !== '.' ? path.posix.basename(path.posix.dirname(ref.relativePath)) : filename;
    result.push({ id, title: prefs?.title || oldTitle || fallback });
  }
  return result.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN', { numeric: true }) || a.id.localeCompare(b.id));
}
