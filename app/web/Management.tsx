import { useEffect, useState } from 'react';
import { api, ApiError } from './api.js';
import { Icon } from './Icon.js';
import { Dialog } from './Dialog.js';
import type { Mount, Project, Snapshot } from '../shared/model.js';

export function Picker({ initial, choose, close }: { initial: string; choose: (p: string) => void; close: () => void }) {
  const [locations, setLocations] = useState<string[]>([]); const [input, setInput] = useState(initial);
  const [listing, setListing] = useState<{current:string;parent:string;directories:{name:string;path:string}[]}>(); const [error, setError] = useState('');
  async function browse(p: string) { try { const data = await api<NonNullable<typeof listing>>(`/api/fs/directories?absolutePath=${encodeURIComponent(p)}`); setListing(data); setInput(data.current); setError(''); } catch (e) { setError((e as Error).message); } }
  useEffect(() => { void api<{locations:string[]}>('/api/fs/locations').then(d => { setLocations(d.locations); void browse(initial || d.locations[0]); }).catch(e => setError(e.message)); }, []);
  return <Dialog label="选择本机目录" close={close} nested><h2>选择本机目录</h2><p>浏览的是运行服务的电脑；不会上传或复制文件。</p><div className="row">{locations.map(p => <button key={p} onClick={() => void browse(p)}>{p}</button>)}</div><form onSubmit={e => { e.preventDefault(); void browse(input); }}><label>当前位置<input data-autofocus value={input} onChange={e => setInput(e.target.value)} /></label><button>前往</button></form>{error && <p role="alert">{error}</p>}<button onClick={() => listing && void browse(listing.parent)}>↑ 上一级</button><div className="directory-list">{listing?.directories.map(d => <button key={d.path} onClick={() => void browse(d.path)}>▸ {d.name}</button>)}</div><footer><button onClick={close}>取消</button><button disabled={!listing} onClick={() => listing && choose(listing.current)}>选择此目录</button></footer></Dialog>;
}
export function Management({ snapshot, project, close, saved, removed }: { snapshot: Snapshot; project?: Project; close: () => void; saved: () => void; removed: () => void }) {
  const [name, setName] = useState(project?.name || ''); const [editing, setEditing] = useState<Mount>();
  const [absolutePath, setPath] = useState(''); const [label, setLabel] = useState('主目录'); const [mode, setMode] = useState<Mount['mode']>('content');
  const [tools, setTools] = useState(''); const [excludes, setExcludes] = useState(''); const [entry, setEntry] = useState('index.html');
  const [picker, setPicker] = useState(false); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [overlap, setOverlap] = useState<{mountId:string;toolDirectory:string}>();
  const mounts = snapshot.mounts.filter(m => m.projectId === project?.id);
  async function act(fn: () => Promise<unknown>, finish = false, onSuccess?: () => void) { setBusy(true); setError(''); try { await fn(); onSuccess?.(); saved(); if (finish) close(); } catch (e) { setError((e as Error).message); if (e instanceof ApiError && e.code === 'OVERLAPPING_MOUNT') setOverlap(e.details as typeof overlap); } finally { setBusy(false); } }
  function edit(m?: Mount) { setEditing(m); setPath(m?.absolutePath || ''); setLabel(m?.label || '附加目录'); setMode(m?.mode || 'content'); setTools(m?.toolDirectories.join('\n') || ''); setExcludes(m?.excludes.join('\n') || ''); setEntry(m?.entry || 'index.html'); setOverlap(undefined); }
  function save() {
    const shared = snapshot.mounts.some(m => m.projectId !== project?.id && m.absolutePath.toLowerCase() === absolutePath.toLowerCase());
    if (shared && !confirm('其他项目已挂载此目录；它们读取同一批原文件，仍要继续？')) return;
    if (editing && editing.absolutePath !== absolutePath && !confirm(`确认将挂载重新定位到：${absolutePath}？原目录不会被修改。`)) return;
    const mount = { absolutePath, label, mode, toolDirectories: tools.split('\n').map(s=>s.trim()).filter(Boolean), excludes: excludes.split('\n').map(s=>s.trim()).filter(Boolean), entry, enabled: editing?.enabled ?? true };
    void act(() => !project ? api('/api/projects','POST',{name,mount}) : editing ? api(`/api/mounts/${editing.id}`,'PATCH',mount) : api(`/api/projects/${project.id}/mounts`,'POST',mount), true);
  }
  return <Dialog label={project ? '管理项目与挂载' : '添加项目'} close={close} wide><header><h2>{project ? '管理项目与挂载' : '添加项目'}</h2><button className="icon-button" onClick={close} aria-label="关闭" data-tooltip="关闭"><Icon name="close"/></button></header><label>项目名称<input data-autofocus value={name} onChange={e => setName(e.target.value)} /></label>{project && <div className="row"><button className="action-button" disabled={busy} onClick={() => void act(() => api(`/api/projects/${project.id}`,'PATCH',{name}))}><Icon name="save"/>保存名称</button><button className="action-button danger" title="移除项目登记，原文件保留" disabled={busy} onClick={() => { if(confirm(`从工作台移除“${project.name}”及其挂载登记？所有原文件保留。`)) void act(() => api(`/api/projects/${project.id}`,'DELETE'),true,removed); }}><Icon name="trash"/>移除项目</button></div>}
    {mounts.map(m => <div className="mount" key={m.id}><div className="mount-heading"><strong>{m.label}</strong><span className={`mount-status ${!m.enabled?'disabled':m.status==='offline'?'offline':'online'}`}>{!m.enabled?'已停用':m.status==='offline'?'离线':'可用'}</span></div><small className="mount-path">{m.absolutePath}</small><div className="row mount-actions"><button className="action-button" disabled={busy} onClick={() => edit(m)}><Icon name="edit"/>编辑</button><button className={`action-button ${m.enabled?'warning':'positive'}`} disabled={busy} title={m.enabled?'暂停访问此目录，保留挂载登记':'恢复访问此目录'} onClick={() => void act(() => api(`/api/mounts/${m.id}`,'PATCH',{enabled:!m.enabled}))}><Icon name={m.enabled?'pause':'play'}/>{m.enabled ? '停用' : '恢复'}</button><button className="action-button danger mount-remove" disabled={busy} title="卸载目录登记，原文件保留" onClick={() => { if(confirm('卸载登记？原文件不会删除。')) void act(() => api(`/api/mounts/${m.id}`,'DELETE')); }}><Icon name="unmount"/>卸载</button></div></div>)}
    <h3>{editing ? `编辑：${editing.label}` : project ? '追加目录' : '首个目录'}</h3>{editing && <button onClick={() => edit()}>改为添加目录</button>}
    <label>目录别名<input value={label} onChange={e=>setLabel(e.target.value)} /></label><label>真实绝对路径<input placeholder="D:\Research\Project" value={absolutePath} onChange={e=>setPath(e.target.value)} /></label><button onClick={() => setPicker(true)}>选择本机文件夹</button>
    <details><summary>排除路径</summary><label>相对文件或目录路径，每行一个<textarea value={excludes} onChange={e=>setExcludes(e.target.value)} /></label></details>
    <p className="muted">只读发布所选范围。请选择可信的项目/输出目录，敏感资料请分开放置。保存即确认此访问范围。</p>{error && <p role="alert">{error}</p>}{overlap?.toolDirectory && !overlap.toolDirectory.startsWith('..') && <button onClick={() => { const m = snapshot.mounts.find(m=>m.id===overlap.mountId)!; void act(()=>api(`/api/mounts/${m.id}`,'PATCH',{toolDirectories:[...new Set([...m.toolDirectories, overlap.toolDirectory])]}),true); }}>标记为已有挂载的工具目录</button>}
    <footer><button onClick={close}>取消</button><button className="primary" disabled={busy || !absolutePath || !name} onClick={save}>{busy ? '保存中…' : '确认范围并保存'}</button></footer>
    {picker && <Picker initial={absolutePath} close={()=>setPicker(false)} choose={p=>{setPath(p);setPicker(false);}} />}</Dialog>;
}
