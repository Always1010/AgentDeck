import fs from 'node:fs/promises';
import path from 'node:path';
import { registrySchema, type RegistryData } from '../shared/model.js';
import { AppError } from './errors.js';
export class Registry {
  data!: RegistryData;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(public directory: string) {}
  get file() { return path.join(this.directory, 'registry.json'); }
  async load() {
    await fs.mkdir(this.directory, { recursive: true });
    this.directory = await fs.realpath(this.directory);
    try { this.data = registrySchema.parse(JSON.parse(await fs.readFile(this.file, 'utf8'))); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new AppError('REGISTRY_CORRUPT', `注册表损坏，原文件已保留。停止服务后从 ${this.file}.bak 恢复。`, 500);
      this.data = { schemaVersion: 1, revision: 0, projects: [], mounts: [], toolOverrides: [], entryPreferences: {} };
    }
  }
  mutate<T>(change: (draft: RegistryData) => T | Promise<T>): Promise<T> {
    const job = this.queue.then(async () => {
      const draft = structuredClone(this.data);
      const result = await change(draft);
      draft.revision++;
      registrySchema.parse(draft);
      try {
        await fs.writeFile(`${this.file}.tmp`, JSON.stringify(draft, null, 2), 'utf8');
        try { await fs.copyFile(this.file, `${this.file}.bak`); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
        await fs.rename(`${this.file}.tmp`, this.file);
      } catch { throw new AppError('CONFIG_WRITE_FAILED', '配置保存失败，原配置仍有效', 500); }
      this.data = draft;
      return result;
    });
    this.queue = job.catch(() => {});
    return job;
  }
}
