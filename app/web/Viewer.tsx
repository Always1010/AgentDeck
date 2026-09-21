import { useEffect, useRef, useState } from 'react';
import type { Entry, ChangeEvent } from '../shared/model.js';
import { api } from './api.js';
import { Markdown } from './Markdown.js';
export type Signal={type:string;data:Partial<ChangeEvent>;sequence:number};
export function Viewer({id,signal,favorite,toggleFavorite,back,immersive,setImmersive,navigate}:{id:string;signal?:Signal;favorite:boolean;toggleFavorite:()=>void;back:()=>void;immersive:boolean;setImmersive:(v:boolean)=>void;navigate:(mountId:string,path:string)=>void}){
  const [entry,setEntry]=useState<Entry>();const [text,setText]=useState('');const [source,setSource]=useState(false);const [version,setVersion]=useState(0);const [pending,setPending]=useState('');const [error,setError]=useState('');const [loading,setLoading]=useState(false);const [settings,setSettings]=useState(false);
  const live=useRef<Entry|undefined>(undefined);const request=useRef(0);const scroll=useRef<HTMLDivElement>(null);
  async function read(e:Entry){const f=await api<{text:string}>(`/api/mounts/${e.mountId}/file?path=${encodeURIComponent(e.relativePath)}`);return f.text;}
  async function load(){const token=++request.current;let candidate:Entry|undefined;setError('');setLoading(true);try{
    const e=await api<Entry>(`/api/entries/${id}`);candidate=e;let content='';
    if(e.status==='ready'){
      if(/^html?$/.test(e.format)){const r=await fetch(e.previewUrl!,{method:'HEAD'});if(!r.ok)throw new Error(`页面 HTTP ${r.status}，可检查源码或重新扫描。`);if(source)content=await read(e);}
      else content=await read(e);
    }
    if(token!==request.current)return;live.current=e;setEntry(e);setText(content);setPending('');setVersion(v=>v+1);
  }catch(e){if(token===request.current){setError((e as Error).message);if(candidate&&!live.current){live.current=candidate;setEntry(candidate);}}}finally{if(token===request.current)setLoading(false);}}
  useEffect(()=>{live.current=undefined;setEntry(undefined);setSource(false);setText('');setPending('');void load();return()=>{request.current++;};},[id]);
  useEffect(()=>{if(!signal||!live.current)return;const current=live.current;
    const relevant=signal.type==='entries-changed'&&signal.data.entryIds?.includes(current.id);
    if(signal.type==='registry-changed'){void api<Entry>(`/api/entries/${id}`).then(e=>{live.current={...current,title:e.title,kind:e.kind,refreshMode:e.refreshMode};setEntry(live.current);}).catch(e=>setPending(e.message));return;}
    if(relevant||signal.type==='resync'){
      // Reconnection deliberately prompts even reports; a live tool is never replaced by list state.
      if(current.kind==='tool'||current.refreshMode==='prompt'||signal.type==='resync')setPending(signal.type==='resync'?'连接已恢复，列表已对账；可手动刷新当前内容。':'有新版本，点击刷新后加载。当前输入保持不变。');
      else void load();
    }
  },[signal]);
  async function toggleSource(){if(!entry)return;if(!source){try{setText(await read(entry));setSource(true);}catch(e){setError((e as Error).message);}}else setSource(false);}
  async function preference(patch:Partial<Entry>){const previous=live.current;if(!previous)return;live.current={...previous,...patch};setEntry(live.current);try{await api(`/api/entries/${id}/preferences`,'PATCH',patch);const e=await api<Entry>(`/api/entries/${id}`);live.current={...previous,title:e.title,kind:e.kind,refreshMode:e.refreshMode};setEntry(live.current);}catch(e){live.current=previous;setEntry(previous);setError((e as Error).message);}}
  const download=entry?`/api/mounts/${entry.mountId}/download?path=${encodeURIComponent(entry.relativePath)}`:'';
  return <section className="viewer"><header className="toolbar"><button onClick={back}>← 返回</button><div className="identity"><strong>{entry?.title||'读取入口'}</strong><small>{entry?.relativePath||entry?.toolRoot}</small></div><button onClick={()=>void load()} disabled={loading}>刷新</button><button onClick={toggleFavorite}>{favorite?'★ 已收藏':'☆ 收藏'}</button><button onClick={()=>void toggleSource()}>{source?'阅读':'源码'}</button><button onClick={()=>setImmersive(!immersive)}>{immersive?'退出沉浸':'沉浸'}</button><a href={`/preview?entry=${id}`} target="_blank" rel="noopener noreferrer">新标签</a><button aria-label="更多设置" onClick={()=>setSettings(!settings)}>•••</button></header>
    {settings&&entry&&<div className="viewer-settings"><label className="inline"><input type="checkbox" checked={entry.refreshMode==='auto'} disabled={entry.kind==='tool'} onChange={e=>void preference({refreshMode:e.target.checked?'auto':'prompt'})}/>{entry.kind==='tool'?'工具仅提示更新，避免丢失输入':'自动更新（重载可能重置页面交互）'}</label><button onClick={()=>{const title=prompt('显示名称',entry.title);if(title)void preference({title});}}>显示名称</button><select aria-label="入口分类" value={entry.kind} onChange={e=>void preference({kind:e.target.value as Entry['kind']})}><option value="html">HTML 报告</option><option value="tool">工具</option><option value="markdown">Markdown</option><option value="text">文本</option><option value="data">其他</option></select><a href={entry.previewUrl} target="_blank" rel="noopener noreferrer">打开原始页面（手动刷新）</a><a href={download} download>下载原文件</a><button onClick={()=>void navigator.clipboard.writeText(text||'').then(()=>setPending('已复制当前原文；HTML 请先切换源码。')).catch(e=>setError(e.message))}>复制原文</button>{entry.kind==='tool'&&<button onClick={()=>{const chosen=prompt('相对工具根的 HTML 入口','index.html');if(chosen)void api(`/api/mounts/${entry.mountId}/tool-override`,'PUT',{toolRoot:entry.toolRoot||'',entry:chosen}).then(()=>setPending('入口设置已保存，请点击刷新。')).catch(e=>setError(e.message));}}>更换工具入口</button>}</div>}
    {pending&&<div className="notice" role="status">{pending} <button onClick={()=>void load()}>加载更新</button><button onClick={()=>setPending('')}>稍后</button></div>}{error&&<div role="alert">{error} {entry&&<a href={download} download>下载原文件</a>}</div>}
    {!entry?<div className="empty">{loading?'检查入口与响应…':'入口不存在、文件已删除或挂载不可用。'}</div>:entry.status!=='ready'?<div className="empty"><h2>{entry.status==='pending-build'?'工具待构建 / 请选择入口':'多个候选入口待选择'}</h2><p>工作台不会执行构建命令。候选：{entry.candidates?.join('、')||'暂无'}</p><button onClick={()=>{const root=entry.toolRoot||'';const first=entry.candidates?.[0];const chosen=prompt('相对工具根的 HTML 入口',first?(root?first.slice(root.length+1):first):'index.html');if(chosen)void api(`/api/mounts/${entry.mountId}/tool-override`,'PUT',{toolRoot:root,entry:chosen}).then(load).catch(e=>setError(e.message));}}>选择 HTML 入口</button></div>:<>
      {/^html?$/.test(entry.format)&&<iframe style={{display:source?'none':undefined}} key={`${id}:${version}`} title={entry.title} src={entry.previewUrl} sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"/>}
      {(source||!/^html?$/.test(entry.format))&&<div className="reader" ref={scroll}>{!source&&/^(md|markdown)$/.test(entry.format)?<Markdown text={text} entry={entry} previewOrigin={new URL(entry.previewUrl!).origin} navigate={p=>navigate(entry.mountId,p)}/>:<pre>{text}</pre>}</div>}
    </>}
  </section>;
}

