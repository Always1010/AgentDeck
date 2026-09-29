import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createWorkbench, type Workbench } from '../app/server/server.js';

let temp: string, root: string, app: Workbench, id: string;
const headers = { host: '127.0.0.1:4310', 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:4310', 'x-workbench': '1', 'content-type': 'application/json' };
beforeEach(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-resources-'));
  root = path.join(temp, 'report'); await fs.mkdir(path.join(root, 'nested'), { recursive: true });
  await Promise.all(Object.entries({ 'index.html': '<link rel="stylesheet" href="page.css">', 'page.css': 'body{}', 'data.json': '{}', 'ignored.css': 'private', 'nested/page.css': 'nested{}', 'note.txt': 'notes', '.hidden.css': 'hidden{}' }).map(([name, text]) => fs.writeFile(path.join(root, name), text)));
  app = await createWorkbench({ stateDir: path.join(temp, 'state'), port: 4310, previewPort: 4311 });
  await app.main.inject({ method: 'POST', url: '/api/projects', headers, payload: { name: 'Report', mount: { label: 'Report', absolutePath: root, excludes: ['ignored.css'] } } });
  id = app.registry.data.mounts[0].id;
});
afterEach(async () => { vi.restoreAllMocks(); await app.close(); await fs.rm(temp, { recursive: true, force: true }); });
const version = () => app.main.inject({ url: `/api/mounts/${id}/resource-version?path=index.html`, headers });

test('sibling resource metadata changes without reading bodies or traversing subdirectories', async () => {
  const read = vi.spyOn(fs, 'readFile'); const list = vi.spyOn(fs, 'readdir');
  const first = (await version()).json();
  expect(first).toMatchObject({ scope: 'same-directory', directory: '', count: 2 });
  expect((await version()).json()).toEqual(first);
  expect(list.mock.calls.every(([directory]) => String(directory) === app.registry.data.mounts[0].absolutePath)).toBe(true); expect(read).not.toHaveBeenCalled();
  await fs.writeFile(path.join(root, 'page.css'), 'body{color:red}');
  const changed = (await version()).json(); expect(changed.version).not.toBe(first.version);
  await fs.writeFile(path.join(root, 'new.js'), 'console.log(1)');
  const added = (await version()).json(); expect(added.count).toBe(3); expect(added.version).not.toBe(changed.version);
  await fs.unlink(path.join(root, 'new.js'));
  expect((await version()).json()).toEqual(changed);
});

test('excluded, hidden, nested, unrelated and symlinked files do not affect the sibling fingerprint', async () => {
  const outside = path.join(temp, 'outside.css'); await fs.writeFile(outside, 'outside{}');
  if (process.platform !== 'win32') await fs.symlink(outside, path.join(root, 'linked.css'));
  const first = (await version()).json();
  await Promise.all(['index.html', 'ignored.css', 'nested/page.css', 'note.txt', '.hidden.css'].map(name => fs.writeFile(path.join(root, name), 'changed content')));
  expect((await version()).json()).toEqual(first);
  expect((await app.main.inject({ url: `/api/mounts/${id}/resource-version?path=page.css`, headers })).statusCode).toBe(400);
  expect((await app.main.inject({ url: `/api/mounts/${id}/resource-version?path=..%2Foutside.css`, headers })).statusCode).toBe(400);
  await app.main.inject({ method: 'PATCH', url: `/api/mounts/${id}`, headers, payload: { enabled: false } });
  expect((await version()).statusCode).toBe(410);
});
