import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileReference, type Entry, type Mount, type RegistryData } from '../shared/model.js';
import { PathPolicy } from './path-policy.js';
import { AppError } from './errors.js';
import { fileVersion } from '../shared/updates.js';

export const legacyId = (mountId: string, key: string) => createHash('sha256').update(`${mountId}\0${key}`).digest('hex').slice(0, 32);
export const isTextFile = (name: string) => /\.(html?|css|[cm]?js|jsx|tsx?|json|csv|txt|md|markdown|svg|py|rs|go|java|c|h|cpp|hpp|cs|sh|ps1|sql|ya?ml|toml|xml|ini|log|r|rb|php|vue|svelte|bat|cmd)$/i.test(name) || /^(Dockerfile|Makefile|LICENSE|README)$/i.test(path.basename(name));
export function legacyIds(m: Mount, rel: string, registry: RegistryData) {
  const ids = [legacyId(m.id, rel)];
  if (!/\.html?$/i.test(rel)) return ids;
  for (const o of registry.toolOverrides.filter(o => o.mountId === m.id)) {
    if ([o.toolRoot, o.entry].filter(Boolean).join('/') === rel) ids.push(legacyId(m.id, `tool:${o.toolRoot}`));
  }
  if (m.mode === 'single-tool' && rel === m.entry) ids.push(legacyId(m.id, 'tool:'));
  if (m.mode === 'tool-library' || m.toolDirectories.some(p => rel.startsWith(`${p}/`))) {
    ids.push(legacyId(m.id, `tool:${rel}`));
    if (/(^|\/)index\.html$/i.test(rel)) {
      const directory = path.posix.dirname(rel);
      const root = /(^|\/)(dist|build)$/.test(directory) ? path.posix.dirname(directory) : directory;
      ids.push(legacyId(m.id, `tool:${root === '.' ? '' : root}`));
    }
  }
  return [...new Set(ids)];
}
export async function describeFile(policy: PathPolicy, registry: RegistryData, m: Mount, rel: string): Promise<Entry> {
  const file = await policy.resolve(m, rel, false, 'file');
  if (file.stat.isDirectory()) throw new AppError('INVALID_PATH', '请选择文件', 400);
  const id = fileReference(m.id, rel);
  const format = path.extname(rel).slice(1).toLowerCase();
  const aliases = legacyIds(m, rel, registry);
  const prefs = registry.entryPreferences[id] || aliases.map(key => registry.entryPreferences[key]).find(Boolean) || {};
  return { id, mountId: m.id, projectId: m.projectId, relativePath: rel, title: path.posix.basename(rel), format,
    kind: /^html?$/.test(format) ? 'html' : /^(md|markdown)$/.test(format) ? 'markdown' : /^(csv|json)$/.test(format) ? 'data' : 'text',
    resourceRoot: path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel), updatedAt: file.stat.mtimeMs,
    status: 'ready', refreshMode: 'prompt', fileVersion: fileVersion(file.stat), ...prefs };
}
