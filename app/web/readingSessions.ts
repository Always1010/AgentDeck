import type { Workspace } from './workspace.js';

export type ReadingSnapshot = {
  version: 1;
  workspace: Workspace;
  view: { immersive: boolean; collapsed: boolean; width: number; openedExpanded: boolean; view: 'files' | 'favorites' | 'tools'; query: string };
  positions: Record<string, { x: number; y: number }>;
  expanded: Record<string, string[]>;
};
export type ReadingSessionSummary = { id: string; updatedAt: number; activeAt: number; paneCount: number; titles: string[] };
export type ReadingSession = {
  id: string;
  snapshot: ReadingSnapshot | null;
  /** Only foreground user activity should pass true; background saves must not change recency. */
  save(snapshot: ReadingSnapshot, activity?: boolean): Promise<void>;
  /** Drains pending writes before releasing ownership. Do not call for a persisted pagehide. */
  close(): void;
};

type SavedReadingSession = { id: string; updatedAt: number; activeAt: number; snapshot: ReadingSnapshot };
export type ReadingSessionStore = {
  get(id: string): Promise<unknown | null>;
  list(): Promise<unknown[]>;
  put(record: SavedReadingSession): Promise<void>;
};
type Dependencies = {
  store: ReadingSessionStore;
  /** Returns a release callback if exclusively acquired, otherwise null. */
  claim(id: string): Promise<(() => void) | null>;
  supportsOwnership: boolean;
  newId(): string;
  now(): number;
};

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(entry => typeof entry === 'string');
const unique = (items: unknown[]) => new Set(items).size === items.length;

/** Validate before hydration or persistence; malformed trees must never reach the renderer. */
export function validateReadingSnapshot(value: unknown): value is ReadingSnapshot {
  if (!object(value) || value.version !== 1 || !object(value.workspace) || !object(value.view) || !object(value.positions) || !object(value.expanded)) return false;
  const workspace = value.workspace;
  if (!object(workspace.panes) || !object(workspace.histories) || !integer(workspace.active) || !integer(workspace.nextPane)) return false;
  const paneKeys = Object.keys(workspace.panes);
  if (!paneKeys.length || paneKeys.length > 256 || paneKeys.some(key => !/^(0|[1-9]\d*)$/.test(key) || !integer(Number(key)))) return false;
  const paneIds = new Set(paneKeys.map(Number));
  if (!paneIds.has(workspace.active) || workspace.nextPane <= Math.max(...paneIds)) return false;
  if (workspace.maximized !== null && (!integer(workspace.maximized) || !paneIds.has(workspace.maximized))) return false;
  if (Object.keys(workspace.histories).length !== paneKeys.length) return false;
  for (const key of paneKeys) {
    const pane = workspace.panes[key];
    const history = workspace.histories[key];
    if (!object(pane) || !Array.isArray(pane.items) || !strings(pane.recent) || typeof pane.active !== 'string') return false;
    if (!pane.items.every(page => object(page) && typeof page.id === 'string' && page.id.length > 0 && typeof page.kept === 'boolean' && (page.title === undefined || typeof page.title === 'string'))) return false;
    const ids = pane.items.map(page => page.id as string);
    if (!unique(ids) || !unique(pane.recent) || pane.recent.some(id => !ids.includes(id)) || (ids.length ? !ids.includes(pane.active) : pane.active !== '')) return false;
    if (!object(history) || !strings(history.entries) || history.entries.some(id => !id) || !Number.isSafeInteger(history.index)) return false;
    if (history.entries.length ? (history.index as number) < 0 || (history.index as number) >= history.entries.length : history.index !== -1) return false;
  }
  const leaves = new Set<number>();
  const splits = new Set<string>();
  const seen = new Set<object>();
  const queue: unknown[] = [workspace.root];
  while (queue.length) {
    const node = queue.pop();
    if (!object(node) || seen.has(node) || seen.size >= 511) return false;
    seen.add(node);
    if (node.type === 'pane') {
      if (!integer(node.pane) || !paneIds.has(node.pane) || leaves.has(node.pane)) return false;
      leaves.add(node.pane);
    } else if (node.type === 'split') {
      if (typeof node.id !== 'string' || !node.id || splits.has(node.id) || !['columns', 'rows'].includes(node.direction as string) || !finite(node.ratio) || node.ratio < 5 || node.ratio > 95) return false;
      splits.add(node.id);
      queue.push(node.first, node.second);
    } else return false;
  }
  if (leaves.size !== paneIds.size) return false;
  const view = value.view;
  if (typeof view.immersive !== 'boolean' || typeof view.collapsed !== 'boolean' || typeof view.openedExpanded !== 'boolean' || !finite(view.width) || view.width <= 0 || !['files', 'favorites', 'tools'].includes(view.view as string) || typeof view.query !== 'string') return false;
  return Object.values(value.positions).every(position => object(position) && finite(position.x) && finite(position.y) && position.x >= 0 && position.y >= 0)
    && Object.values(value.expanded).every(strings);
}

