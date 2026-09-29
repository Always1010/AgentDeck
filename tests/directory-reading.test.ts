import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createWorkbench, type Workbench } from '../app/server/server.js';

let temp: string, root: string, app: Workbench, id: string;
const headers = { host: '127.0.0.1:4310', 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:4310', 'x-workbench': '1', 'content-type': 'application/json' };
beforeEach(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-directory-'));
  root = path.join(temp, 'reports'); await fs.mkdir(root);
  await Promise.all(Array.from({ length: 24 }, (_, index) => fs.writeFile(path.join(root, `report-${index}.md`), 'report')));
  app = await createWorkbench({ stateDir: path.join(temp, 'state'), port: 4310, previewPort: 4311 });
  await app.main.inject({ method: 'POST', url: '/api/projects', headers, payload: { name: 'Reports', mount: { label: 'Reports', absolutePath: root } } });
  id = app.registry.data.mounts[0].id;
});
afterEach(async () => { vi.restoreAllMocks(); await app.close(); await fs.rm(temp, { recursive: true, force: true }); });

test('a listing validates its root once and limits parallel child resolution', async () => {
  const rootCheck = vi.spyOn(app.policy, 'root');
  const original = app.policy.directory.bind(app.policy);
  let running = 0, peak = 0;
  vi.spyOn(app.policy, 'directory').mockImplementation(async (...args) => {
    const directory = await original(...args);
    return { ...directory, resolveChild: async name => {
      running++; peak = Math.max(peak, running);
      try { return await directory.resolveChild(name); }
      finally { running--; }
    } };
  });
  const response = await app.main.inject({ url: `/api/mounts/${id}/tree`, headers });
  expect(response.statusCode).toBe(200); expect(response.json()).toHaveLength(24);
  expect(rootCheck).toHaveBeenCalledTimes(1); expect(peak).toBeGreaterThan(1); expect(peak).toBeLessThanOrEqual(8);
});

test('request-local root reuse still rejects a child replaced by a junction and new exclusions', async () => {
  const child = path.join(root, 'child'); await fs.mkdir(child);
  const outside = path.join(temp, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'private.txt'), 'private');
  const mount = app.registry.data.mounts[0];
  const directory = await app.policy.directory(mount, '');
  await fs.rmdir(child);
  await fs.symlink(outside, child, process.platform === 'win32' ? 'junction' : 'dir');
  await expect(directory.resolveChild('child')).rejects.toMatchObject({ code: 'FORBIDDEN_PATH' });
  mount.excludes.push('report-0.md');
  await expect(directory.resolveChild('report-0.md')).rejects.toMatchObject({ code: 'FORBIDDEN_FILE' });
  await expect(directory.resolveChild('../outside')).rejects.toMatchObject({ code: 'INVALID_PATH' });
  expect((await app.main.inject({ url: `/api/mounts/${id}/tree`, headers })).json().some((item: { name: string }) => item.name === 'child' || item.name === 'report-0.md')).toBe(false);
});
