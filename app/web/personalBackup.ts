import { isSavedReadingSession, PERSONAL_PREFERENCES_ID, validateReadingSnapshot, type ReadingSnapshot, type SavedReadingSession } from './readingSessions.js';
export { PERSONAL_PREFERENCES_ID } from './readingSessions.js';

export const PERSONAL_BACKUP_LIMIT = 5 * 1024 * 1024;
const MAX_COLLECTIONS = 100;
const MAX_FAVORITES = 5000;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const oneOf = (...items: unknown[]) => (value: unknown) => items.includes(value);
const boolean = (value: unknown) => typeof value === 'boolean';
const preferenceRules: Record<string, (value: unknown) => boolean> = {
  theme: oneOf('system', 'light', 'dark'),
  'html.opening': oneOf('workbench', 'browser'),
  'html.shortcuts': oneOf('web', 'workbench'),
  'shortcuts.enabled': boolean,
  'shortcuts.navigation': boolean,
  'reading.close-empty': oneOf('keep', 'remove'),
  'reading.confirm-pane-close': boolean,
  'reading.font-size': value => typeof value === 'number' && Number.isInteger(value) && value >= 12 && value <= 24,
  'updates.expanded': boolean,
};
const favoritesValid = (value: unknown): value is string[] => Array.isArray(value) && value.length <= MAX_FAVORITES && value.every(id => typeof id === 'string' && id.length > 0 && id.length <= 4096 && !/[\u0000-\u001f]/.test(id));
export type PersonalBackup = {
  format: 'agentdeck-personal-backup'; version: 1; exportedAt: string;
  preferences: Record<string, unknown>;
  favorites: string[];
  collections: { name: string; pinned: boolean; snapshot: ReadingSnapshot }[];
};
export type PendingPersonalPreferences = { id: string; version: 1; token: string; values: Record<string, unknown> };
export type PersonalBackupStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type PersonalBackupPersistence = {
  list(): Promise<unknown[]>;
  /** All new records and pending preferences must commit in one transaction; records must use add, not put. */
  commit(records: SavedReadingSession[], pending: PendingPersonalPreferences): Promise<void>;
  pending(): Promise<unknown | null>;
  /** Remove only if the token still matches; a concurrent newer import must survive. */
  clearPending(token: string): Promise<void>;
};

function onlyKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).every(key => keys.includes(key));
}
function safeObjectTree(value: unknown) {
  const stack: unknown[] = [value];
  while (stack.length) {
    const next = stack.pop();
    if (!next || typeof next !== 'object') continue;
    for (const [key, child] of Object.entries(next)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) return false;
      if (child && typeof child === 'object') stack.push(child);
    }
  }
  return true;
}
function validPreferences(value: unknown): value is Record<string, unknown> {
  return object(value) && Object.entries(value).every(([key, entry]) => Object.hasOwn(preferenceRules, key) && preferenceRules[key](entry));
}
export function isPendingPersonalPreferences(value: unknown): value is PendingPersonalPreferences {
  if (!object(value) || value.id !== PERSONAL_PREFERENCES_ID || value.version !== 1 || typeof value.token !== 'string' || !value.token || !object(value.values)) return false;
  return Object.entries(value.values).every(([key, entry]) => key === 'favorites' ? favoritesValid(entry) : Object.hasOwn(preferenceRules, key) && preferenceRules[key](entry));
}

export function parsePersonalBackup(text: string): PersonalBackup {
  if (new TextEncoder().encode(text).byteLength > PERSONAL_BACKUP_LIMIT) throw new Error('备份文件超过 5 MiB，未导入任何内容。');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('不是有效的 JSON 备份文件。'); }
  if (!object(value) || !safeObjectTree(value) || !onlyKeys(value, ['format', 'version', 'exportedAt', 'preferences', 'favorites', 'collections'])
    || value.format !== 'agentdeck-personal-backup' || value.version !== 1 || typeof value.exportedAt !== 'string' || !Number.isFinite(Date.parse(value.exportedAt))
    || !validPreferences(value.preferences) || !favoritesValid(value.favorites) || !Array.isArray(value.collections) || value.collections.length > MAX_COLLECTIONS
    || !value.collections.every(item => object(item) && onlyKeys(item, ['name', 'pinned', 'snapshot']) && typeof item.name === 'string' && item.name.trim().length > 0 && item.name.length <= 120 && typeof item.pinned === 'boolean' && validateReadingSnapshot(item.snapshot))) {
    throw new Error('备份版本、设置或阅读组合无效，未导入任何内容。');
  }
  return { ...value, favorites: [...new Set(value.favorites)] } as PersonalBackup;
}

