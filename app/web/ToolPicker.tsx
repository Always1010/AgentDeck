import { useEffect, useState } from 'react';
import { fileReference, type Snapshot, type TreeItem } from '../shared/model.js';
import { api } from './api.js';
import { Dialog } from './Dialog.js';

export function ToolPicker({ snapshot, close, saved }: { snapshot: Snapshot; close: () => void; saved: () => void }) {
  const mounts = snapshot.mounts.filter(m => m.enabled);
  const [mountId, setMountId] = useState(mounts[0]?.id || '');
  const [directory, setDirectory] = useState('');
  const [items, setItems] = useState<TreeItem[]>([]);
  const [file, setFile] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false; setItems([]); setError('');
    if (!mountId) return;
    setLoading(true);
    void api<TreeItem[]>(`/api/mounts/${mountId}/tree?path=${encodeURIComponent(directory)}`)
      .then(items => { if (!cancelled) setItems(items.filter(i => i.directory || /\.html?$/i.test(i.name))); })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [mountId, directory]);
  async function save() {
    setBusy(true); setError('');
    try { await api('/api/tools', 'PUT', { id: fileReference(mountId, file), ...(name.trim() ? { title: name.trim() } : {}) }); saved(); close(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Dialog label="添加工具" close={close}>
    <header><h2>添加工具</h2><button aria-label="关闭添加工具" onClick={close}>×</button></header>
    <p className="muted">选择一个 HTML 网页，添加到常用工具列表。</p>
    {!mounts.length ? <p>请先在“文件”中添加项目并挂载工具所在目录。</p> : <>
      <label>所在挂载<select data-autofocus value={mountId} onChange={e => { setMountId(e.target.value); setDirectory(''); setFile(''); setName(''); }}>{mounts.map(m => <option key={m.id} value={m.id}>{snapshot.projects.find(p => p.id === m.projectId)?.name} / {m.label}</option>)}</select></label>
      <div className="row"><button disabled={!directory || loading} onClick={() => setDirectory(directory.split('/').slice(0, -1).join('/'))}>↑ 上一级</button><span className="muted">{directory || '根目录'}</span></div>
      <div className="tool-picker-files" aria-label="选择 HTML 文件">{loading ? <p className="muted">正在读取…</p> : items.map(item => <button key={item.relativePath} className={file === item.relativePath ? 'selected' : ''} onClick={() => { if (item.directory) setDirectory(item.relativePath); else { setFile(item.relativePath); setName(item.name.replace(/\.html?$/i, '')); } }}>{item.directory ? '▸' : '◇'} {item.name}</button>)}{!loading && !items.length && <p className="muted">此目录没有子文件夹或 HTML 文件。</p>}</div>
      <label>HTML 相对路径<input placeholder="例如 tools/merge/index.html" value={file} onChange={e => setFile(e.target.value)} /></label>
      <label>工具名称<input placeholder="可选，例如报表合并" maxLength={200} value={name} onChange={e => setName(e.target.value)} /></label>
    </>}
    {error && <p role="alert">{error}</p>}
    <footer><button onClick={close}>取消</button><button className="primary" disabled={busy || !mountId || !/\.html?$/i.test(file)} onClick={() => void save()}>{busy ? '添加中…' : '添加工具'}</button></footer>
  </Dialog>;
}