function isSaved(value: unknown): value is SavedReadingSession {
  return object(value) && typeof value.id === 'string' && !!value.id && finite(value.updatedAt) && finite(value.activeAt) && validateReadingSnapshot(value.snapshot);
}
function mostRecent(a: SavedReadingSession, b: SavedReadingSession) {
  // A background save must not break a recency tie and become the default scene.
  return b.activeAt - a.activeAt || a.id.localeCompare(b.id);
}
function summary(record: SavedReadingSession): ReadingSessionSummary {
  const panes = Object.values(record.snapshot.workspace.panes);
  return { id: record.id, updatedAt: record.updatedAt, activeAt: record.activeAt, paneCount: panes.length,
    titles: [...new Set(panes.flatMap(pane => pane.items.map(page => page.title || page.id)))].slice(0, 8) };
}

/** Dependency boundary lets ownership, transaction failures and write ordering be tested without a browser. */
export function createReadingSessionManager(dependencies: Dependencies) {
  const { store } = dependencies;
  async function read(id: string): Promise<SavedReadingSession | null> {
    const record = await store.get(id);
    if (record !== null && (!isSaved(record) || record.id !== id)) throw new Error('保存的阅读现场无法读取，原记录已保留。');
    return record;
  }
  async function listReadingSessions(): Promise<ReadingSessionSummary[]> {
    return (await store.list()).filter(isSaved).sort(mostRecent).map(summary);
  }
  async function openReadingSession(requestedId?: string): Promise<ReadingSession> {
    let source: SavedReadingSession | null = null;
    if (requestedId) source = await read(requestedId);
    else source = (await store.list()).filter(isSaved).sort(mostRecent)[0] || null;
    let id = requestedId || source?.id || dependencies.newId();
    let release: (() => void) | null = null;
    if (dependencies.supportsOwnership) release = await dependencies.claim(id);
    if (!release) {
      // Without exclusive ownership every document writes its own copy. Never overwrite another tab.
      do {
        id = dependencies.newId();
        release = dependencies.supportsOwnership ? await dependencies.claim(id) : () => undefined;
      } while (!release);
    }
    let snapshot: ReadingSnapshot | null;
    let activeAt: number;
    try {
      // The former owner can finish a final transaction between our initial read and lock acquisition.
      // Read again under the lock before hydration can auto-save and overwrite that newer transaction.
      if (dependencies.supportsOwnership && (id === requestedId || id === source?.id)) source = await read(id);
      snapshot = source ? structuredClone(source.snapshot) : null;
      activeAt = source?.activeAt || 0;
      if (source && id !== source.id) {
        const now = dependencies.now();
        await store.put({ id, updatedAt: now, activeAt, snapshot: snapshot! });
      }
    } catch (error) { release(); throw error; }
    let closed = false;
    type WaitingSave = { record: SavedReadingSession; listeners: { resolve: () => void; reject: (error: unknown) => void }[] };
    let pending: WaitingSave | undefined;
    let writing = false;
    let released = false;
    function releaseIfDrained() {
      if (closed && !writing && !pending && !released) { released = true; release!(); }
    }
    async function drain() {
      if (writing) return;
      writing = true;
      while (pending) {
        const current = pending; pending = undefined;
        try {
          await store.put(current.record);
          snapshot = current.record.snapshot; session.snapshot = snapshot;
          for (const listener of current.listeners) listener.resolve();
        } catch (error) {
          // Reject all requests represented by this write, then continue with the newest pending state.
          for (const listener of current.listeners) listener.reject(error);
        }
      }
      writing = false; releaseIfDrained();
    }
    const session: ReadingSession = {
      id,
      snapshot,
      save(nextSnapshot, activity = false) {
        if (closed) return Promise.reject(new Error('阅读现场已关闭，未保存后续更改。'));
        if (!validateReadingSnapshot(nextSnapshot)) return Promise.reject(new Error('阅读现场状态无效，原记录已保留。'));
        const next = structuredClone(nextSnapshot);
        const now = dependencies.now();
        if (activity) activeAt = Math.max(activeAt, now);
        const record = { id, updatedAt: now, activeAt, snapshot: next };
        return new Promise<void>((resolve, reject) => {
          if (pending) { pending.record = record; pending.listeners.push({ resolve, reject }); }
          else pending = { record, listeners: [{ resolve, reject }] };
          void drain();
        });
      },
      close() {
        if (closed) return;
        closed = true;
        releaseIfDrained();
      },
    };
    return session;
  }
  return { openReadingSession, listReadingSessions };
}

