import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { request } from 'node:http';
import { createWorkbench, type Workbench } from '../app/server/server.js';
import { FileSearch } from '../app/server/file-search.js';
import { fileReference } from '../app/shared/model.js';
import type { FileSearchResult } from '../app/shared/fileOperations.js';

let temp: string, root: string, app: Workbench, id: string;
const headers = { host: '127.0.0.1:4310', 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:4310', 'x-workbench': '1', 'content-type': 'application/json' };
beforeEach(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-search-'));
  root = path.join(temp, 'reports');
  await fs.mkdir(path.join(root, 'nested'), { recursive: true });
  await fs.mkdir(path.join(root, 'excluded'));
  await fs.mkdir(path.join(root, '.hidden'));
  await Promise.all(['Alpha.html', 'nested/Alpha.md', 'nested/other.csv', 'excluded/Alpha.txt', '.hidden/Alpha.html'].map(name => fs.writeFile(path.join(root, name), 'body must not be searched')));
  app = await createWorkbench({ stateDir: path.join(temp, 'state'), port: 4310, previewPort: 4311 });
  await app.main.inject({ method: 'POST', url: '/api/projects', headers, payload: { name: 'Reports', mount: { label: 'Reports', absolutePath: root, excludes: ['excluded'] } } });
  id = app.registry.data.mounts[0].id;
});
afterEach(async () => { vi.restoreAllMocks(); await app.close(); await fs.rm(temp, { recursive: true, force: true }); });
const search = (query: Record<string, string>) => app.main.inject({ url: `/api/mounts/${id}/search?${new URLSearchParams(query)}`, headers });

test('explicit search traverses names and paths only, respects scope and boundaries, and continues without duplicate matches', async () => {
  const outside = path.join(temp, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'Alpha-secret.txt'), 'secret');
  await fs.symlink(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const read = vi.spyOn(fs, 'readFile');
  const names: string[] = []; let cursor: string | undefined;
  for (let page = 0; page < 30; page++) {
    const response = await search({ q: 'ALPHA', limit: '1', ...(cursor ? { cursor } : {}) });
    expect(response.statusCode).toBe(200);
    const result = response.json<FileSearchResult>();
    names.push(...result.items.map(item => item.relativePath));
    if (result.done) break;
    expect(result.nextCursor).toBeTruthy(); cursor = result.nextCursor;
  }
  expect(names.sort()).toEqual(['Alpha.html', 'nested/Alpha.md']);
  expect(read).not.toHaveBeenCalled();
  expect((await search({ q: 'nested/', path: 'nested' })).json<FileSearchResult>().items.map(item => item.relativePath).sort()).toEqual(['nested/Alpha.md', 'nested/other.csv']);
  expect((await search({ q: 'Alpha', path: '../outside' })).statusCode).toBe(400);
  expect((await search({ q: 'Alpha', path: 'excluded' })).statusCode).toBe(403);
});

test('search is bounded when there are no matches, cursors cancel and mount changes invalidate continuations', async () => {
  await Promise.all(Array.from({ length: 510 }, (_, index) => fs.writeFile(path.join(root, `file-${index}.txt`), 'x')));
  const first = (await search({ q: 'absent' })).json<FileSearchResult>();
  expect(first.items).toEqual([]); expect(first.done).toBe(false); expect(first.scanned).toBeLessThanOrEqual(500); expect(first.nextCursor).toBeTruthy();
  expect((await app.main.inject({ method: 'DELETE', url: `/api/file-search/${first.nextCursor}`, headers, payload: {} })).statusCode).toBe(200);
  expect((await search({ q: 'absent', cursor: first.nextCursor! })).statusCode).toBe(410);
  const second = (await search({ q: 'file', limit: '1' })).json<FileSearchResult>();
  await app.main.inject({ method: 'PATCH', url: `/api/mounts/${id}`, headers, payload: { excludes: ['excluded', 'nested'] } });
  expect((await search({ q: 'file', limit: '1', cursor: second.nextCursor! })).statusCode).toBe(409);
});

