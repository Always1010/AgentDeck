import { parseFileReference, type Snapshot } from '../shared/model.js';

export function fullFilePath(snapshot: Snapshot, id: string) {
  const reference = parseFileReference(id);
  const mount = snapshot.mounts.find(item => item.id === reference?.mountId);
  if (!reference || !mount) return undefined;
  const separator = mount.absolutePath.includes('\\') ? '\\' : '/';
  return `${mount.absolutePath.replace(/[\\/]+$/, '')}${separator}${reference.relativePath.split('/').join(separator)}`;
}
