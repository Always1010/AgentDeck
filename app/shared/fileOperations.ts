export type FileSearchItem = { id: string; mountId: string; name: string; relativePath: string; format: string };
export type FileSearchResult = { items: FileSearchItem[]; nextCursor?: string; scanned: number; done: boolean; skipped: number };
export type FileStatusResult = { items: { id: string; status: 'ready' | 'error'; fileVersion?: string; error?: { code: string; message: string } }[] };
