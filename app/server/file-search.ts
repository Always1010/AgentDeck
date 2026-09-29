import fs from 'node:fs/promises';
import type { Dir } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileReference, type Mount } from '../shared/model.js';
import type { FileSearchResult } from '../shared/fileOperations.js';
import { AppError } from './errors.js';
import { hidden, PathPolicy, relative } from './path-policy.js';

type Search = {
  id: string; signature: string; mountId: string; scope: string; query: string;
  directories: string[]; current?: { relativePath: string; handle: Dir };
  scanned: number; skipped: number; expires: number; busy: boolean; cancelled: boolean;
};
const ttl = 5 * 60_000;
const signature = (mount: Mount) => JSON.stringify([mount.absolutePath, mount.enabled, mount.excludes]);

/** User-initiated metadata search. Cursors retain only directory traversal state. */
export class FileSearch {
  private searches = new Map<string, Search>();
  private timer: ReturnType<typeof setInterval>;
  constructor(private policy: PathPolicy) {
    this.timer = setInterval(() => {
      for (const search of this.searches.values()) if (!search.busy && search.expires <= Date.now()) void this.dispose(search);
    }, 30_000);
    this.timer.unref();
  }
  private async dispose(search: Search) {
    search.cancelled = true;
    this.searches.delete(search.id);
    const current = search.current;
    search.current = undefined;
    await current?.handle.close().catch(() => {});
  }
  async cancel(id: string) {
    const search = this.searches.get(id);
    if (!search) return;
    search.cancelled = true;
    if (!search.busy) await this.dispose(search);
  }
  async page(mount: Mount, input: { path: string; q: string; cursor?: string; limit: number }, signal?: AbortSignal): Promise<FileSearchResult> {
    const scope = relative(input.path);
    const query = input.q.trim().toLocaleLowerCase();
    let search = input.cursor ? this.searches.get(input.cursor) : undefined;
    if (input.cursor && (!search || search.expires <= Date.now())) {
      if (search && !search.busy) await this.dispose(search);
      throw new AppError('SEARCH_EXPIRED', '搜索已过期，请重新搜索', 410);
    }
    if (search && (search.mountId !== mount.id || search.signature !== signature(mount) || search.scope !== scope || search.query !== query)) {
      if (!search.busy) await this.dispose(search);
      throw new AppError('SEARCH_CHANGED', '搜索范围或目录配置已变化，请重新搜索', 409);
    }
    if (search?.busy) throw new AppError('SEARCH_BUSY', '上一页搜索尚未完成', 409);
    if (!search) {
      const directory = await this.policy.resolve(mount, scope, false, 'file');
      if (!directory.stat.isDirectory()) throw new AppError('INVALID_PATH', '请选择搜索目录', 400);
      while (this.searches.size >= 20) {
        const oldest = [...this.searches.values()].filter(item => !item.busy).sort((a, b) => a.expires - b.expires)[0];
        if (oldest) await this.dispose(oldest);
        else throw new AppError('SEARCH_BUSY', '正在执行的搜索过多，请稍后重试', 429);
      }
      search = { id: randomUUID(), signature: signature(mount), mountId: mount.id, scope, query, directories: [scope], scanned: 0, skipped: 0, expires: Date.now() + ttl, busy: false, cancelled: false };
      this.searches.set(search.id, search);
    }
    const currentSearch = search;
    const abort = () => { currentSearch.cancelled = true; };
    signal?.addEventListener('abort', abort, { once: true });
    currentSearch.busy = true;
    const items: FileSearchResult['items'] = [];
    const started = performance.now();
    let checked = 0;
    try {
      while (items.length < input.limit && checked < 500 && performance.now() - started < 200) {
        if (signal?.aborted || currentSearch.cancelled) throw new AppError('SEARCH_CANCELLED', '搜索已取消', 499);
        if (!currentSearch.current) {
          const directoryPath = currentSearch.directories.pop();
          if (directoryPath === undefined) break;
          try {
            const directory = await this.policy.resolve(mount, directoryPath, false, 'file');
            currentSearch.current = { relativePath: directoryPath, handle: await fs.opendir(directory.real) };
          } catch { currentSearch.skipped++; continue; }
        }
        const directory = currentSearch.current;
        let child;
        try { child = await directory.handle.read(); }
        catch { currentSearch.skipped++; }
        if (!child) {
          await directory.handle.close().catch(() => {});
          currentSearch.current = undefined;
          continue;
        }
        checked++; currentSearch.scanned++;
        const childPath = [directory.relativePath, child.name].filter(Boolean).join('/');
        if (child.isSymbolicLink() || hidden(childPath, mount.excludes)) continue;
        try {
          const file = await this.policy.resolve(mount, childPath, false, 'file');
          if (file.stat.isDirectory()) currentSearch.directories.push(childPath);
          else if (childPath.toLocaleLowerCase().includes(query)) items.push({ id: fileReference(mount.id, childPath), mountId: mount.id, name: child.name, relativePath: childPath, format: path.extname(child.name).slice(1).toLowerCase() });
        } catch { currentSearch.skipped++; }
      }
      if (signal?.aborted || currentSearch.cancelled) throw new AppError('SEARCH_CANCELLED', '搜索已取消', 499);
      const done = !currentSearch.current && currentSearch.directories.length === 0;
      currentSearch.expires = Date.now() + ttl;
      const result: FileSearchResult = { items, scanned: currentSearch.scanned, skipped: currentSearch.skipped, done, ...(!done ? { nextCursor: currentSearch.id } : {}) };
      if (done) await this.dispose(currentSearch);
      return result;
    } catch (error) { await this.dispose(currentSearch); throw error; }
    finally { currentSearch.busy = false; signal?.removeEventListener('abort', abort); }
  }
  async close() {
    clearInterval(this.timer);
    await Promise.all([...this.searches.values()].map(search => this.cancel(search.id)));
  }
}
