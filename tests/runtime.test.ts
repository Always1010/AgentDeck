import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import { dataHome, migrateLegacyState, projectRoot } from '../app/server/runtime.js';

const temporary: string[] = [];
async function fixture() { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentdeck-runtime-')); temporary.push(dir); return dir; }
afterEach(async () => { await Promise.all(temporary.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });
const registry = { schemaVersion: 1, revision: 7, projects: [{ id: 'kept', name: 'Research', order: 0 }], mounts: [], toolOverrides: [], entryPreferences: {} };

test('state uses AgentDeck outside the checkout on Windows and other systems', () => {
  expect(dataHome('local-data', 'home')).toBe(path.join('local-data', 'AgentDeck'));
  expect(dataHome('', 'home')).toBe(path.join('home', '.local', 'share', 'AgentDeck'));
});
test('source and compiled entry points resolve a relocated checkout independently of cwd', async () => {
  const root = path.join(await fixture(), 'Moved checkout with spaces');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'package.json'), '{"name":"agentdeck"}');
  for (const entry of ['app/server/main.ts', 'dist/server/server/main.js']) {
    expect(await projectRoot(pathToFileURL(path.join(root, entry)).href)).toBe(root);
  }
});
test('legacy migration preserves bytes, IDs and original, then never overwrites new state', async () => {
  const root = await fixture();
  const source = path.join(root, 'ProjectWorkbench', 'registry.json');
  const target = path.join(root, 'AgentDeck', 'state', 'registry.json');
  const bytes = JSON.stringify(registry, null, 2);
  await fs.mkdir(path.dirname(source)); await fs.writeFile(source, bytes);
  expect(await migrateLegacyState(root)).toBe(true);
  for (const file of [source, target, `${target}.legacy.bak`]) expect(await fs.readFile(file, 'utf8')).toBe(bytes);
  await fs.writeFile(target, 'new state');
  expect(await migrateLegacyState(root)).toBe(false);
  expect(await fs.readFile(target, 'utf8')).toBe('new state');
});
test('missing legacy state is harmless; corrupt legacy state fails without creating new registry', async () => {
  const root = await fixture();
  expect(await migrateLegacyState(root)).toBe(false);
  await fs.mkdir(path.join(root, 'ProjectWorkbench'));
  await fs.writeFile(path.join(root, 'ProjectWorkbench', 'registry.json'), '{}');
  await expect(migrateLegacyState(root)).rejects.toThrow();
  await expect(fs.access(path.join(root, 'AgentDeck', 'state', 'registry.json'))).rejects.toThrow();
});
