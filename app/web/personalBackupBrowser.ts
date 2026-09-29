import { createPersonalBackupManager } from './personalBackup.js';
import { clearPendingPersonalPreferences, commitPersonalBackup, listPersonalBackupRecords, readPendingPersonalPreferences } from './readingSessions.js';

function manager() {
  return createPersonalBackupManager({
    storage: { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value), removeItem: key => localStorage.removeItem(key) },
    persistence: { list: listPersonalBackupRecords, commit: commitPersonalBackup, pending: readPendingPersonalPreferences, clearPending: clearPendingPersonalPreferences },
    newId: () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join(''),
    now: () => Date.now(),
  });
}
async function exclusive<T>(run: () => Promise<T>): Promise<T> {
  return navigator.locks ? await navigator.locks.request('agentdeck-personal-preferences', run) : run();
}
export const exportPersonalBackup = () => manager().exportBackup();
export const importPersonalBackup = (text: string) => exclusive(() => manager().importBackup(text));
export async function applyPendingPersonalPreferences(): Promise<{ applied: boolean; error?: string }> {
  try { return await exclusive(() => manager().applyPendingPreferences()); }
  catch (error) { return { applied: false, error: `个人设置尚未应用，请检查浏览器存储后刷新：${(error as Error).message}` }; }
}