const DATABASE = 'agentdeck-reading-sessions';
const STORE = 'sessions';
let databasePromise: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('浏览器未提供本地存储，当前阅读现场无法保存。')); return; }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onerror = () => reject(request.error || new Error('无法打开阅读现场存储。'));
    let blocked = false;
    request.onblocked = () => { blocked = true; reject(new Error('阅读现场存储正在升级，请关闭旧版页面后重试。')); };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) { db.close(); return; }
      db.onversionchange = () => { db.close(); databasePromise = undefined; };
      resolve(db);
    };
  }).catch(error => { databasePromise = undefined; throw error; });
  return databasePromise;
}
async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = run(tx.objectStore(STORE));
    // Resolve on commit, not request success: quota/abort may still roll back the transaction.
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error || request.error || new Error('保存阅读现场失败，请检查浏览器存储空间。'));
    tx.onerror = () => reject(tx.error || request.error || new Error('无法访问阅读现场存储。'));
  });
}
const browserStore: ReadingSessionStore = {
  get: async id => (await transaction('readonly', store => store.get(id))) ?? null,
  list: () => transaction('readonly', store => store.getAll()),
  put: async record => { await transaction('readwrite', store => store.put(record)); },
};
function claimBrowserSession(id: string): Promise<(() => void) | null> {
  return new Promise((resolve, reject) => {
    // The callback stays pending while the document owns this scene. The browser releases it on destruction.
    // Keep it during BFCache suspension; persisted pagehide must not release an owner that can resume later.
    void navigator.locks.request(`agentdeck-reading-session:${id}`, { mode: 'exclusive', ifAvailable: true }, lock => {
      if (!lock) { resolve(null); return; }
      return new Promise<void>(release => resolve(release));
    }).catch(reject);
  });
}
let browserManager: ReturnType<typeof createReadingSessionManager> | undefined;
function manager() {
  return browserManager ||= createReadingSessionManager({
    store: browserStore,
    claim: claimBrowserSession,
    supportsOwnership: typeof navigator !== 'undefined' && !!navigator.locks,
    // LAN HTTP deployments may have getRandomValues but no secure-context randomUUID or Web Locks.
    newId: () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join(''),
    now: () => Date.now(),
  });
}
export const openReadingSession = (requestedId?: string) => manager().openReadingSession(requestedId);
export const listReadingSessions = () => manager().listReadingSessions();
