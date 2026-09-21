import { useEffect, useState } from 'react';
import { api, ApiError } from './api.js';
import { Dialog } from './Dialog.js';
import type { Mount, Project, Snapshot } from '../shared/model.js';

export function Picker({ initial, choose, close }: { initial: string; choose: (p: string) => void; close: () => void }) {
  const [locations, setLocations] = useState<string[]>([]); const [input, setInput] = useState(initial);
  const [listing, setListing] = useState<{current:string;parent:string;directories:{name:string;path:string}[]}>(); const [error, setError] = useState('');
  async function browse(p: string) { try { const data = await api<NonNullable<typeof listing>>(`/api/fs/directories?absolutePath=${encodeURIComponent(p)}`); setListing(data); setInput(data.current); setError(''); } catch (e) { setError((e as Error).message); } }
  useEffect(() => { void api<{locations:string[]}>('/api/fs/locations').then(d => { setLocations(d.locations); void browse(initial || d.locations[0]); }).catch(e => setError(e.message)); }, []);
  return <Dialog label="选择本机目录" close={close} nested><h2>选择本机目录</h2><p>浏览的是运行服务的电脑；不会上传或复制文件。</p><div className="row">{locations.map(p => <button key={p} onClick={() => void browse(p)}>{p}</button>)}</div><form onSubmit={e => { e.preventDefault(); void browse(input); }}><label>当前位置<input data-autofocus value={input} onChange={e => setInput(e.target.value)} /></label><button>前往</button></form>{error && <p role="alert">{error}</p>}<button onClick={() => listing && void browse(listing.parent)}>↑ 上一级</button><div className="directory-list">{listing?.directories.map(d => <button key={d.path} onClick={() => void browse(d.path)}>▸ {d.name}</button>)}</div><footer><button onClick={close}>取消</button><button disabled={!listing} onClick={() => listing && choose(listing.current)}>选择此目录</button></footer></Dialog>;
}
export function Management({ snapshot, project, close, saved }: { snapshot: Snapshot; project?: Project; close: () => void; saved: () => void }) {
  const [name, setName] = useState(project?.name || ''); const [editing, setEditing] = useState<Mount>();
  const [absolutePath, setPath] = useState(''); const [label, setLabel] = useState('主目录'); const [mode, setMode] = useState<Mount['mode']>('content');
  const [tools, setTools] = useState(''); const [excludes, setExcludes] = useState(''); const [entry, setEntry] = useState('index.html');
  const [picker, setPicker] = useState(false); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [overlap, setOverlap] = useState<{mountId:string;toolDirectory:string}>();
  const mounts = snapshot.mounts.filter(m => m.projectId === project?.id);
  async function act(fn: () => Promise<unknown>, finish = false) { setBusy(true); setError(''); try { await fn(); saved(); if (finish) close(); } catch (e) { setError((e as Error).message); if (e instanceof ApiError && e.code === 'OVERLAPPING_MOUNT') setOverlap(e.details as typeof overlap); } finally { setBusy(false); } }
  function edit(m?: Mount) { setEditing(m); setPath(m?.absolutePath || ''); setLabel(m?.label || '附加目录'); setMode(m?.mode || 'content'); setTools(m?.toolDirectories.join('\n') || ''); setExcludes(m?.excludes.join('\n') || ''); setEntry(m?.entry || 'index.html'); setOverlap(undefined); }
  function save() {
    const shared = snapshot.mounts.some(m => m.projectId !== project?.id && m.absolutePath.toLowerCase() === absolutePath.toLowerCase());
    if (shared && !confirm('其他项目已挂载此目录；它们读取同一批原文件，仍要继续？')) return;
    if (editing && editing.absolutePath !== absolutePath && !confirm(`确认将挂载重新定位到：${absolutePath}？原目录不会被修改。`)) return;
    const mount = { absolutePath, label, mode, toolDirectories: tools.split('\n').map(s=>s.trim()).filter(Boolean), excludes: excludes.split('\n').map(s=>s.trim()).filter(Boolean), entry, enabled: editing?.enabled ?? true };
    void act(() => !project ? api('/api/projects','POST',{name,mount}) : editing ? api(`/api/mounts/${editing.id}`,'PATCH',mount) : api(`/api/projects/${project.id}/mounts`,'POST',mount), true);
  }
  return <Dialog label={project ? '管理项目与挂载' : '添加项目'} close={close} wide><header><h2>{project ? '管理项目与挂载' : '添加项目'}</h2><button onClick={close} aria-label="关闭">×</button></header><label>项目名称<input data-autofocus value={name} onChange={e => setName(e.target.value)} /></label>{project && <div className="row"><button disabled={busy} onClick={() => void act(() => api(`/api/projects/${project.id}`,'PATCH',{name}))}>保存名称</button><button onClick={() => { if(confirm('移除项目及其挂载登记？所有原文件保留。')) void act(() => api(`/api/projects/${project.id}`,'DELETE'),true); }}>移除项目</button></div>}
    {mounts.map(m => <div className="mount" key={m.id}><strong>{m.label}</strong><small>{m.status || (m.enabled ? '已登记' : 'disabled')} · {m.absolutePath}</small><div className="row"><button onClick={() => edit(m)}>编辑</button><button onClick={() => void act(() => api(`/api/mounts/${m.id}`,'PATCH',{enabled:!m.enabled}))}>{m.enabled ? '停用' : '恢复'}</button><button onClick={() => { if(confirm('卸载登记？原文件不会删除。')) void act(() => api(`/api/mounts/${m.id}`,'DELETE')); }}>卸载</button></div></div>)}
    <h3>{editing ? `编辑：${editing.label}` : project ? '追加目录' : '首个目录'}</h3>{editing && <button onClick={() => edit()}>改为添加目录</button>}
    <label>目录别名<input value={label} onChange={e=>setLabel(e.target.value)} /></label><label>真实绝对路径<input placeholder="D:\Research\Project" value={absolutePath} onChange={e=>setPath(e.target.value)} /></label><button onClick={() => setPicker(true)}>选择本机文件夹</button>
    <label>用途<select value={mode} onChange={e=>setMode(e.target.value as Mount['mode'])}><option value="content">项目内容</option><option value="tool-library">工具集合</option><option value="single-tool">单个工具 / dist</option></select></label>
    {mode === 'content' && <label>工具子目录（相对路径，每行一个；例如 tools、工具）<textarea value={tools} onChange={e=>setTools(e.target.value)} /></label>}{mode === 'single-tool' && <label>HTML 入口<input value={entry} onChange={e=>setEntry(e.target.value)} /></label>}
    <details><summary>排除路径</summary><label>相对文件或目录路径，每行一个<textarea value={excludes} onChange={e=>setExcludes(e.target.value)} /></label></details>
    <p className="muted">只读发布所选范围。请选择可信的项目/输出目录，敏感资料请分开放置。保存即确认此访问范围。</p>{error && <p role="alert">{error}</p>}{overlap?.toolDirectory && !overlap.toolDirectory.startsWith('..') && <button onClick={() => { const m = snapshot.mounts.find(m=>m.id===overlap.mountId)!; void act(()=>api(`/api/mounts/${m.id}`,'PATCH',{toolDirectories:[...new Set([...m.toolDirectories, overlap.toolDirectory])]}),true); }}>标记为已有挂载的工具目录</button>}
    <footer><button onClick={close}>取消</button><button className="primary" disabled={busy || !absolutePath || !name} onClick={save}>{busy ? '保存中…' : '确认范围并保存'}</button></footer>
    {picker && <Picker initial={absolutePath} close={()=>setPicker(false)} choose={p=>{setPath(p);setPicker(false);}} />}</Dialog>;
}
