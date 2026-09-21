import fs from 'node:fs/promises';
import path from 'node:path';
import { parseFileReference } from '../shared/model.js';
import { relative } from './path-policy.js';

/** Import a snapshot of the old service's existing index; never walk mounted files. */
export async function readLegacyReferences(stateDir: string): Promise<Record<string, string>> {
  let value: unknown;
  try { value = JSON.parse(await fs.readFile(path.join(stateDir, 'legacy-file-references.json'), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
  const result: Record<string, string> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [id, target] of Object.entries(value)) {
    if (!/^[a-f0-9]{32}$/i.test(id) || typeof target !== 'string') continue;
    const ref = parseFileReference(target);
    if (!ref) continue;
    try { relative(ref.relativePath, false); result[id] = target; } catch { /* Invalid migration records grant no access. */ }
  }
  return result;
}
