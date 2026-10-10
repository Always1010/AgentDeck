import { parseFileReference, type Snapshot } from '../shared/model.js';

export function fullFilePath(snapshot: Snapshot, id: string) {
  const source = snapshot.toolSources?.find(source => source.id === id);
  if (source) return source.absolutePath;
  const reference = parseFileReference(id);
  const mount = snapshot.mounts.find(item => item.id === reference?.mountId);
  if (!reference || !mount) return undefined;
  const separator = mount.absolutePath.includes('\\') ? '\\' : '/';
  return `${mount.absolutePath.replace(/[\\/]+$/, '')}${separator}${reference.relativePath.split('/').join(separator)}`;
}

export function treeFileReference(snapshot: Snapshot, id: string) {
  const source = snapshot.toolSources?.find(source => source.id === id);
  if (!source) {
    const ref = parseFileReference(id);
    return ref && snapshot.mounts.some(m => m.id === ref.mountId && m.enabled) ? ref : undefined;
  }
  const actual = source.absolutePath.replace(/\\/g, '/');
  const normalized = (value: string) => /^[a-z]:/i.test(value) ? value.toLowerCase() : value;
  const mount = snapshot.mounts.find(m => m.enabled && normalized(actual).startsWith(normalized(m.absolutePath.replace(/\\/g, '/').replace(/\/$/, '')) + '/'));
  return mount ? { mountId: mount.id, relativePath: actual.slice(mount.absolutePath.replace(/[\\/]+$/, '').length + 1) } : undefined;
}