export function createPersonalBackupManager(options: { storage: PersonalBackupStorage; persistence: PersonalBackupPersistence; newId: () => string; now: () => number }) {
  const { storage, persistence } = options;
  async function exportBackup() {
    const preferences: Record<string, unknown> = {};
    for (const [key, valid] of Object.entries(preferenceRules)) {
      let value: unknown;
      try { value = JSON.parse(storage.getItem(key) || 'null'); } catch { continue; }
      if (valid(value)) preferences[key] = value;
    }
    let favorites: unknown = [];
    try { favorites = JSON.parse(storage.getItem('favorites') || '[]'); } catch { throw new Error('收藏记录无法读取，请先检查浏览器存储。'); }
    if (!favoritesValid(favorites)) throw new Error('收藏记录无效，未生成备份。');
    const records = (await persistence.list()).filter(isSavedReadingSession).filter(record => record.collection);
    const backup: PersonalBackup = {
      format: 'agentdeck-personal-backup', version: 1, exportedAt: new Date(options.now()).toISOString(), preferences,
      favorites: [...new Set(favorites)],
      collections: records.map((record, index) => ({ name: record.name || `常用组合 ${index + 1}`, pinned: !!record.pinned, snapshot: structuredClone(record.snapshot) })),
    };
    const text = JSON.stringify(backup, null, 2);
    parsePersonalBackup(text);
    return text;
  }
  async function importBackup(text: string) {
    const backup = parsePersonalBackup(text);
    const now = options.now();
    const records: SavedReadingSession[] = backup.collections.map(item => ({ ...item, id: options.newId(), collection: true, activeAt: 0, updatedAt: now, snapshot: structuredClone(item.snapshot) }));
    const pending: PendingPersonalPreferences = { id: PERSONAL_PREFERENCES_ID, version: 1, token: options.newId(), values: { ...backup.preferences, favorites: backup.favorites } };
    await persistence.commit(records, pending);
    return { collections: records.length, favorites: backup.favorites.length };
  }
  /** Apply only on a fresh workbench boot. Durable import remains available if projection fails. */
  async function applyPendingPreferences(): Promise<{ applied: boolean; error?: string }> {
    let pending: unknown;
    try { pending = await persistence.pending(); }
    catch (error) { return { applied: false, error: `无法检查待应用的个人设置：${(error as Error).message}` }; }
    if (!pending) return { applied: false };
    if (!isPendingPersonalPreferences(pending)) return { applied: false, error: '待应用的个人设置无效，原记录已保留。' };
    const before = new Map<string, string | null>();
    const written: string[] = [];
    try {
      for (const key of Object.keys(pending.values)) before.set(key, storage.getItem(key));
      for (const [key, value] of Object.entries(pending.values)) { written.push(key); storage.setItem(key, JSON.stringify(value)); }
      await persistence.clearPending(pending.token);
      return { applied: true };
    } catch (error) {
      let rollbackFailed = false;
      for (const key of written.reverse()) {
        try { const previous = before.get(key); if (previous === null || previous === undefined) storage.removeItem(key); else storage.setItem(key, previous); }
        catch { rollbackFailed = true; }
      }
      return { applied: false, error: `个人设置尚未应用，导入记录已保留${rollbackFailed ? '，部分偏好无法回退，请释放浏览器存储空间后刷新重试' : '，请稍后刷新重试'}：${(error as Error).message}` };
    }
  }
  return { exportBackup, importBackup, applyPendingPreferences };
}
