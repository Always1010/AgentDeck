import { beforeEach, afterEach, test, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createWorkbench, type Workbench } from '../app/server/server.js';
import { fileReference } from '../app/shared/model.js';

let temp: string, root: string, app: Workbench;
const headers = { host: '127.0.0.1:4310', 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:4310', 'x-workbench': '1', 'content-type': 'application/json' };
const previewHeaders = { host: '127.0.0.1:4311' };
const open = (absolutePath: string) => app.main.inject({ method: 'POST', url: '/api/files/open', headers, payload: { absolutePath } });
const entry = (id: string) => app.main.inject({ url: `/api/entries/${encodeURIComponent(id)}`, headers });
beforeEach(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-files-'));
  root = path.join(temp, 'content'); await fs.mkdir(root);
  app = await createWorkbench({ stateDir: path.join(temp, 'state'), port: 4310, previewPort: 4311 });
});
afterEach(async () => { await app.close(); await fs.rm(temp, { recursive: true, force: true }); });

test('independent formats persist without catalog membership and only expose their allowed resources', async () => {
  await fs.writeFile(path.join(root, 'notes.md'), '# Notes\n\n![chart](./chart.svg)\n[Next](./next.md)');
  await fs.writeFile(path.join(root, 'next.md'), '# Next');
  await fs.writeFile(path.join(root, 'chart.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await fs.writeFile(path.join(root, 'data.csv'), 'a,b\n1,2');
  await fs.writeFile(path.join(root, 'script.py'), 'print(1)');
  await fs.writeFile(path.join(root, 'archive.zip'), Buffer.from([0, 1, 2]));
  await fs.writeFile(path.join(root, 'app.js'), 'private');
  for (const filename of ['notes.md', 'chart.svg', 'data.csv', 'script.py', 'archive.zip']) {
    const response = await open(`"${path.join(root, filename)}"`); expect(response.statusCode).toBe(200);
    const id = response.json().id;
    expect((await open(path.join(root, filename))).json().id).toBe(id);
    const e = (await entry(id)).json();
    const read = await app.main.inject({ url: `/api/mounts/${e.mountId}/file?path=${e.relativePath}`, headers });
    expect(read.statusCode).toBe(filename === 'archive.zip' ? 415 : 200);
    expect((await app.main.inject({ url: `/api/mounts/${e.mountId}/download?path=${e.relativePath}`, headers })).statusCode).toBe(200);
    const url = new URL(e.previewUrl).pathname;
    if (filename === 'notes.md') {
      expect((await app.preview.inject({ url: url.replace('notes.md', 'chart.svg'), headers: previewHeaders })).statusCode).toBe(200);
      expect((await app.preview.inject({ url: url.replace('notes.md', 'app.js'), headers: previewHeaders })).statusCode).toBe(403);
      const link = await app.main.inject({ method: 'POST', url: `/api/files/${encodeURIComponent(id)}/links`, headers, payload: { path: 'next.md' } });
      expect(link.statusCode).toBe(200); expect((await entry(link.json().id)).json().title).toBe('next.md');
      for (const rel of ['../outside.md', 'app.js', '.env']) expect((await app.main.inject({ method: 'POST', url: `/api/files/${encodeURIComponent(id)}/links`, headers, payload: { path: rel } })).statusCode).toBeGreaterThanOrEqual(400);
    } else expect((await app.preview.inject({ url: url.replace(filename, 'next.md'), headers: previewHeaders })).statusCode).toBe(403);
  }
  expect((await app.main.inject({ url: '/api/tools', headers })).json()).toEqual([]);
  const snapshot = (await app.main.inject({ url: '/api/projects', headers })).json();
  expect(snapshot.projects).toEqual([]); expect(snapshot.mounts).toEqual([]); expect(snapshot.fileSources).toHaveLength(6);
  await app.close(); app = await createWorkbench({ stateDir: path.join(temp, 'state'), port: 4310, previewPort: 4311 });
  for (const source of snapshot.fileSources) expect((await entry(source.id)).statusCode).toBe(200);
});

test('file opening respects mounted exclusions, disabled mounts and filesystem boundaries', async () => {
  await fs.writeFile(path.join(root, 'readme.md'), '# Mounted');
  await fs.writeFile(path.join(root, 'private.txt'), 'private');
  const p = await app.main.inject({ method: 'POST', url: '/api/projects', headers, payload: { name: 'p', mount: { label: 'm', absolutePath: root, excludes: ['private.txt'] } } });
  expect(p.statusCode).toBe(200);
  const mountId = app.registry.data.mounts[0].id;
  expect((await open(path.join(root, 'readme.md'))).json().id).toBe(fileReference(mountId, 'readme.md'));
  expect(app.registry.data.fileSources || []).toHaveLength(0);
  expect((await open(path.join(root, 'private.txt'))).statusCode).toBe(403);
  const listing = (await app.main.inject({ url: `/api/fs/files?absolutePath=${encodeURIComponent(root)}`, headers })).json();
  expect(listing.items.map((item: { name: string }) => item.name)).toEqual(['readme.md']);
  await app.main.inject({ method: 'PATCH', url: `/api/mounts/${mountId}`, headers, payload: { enabled: false } });
  expect((await open(path.join(root, 'readme.md'))).statusCode).toBe(410);
  await fs.symlink(root, path.join(temp, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  for (const [file, status] of [[root, 400], ['relative.md', 400], [path.join(root, 'missing.md'), 404], [app.registry.file, 403], [path.join(temp, 'linked', 'readme.md'), 403]] as const) expect((await open(file)).statusCode).toBe(status);
  expect((await app.main.inject({ method: 'POST', url: '/api/files/open', headers: { ...headers, origin: 'http://evil.example' }, payload: { absolutePath: path.join(root, 'readme.md') } })).statusCode).toBe(403);
});

test('HTML can become a tool using the same source and legacy source records retain their identity', async () => {
  const html = path.join(root, 'report.html'); await fs.writeFile(html, '<input>');
  const id = (await open(html)).json().id;
  expect((await app.main.inject({ method: 'PUT', url: '/api/tools', headers, payload: { id, title: 'Report' } })).json().id).toBe(id);
  expect((await open(html)).json().id).toBe(id); expect(app.registry.data.fileSources).toHaveLength(1);
  const stored = JSON.parse(await fs.readFile(app.registry.file, 'utf8'));
  stored.toolSources = stored.fileSources; delete stored.fileSources;
  await app.close(); await fs.writeFile(path.join(temp, 'state', 'registry.json'), JSON.stringify(stored));
  app = await createWorkbench({ stateDir: path.join(temp, 'state'), port: 4310, previewPort: 4311 });
  expect((await entry(id)).json().title).toBe('Report');
  expect((await app.main.inject({ url: '/api/tools', headers })).json()).toEqual([{ id, title: 'Report' }]);
});

test('reselecting a missing independent file preserves identity and rejects duplicate destinations', async () => {
  const original = path.join(root, 'one.md'), moved = path.join(root, 'moved.md');
  await fs.writeFile(original, '# Original');
  const id = (await open(original)).json().id;
  await app.main.inject({ method: 'PATCH', url: `/api/entries/${encodeURIComponent(id)}/preferences`, headers, payload: { title: 'My notes' } });
  await fs.rename(original, moved); expect((await entry(id)).statusCode).toBe(404);
  const reselect = (absolutePath: string) => app.main.inject({ method: 'PATCH', url: `/api/files/${encodeURIComponent(id)}`, headers, payload: { absolutePath } });
  expect((await reselect(moved)).json()).toEqual({ id });
  const e = (await entry(id)).json(); expect(e.title).toBe('My notes'); expect(e.previewUrl).toContain('moved.md');
  await fs.writeFile(path.join(root, 'other.md'), '# Other'); await open(path.join(root, 'other.md'));
  expect((await reselect(path.join(root, 'other.md'))).statusCode).toBe(409);
  expect((await entry(id)).json().previewUrl).toBe(e.previewUrl);
  const html = path.join(root, 'moved.html'); await fs.rename(moved, html);
  expect((await reselect(html)).statusCode).toBe(200);
  expect((await app.main.inject({ method: 'PUT', url: '/api/tools', headers, payload: { id } })).json().id).toBe(id);
  expect((await app.main.inject({ url: '/api/tools', headers })).json()).toEqual([{ id, title: 'My notes' }]);
});