test('aborted requests release their search and directory handles', async () => {
  const searches = new FileSearch(app.policy);
  try {
    const abort = new AbortController();
    const original = app.policy.resolve.bind(app.policy);
    const resolve = vi.spyOn(app.policy, 'resolve').mockImplementation(async (...args) => {
      const result = await original(...args);
      if (args[1] === 'Alpha.html') abort.abort();
      return result;
    });
    await expect(searches.page(app.registry.data.mounts[0], { path: '', q: 'alpha', limit: 100 }, abort.signal)).rejects.toMatchObject({ code: 'SEARCH_CANCELLED' });
    resolve.mockRestore();
    const result = await searches.page(app.registry.data.mounts[0], { path: '', q: 'alpha', limit: 100 });
    expect(result.items).toHaveLength(2);
  } finally { await searches.close(); }
});

test('batch status keeps input order, deduplicates work and reports per-file failures without reading bodies', async () => {
  const valid = fileReference(id, 'Alpha.html');
  const missing = fileReference(id, 'missing.html');
  const excluded = fileReference(id, 'excluded/Alpha.txt');
  const read = vi.spyOn(fs, 'readFile');
  const resolve = vi.spyOn(app.policy, 'resolve');
  const response = await app.main.inject({ method: 'POST', url: '/api/entries/status', headers, payload: { ids: [valid, missing, valid, excluded] } });
  expect(response.statusCode).toBe(200);
  expect(response.json().items).toMatchObject([
    { id: valid, status: 'ready', fileVersion: expect.any(String) },
    { id: missing, status: 'error', error: { code: 'ENTRY_MISSING' } },
    { id: valid, status: 'ready' },
    { id: excluded, status: 'error', error: { code: 'FORBIDDEN_FILE' } },
  ]);
  expect(resolve).toHaveBeenCalledTimes(3); expect(read).not.toHaveBeenCalled();
  expect((await app.main.inject({ method: 'POST', url: '/api/entries/status', headers, payload: { ids: Array(201).fill(valid) } })).statusCode).toBe(400);
});

test('continuations cannot change their directory, query or mount and expired cursors release handles', async () => {
  const changes: Record<string, string>[] = [{ path: 'nested', q: 'alpha' }, { q: 'other' }];
  for (const changed of changes) {
    const first = (await search({ q: 'alpha', limit: '1' })).json<FileSearchResult>();
    expect((await search({ ...changed, cursor: first.nextCursor! })).statusCode).toBe(409);
  }
  const initial = (await search({ q: 'alpha', limit: '1' })).json<FileSearchResult>();
  await app.main.inject({ method: 'POST', url: '/api/projects', headers, payload: { name: 'Other project', mount: { label: 'Same root', absolutePath: root } } });
  const otherId = app.registry.data.mounts[1].id;
  expect((await app.main.inject({ url: `/api/mounts/${otherId}/search?q=alpha&cursor=${initial.nextCursor}`, headers })).statusCode).toBe(409);

  const opened = vi.spyOn(fs, 'opendir');
  const first = (await search({ q: 'alpha', limit: '1' })).json<FileSearchResult>();
  const handle = await opened.mock.results[0].value;
  const closed = vi.spyOn(handle, 'close');
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1);
    expect((await search({ q: 'alpha', cursor: first.nextCursor! })).statusCode).toBe(410);
    expect(closed).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});

test('disconnecting an HTTP search cancels its in-flight page and closes the directory handle', async () => {
  await app.main.listen({ port: 0, host: '127.0.0.1' });
  const address = app.main.server.address();
  if (!address || typeof address === 'string') throw new Error('No test server port');
  let release!: () => void, entered!: () => void;
  const paused = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const original = app.policy.resolve.bind(app.policy);
  vi.spyOn(app.policy, 'resolve').mockImplementation(async (...args) => {
    const result = await original(...args);
    if (args[1] === 'Alpha.html') { entered(); await paused; }
    return result;
  });
  const opened = vi.spyOn(fs, 'opendir');
  const disconnected = new Promise<void>(resolve => app.main.server.once('request', (_request, response) => response.once('close', () => resolve())));
  const abort = new AbortController();
  const aborted = new Promise<void>((resolve, reject) => {
    const client = request({ hostname: '127.0.0.1', port: address.port, path: `/api/mounts/${id}/search?q=alpha&limit=1`, headers, signal: abort.signal }, response => { response.resume(); reject(new Error('Search completed before cancellation')); });
    client.on('error', error => error.name === 'AbortError' ? resolve() : reject(error));
    client.end();
  });
  await started;
  const handle = await opened.mock.results[0].value;
  const closed = vi.spyOn(handle, 'close');
  abort.abort(); await aborted; await disconnected; release();
  await expect.poll(() => closed.mock.calls.length).toBe(1);
});
