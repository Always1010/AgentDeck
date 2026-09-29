import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileSearchItem, FileSearchResult } from '../shared/fileOperations.js';
import { parseFileReference, type Snapshot, type ToolItem } from '../shared/model.js';
import type { OpenPage } from './pages.js';
import { api } from './api.js';
import { Dialog } from './Dialog.js';
import { fullFilePath } from './fileLocations.js';
import './quickOpen.css';

export function QuickOpen({ snapshot, pages, favorites, tools, open, reveal, close }: {
  snapshot: Snapshot;
  pages: OpenPage[];
  favorites: string[];
  tools: ToolItem[];
  open: (id: string) => void;
  reveal: (id: string) => void;
  close: () => void;
}) {
  const [scope, setScope] = useState('known');
  const [directory, setDirectory] = useState('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<FileSearchItem[]>([]);
  const [result, setResult] = useState<FileSearchResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cancelled, setCancelled] = useState(false);
  const controller = useRef<AbortController | undefined>(undefined);
  const cursor = useRef<string | undefined>(undefined);
  const generation = useRef(0);
  const release = (value?: string) => { if (value) void api(`/api/file-search/${encodeURIComponent(value)}`, 'DELETE').catch(() => undefined); };
  function stop(clear = false) {
    generation.current++;
    controller.current?.abort();
    release(cursor.current); cursor.current = undefined;
    setBusy(false); setResult(undefined); setError(''); setCancelled(!clear);
    if (clear) setItems([]);
  }
  useEffect(() => () => { generation.current++; controller.current?.abort(); release(cursor.current); }, []);
  const known = useMemo(() => {
    const candidates = new Map<string, { id: string; title: string; categories: string[] }>();
    function add(id: string, title: string, category: string) {
      const reference = parseFileReference(id);
      if (!reference) return;
      const previous = candidates.get(id);
      if (previous) { if (!previous.categories.includes(category)) previous.categories.push(category); return; }
      candidates.set(id, { id, title: title || reference.relativePath.split('/').pop()!, categories: [category] });
    }
    pages.forEach(page => add(page.id, page.title || '', '已打开'));
    favorites.forEach(id => add(id, '', '收藏'));
    tools.forEach(tool => add(tool.id, tool.title, '工具'));
    return [...candidates.values()];
  }, [pages, favorites, tools]);
  const matching = known.filter(item => `${item.title} ${fullFilePath(snapshot, item.id) || item.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  async function search(more = false) {
    if (scope === 'known' || !query.trim() || busy) return;
    if (!more) stop(true);
    const token = ++generation.current;
    const request = new AbortController(); controller.current = request;
    const previousCursor = more ? cursor.current : undefined;
    setBusy(true); setError(''); setCancelled(false);
    try {
      const params = new URLSearchParams({ path: directory.trim(), q: query.trim(), limit: '100' });
      if (previousCursor) params.set('cursor', previousCursor);
      const next = await api<FileSearchResult>(`/api/mounts/${encodeURIComponent(scope)}/search?${params}`, 'GET', undefined, { signal: request.signal });
      if (token !== generation.current || request.signal.aborted) { release(next.nextCursor); return; }
      cursor.current = next.nextCursor;
      setResult(next);
      setItems(previous => [...new Map([...(more ? previous : []), ...next.items].map(item => [item.id, item])).values()].slice(0, 1000));
    } catch (reason) {
      if (token === generation.current && !request.signal.aborted) { setError((reason as Error).message); release(cursor.current); cursor.current = undefined; setResult(undefined); }
    } finally { if (token === generation.current) setBusy(false); }
  }
  function choose(id: string, locate = false) { close(); if (locate) reveal(id); else open(id); }
  function row(id: string, title: string, category?: string) {
    const location = fullFilePath(snapshot, id) || parseFileReference(id)?.relativePath || id;
    return <li key={id}><button className="quick-open-file" title={location} onClick={() => choose(id)}><strong>{title}</strong>{category && <span>{category}</span>}<small>{location}</small></button><button aria-label={`在目录定位：${title}`} onClick={() => choose(id, true)}>定位</button></li>;
  }
  return <Dialog label="快速打开" close={close} className="quick-open-dialog">
    <header><h2>快速打开</h2><button aria-label="关闭快速打开" onClick={close}>×</button></header>
    <form onSubmit={event => { event.preventDefault(); if (scope === 'known') { if (matching[0]) choose(matching[0].id); } else void search(); }}>
      <label>查找文件<input data-autofocus type="search" aria-label="查找文件" maxLength={200} value={query} onChange={event => { if (scope !== 'known') stop(true); setQuery(event.target.value); }} placeholder="输入文件名或路径"/></label>
      <label>查找范围<select aria-label="查找范围" value={scope} onChange={event => { stop(true); setScope(event.target.value); setDirectory(''); }}><option value="known">已打开、收藏和工具</option>{snapshot.mounts.filter(mount => mount.enabled).map(mount => <option key={mount.id} value={mount.id}>{snapshot.projects.find(project => project.id === mount.projectId)?.name} / {mount.label}</option>)}</select></label>
      {scope !== 'known' && <><label>目录范围<input aria-label="目录范围" maxLength={1024} value={directory} onChange={event => { stop(true); setDirectory(event.target.value); }} placeholder="相对目录，留空查找该挂载；例如 reports/2026"/></label><p className="muted">只查文件名和路径，包含所选目录的子目录；不读取正文，不改变文件树筛选。</p><button type="submit" disabled={busy || !query.trim()}>搜索目录</button>{(busy || result?.nextCursor) && <button type="button" onClick={() => stop()}>取消搜索</button>}</>}
    </form>
    {error && <p role="alert">{error}</p>}
    <p role="status">{scope === 'known' ? `找到 ${matching.length} 个常用文件` : busy ? '正在搜索所选目录…' : cancelled ? '已取消搜索，已返回的结果保留。' : result ? `已检查 ${result.scanned} 项，找到 ${items.length} 个文件${result.done ? '，搜索完成' : '，可继续搜索'}${result.skipped ? `；跳过 ${result.skipped} 个不可访问项` : ''}` : '选择范围并点击搜索目录。'}</p>
    <ul className="quick-open-results">{scope === 'known' ? matching.slice(0, 200).map(item => row(item.id, item.title, item.categories.join(' / '))) : items.map(item => row(item.id, item.name))}</ul>
    {scope === 'known' && matching.length > 200 && <p>显示前 200 项，请输入更具体的名称。</p>}
    {scope !== 'known' && result?.nextCursor && items.length < 1000 && <button disabled={busy} onClick={() => void search(true)}>继续搜索</button>}
    {items.length >= 1000 && <p>最多显示 1000 个结果，请缩小目录或关键词范围后重新搜索。</p>}
  </Dialog>;
}
