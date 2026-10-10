import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Dialog } from './Dialog.js';
import { Icon } from './Icon.js';

type Listing = { current: string; parent: string; items: { name: string; absolutePath: string; directory: boolean }[] };
export function parentDirectory(file: string) {
  const end = Math.max(file.lastIndexOf('\\'), file.lastIndexOf('/'));
  return (end === 2 && /^[a-z]:/i.test(file)) || end === 0 ? file.slice(0, end + 1) : end > 0 ? file.slice(0, end) : '';
}

export function HtmlFilePicker({ initial, choose, close }: { initial: string; choose: (file: string) => void; close: () => void }) {
  const [locations, setLocations] = useState<string[]>([]);
  const [input, setInput] = useState(initial);
  const [listing, setListing] = useState<Listing>();
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const request = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(true);
  const inputVersion = useRef(0);
  async function browse(directory: string) {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    const version = inputVersion.current;
    setInput(directory); setLoading(true); setError(''); setListing(undefined); setSelected('');
    try {
      const result = await api<Listing>(`/api/fs/html-files?absolutePath=${encodeURIComponent(directory)}`, 'GET', undefined, { signal: controller.signal });
      if (!controller.signal.aborted && mounted.current) { setListing(result); if (inputVersion.current === version) setInput(result.current); }
    } catch (e) { if (!controller.signal.aborted && mounted.current) setError((e as Error).message); }
    finally { if (!controller.signal.aborted && mounted.current) setLoading(false); }
  }
  useEffect(() => {
    mounted.current = true; const controller = new AbortController();
    void api<{ locations: string[] }>('/api/fs/locations', 'GET', undefined, { signal: controller.signal }).then(data => {
      if (controller.signal.aborted) return;
      setLocations(data.locations); if (!request.current && inputVersion.current === 0) void browse(initial || data.locations[0]);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => { mounted.current = false; controller.abort(); request.current?.abort(); };
  }, []);
  return <Dialog label="选择本机 HTML 文件" close={close} nested className="html-file-picker">
    <header><h2>选择 HTML 文件</h2><button aria-label="关闭文件选择器" title="关闭文件选择器" onClick={close}><Icon name="close"/></button></header>
    <p className="muted">浏览运行 AgentDeck 的电脑，选中一个 .html 或 .htm 文件。</p>
    <div className="row html-file-locations">{locations.map(location => <button key={location} title={location} onClick={() => void browse(location)}>{location}</button>)}</div>
    <form className="tool-path-field" onSubmit={event => { event.preventDefault(); void browse(input.trim()); }}><label className="html-location-label">当前位置<input data-autofocus value={input} onChange={event => { inputVersion.current++; setInput(event.target.value); }} /></label><button title="前往此路径" aria-label="前往此路径" disabled={!input.trim()}><Icon name="forward"/></button></form>
    <button title="上一级目录" aria-label="上一级目录" disabled={!listing || loading || listing.current === listing.parent} onClick={() => listing && void browse(listing.parent)}><Icon name="up"/></button>
    {error && <p role="alert">{error}</p>}
    <div className="tool-picker-files" aria-label="本机文件列表" aria-busy={loading}>{loading ? <p className="muted">正在读取…</p> : listing?.items.map(item => <button key={item.absolutePath} title={item.absolutePath} className={selected === item.absolutePath ? 'selected' : ''} aria-label={`${item.directory ? '打开文件夹' : '选择文件'}：${item.name}`} aria-pressed={!item.directory ? selected === item.absolutePath : undefined} onClick={() => item.directory ? void browse(item.absolutePath) : setSelected(item.absolutePath)} onDoubleClick={() => { if (!item.directory) choose(item.absolutePath); }}><Icon name={item.directory ? 'folder' : 'code'}/>{item.name}</button>)}{listing && !listing.items.length && <p className="muted">此目录没有可选的 HTML 文件或文件夹。</p>}</div>
    {selected && <p className="muted html-selected-path" title={selected}>{selected}</p>}
    <footer><button onClick={close}>取消</button><button className="primary" disabled={!selected || loading} onClick={() => choose(selected)}>选择文件</button></footer>
  </Dialog>;
}
