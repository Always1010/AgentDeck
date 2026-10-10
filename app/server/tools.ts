import path from 'node:path';
import { fileReference, parseFileReference, type RegistryData, type ToolItem, type FileSource, type Mount } from '../shared/model.js';
import { legacyId } from './files.js';

/** Explicit registrations and known legacy tool locations only; no filesystem discovery. */
export function listTools(registry: RegistryData, aliases: Map<string, { mountId: string; relativePath: string }>): ToolItem[] {
  const candidates = new Map<string, string | undefined>();
  for (const source of registry.fileSources || []) {
    if (registry.entryPreferences[source.id]?.kind === 'tool') candidates.set(source.id, defaultToolTitle(source.absolutePath));
  }
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
    const source = registry.fileSources?.find(source => source.id === id);
    if (!/\.html?$/i.test(source?.absolutePath || ref.relativePath)) continue;
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

export const sameFile = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
export function defaultToolTitle(absolutePath: string) {
  const filename = path.basename(absolutePath);
  return /^index\.html?$/i.test(filename) ? path.basename(path.dirname(absolutePath)) || filename.replace(/\.html?$/i, '') : filename.replace(/\.html?$/i, '');
}
/** Internal access scope; never included in project mounts, trees or directory searches. */
export function fileScope(source: FileSource): Mount {
  return { id: source.key, projectId: '', label: path.basename(source.absolutePath), absolutePath: path.dirname(source.absolutePath), mode: 'content', entry: path.basename(source.absolutePath), enabled: true, toolDirectories: [], excludes: source.excludes || [], fileSource: true };
}
export function fileExcludes(mount: Mount, entryPath: string) {
  const parent = path.posix.dirname(entryPath);
  const prefix = parent === '.' ? '' : `${parent}/`;
  const normalized = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
  return mount.excludes.filter(exclude => normalized(exclude) !== normalized(entryPath) && normalized(exclude).startsWith(normalized(prefix))).map(exclude => exclude.slice(prefix.length));
}
