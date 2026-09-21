import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { registrySchema } from '../shared/model.js';

export function dataHome(localAppData = process.env.LOCALAPPDATA, home = os.homedir()) {
  return path.join(localAppData || path.join(home, '.local', 'share'), 'AgentDeck');
}

// Both source and compiled entry points find their own checkout, independent of cwd.
export async function projectRoot(moduleUrl: string): Promise<string> {
  let directory = path.dirname(fileURLToPath(moduleUrl));
  for (;;) {
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
      if (pkg.name === 'agentdeck') return directory;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error('Cannot locate the AgentDeck project directory');
    directory = parent;
  }
}

export async function migrateLegacyState(localAppData = process.env.LOCALAPPDATA, home = os.homedir()) {
  const base = localAppData || path.join(home, '.local', 'share');
  const source = path.join(base, 'ProjectWorkbench', 'registry.json');
  const destination = path.join(dataHome(localAppData, home), 'state', 'registry.json');
  try { await fs.access(destination); return false; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  let bytes: Buffer;
  try { bytes = await fs.readFile(source); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  // Fail visibly for invalid legacy data; never replace it with an empty registry.
  registrySchema.parse(JSON.parse(bytes.toString('utf8')));
  await fs.mkdir(path.dirname(destination), { recursive: true });
  // Keep the original legacy file and an additional byte-for-byte migration backup.
  try { await fs.writeFile(`${destination}.legacy.bak`, bytes, { flag: 'wx' }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  try { await fs.copyFile(source, destination, constants.COPYFILE_EXCL); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
  return true;
}
