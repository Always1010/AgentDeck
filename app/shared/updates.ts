import type { FileTypeFilter } from './file-types.js';

export type FileUpdate = {
  id: string; mountId: string; relativePath: string; version: string;
  kind: 'added' | 'modified'; changedAt: number; sequence: number;
};
export type UpdatesSnapshot = {
  initialized: boolean; filter: FileTypeFilter; items: FileUpdate[];
  total: number; through: number; busy: boolean; errors: string[];
};
export const fileVersion = (stat: { mtimeMs: number; ctimeMs: number; size: number }) => `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
