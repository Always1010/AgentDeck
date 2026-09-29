import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Mount } from '../shared/model.js';
import type { ResourceVersionResult } from '../shared/fileOperations.js';
import { fileVersion } from '../shared/updates.js';
import { hidden, PathPolicy, relative } from './path-policy.js';
import { AppError } from './errors.js';
import { mapLimited } from './concurrency.js';

const resourceExtensions = new Set(['.css', '.js', '.mjs', '.json', '.csv', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.wasm']);

/** Metadata fingerprint of direct sibling assets, not an HTML dependency graph. */
export async function resourceVersion(policy: PathPolicy, mount: Mount, entryPath: string): Promise<ResourceVersionResult> {
  relative(entryPath, false);
  const entry = await policy.resolve(mount, entryPath);
  if (!entry.stat.isFile() || !/\.html?$/i.test(entryPath)) throw new AppError('INVALID_ENTRY', '请选择 HTML 页面检查同目录资源', 400);
  const parent = path.posix.dirname(entryPath);
  const directory = parent === '.' ? '' : parent;
  const scope = await policy.resolve(mount, directory, false, 'file');
  const children = (await fs.readdir(scope.real, { withFileTypes: true })).filter(child => child.isFile() && !child.isSymbolicLink() && resourceExtensions.has(path.extname(child.name).toLowerCase()));
  const records = await mapLimited(children, 8, async child => {
    const relativePath = [directory, child.name].filter(Boolean).join('/');
    if (hidden(relativePath, mount.excludes)) return undefined;
    try {
      const file = await policy.resolve(mount, relativePath);
      return file.stat.isFile() ? [child.name, fileVersion(file.stat)] : undefined;
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'FORBIDDEN_PATH', 'FORBIDDEN_FILE'].includes((error as { code?: string }).code || '')) return undefined;
      throw error;
    }
  });
  const resources = records.filter((record): record is string[] => !!record).sort((a, b) => a[0].localeCompare(b[0], 'en'));
  return { version: createHash('sha256').update(JSON.stringify(resources)).digest('hex'), directory, scope: 'same-directory', count: resources.length };
}
