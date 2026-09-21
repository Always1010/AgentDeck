import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { fileReference, parseFileReference, type Mount, type Snapshot, type TreeItem } from '../shared/model.js';
import { Management } from './Management.js';
import { Tree, FileIcon } from './Tree.js';
import { Viewer } from './Viewer.js';
import { api } from './api.js';
import { isBoolean, usePreference } from './preferences.js';
import { ShortcutHelp } from './ShortcutHelp.js';
import { isEditing, restoreFocus, shortcutFor } from './shortcuts.js';
import './style.css';
const empty:Snapshot={projects:[],mounts:[],revision:0};
export function App() {
  const standalone=location.pathname==='/preview';
  const [data,setData]=useState<Snapshot>(empty);
  const [selected,setSelected]=useState(new URLSearchParams(location.search).get('entry')||'');
  const [favorites,setFavorites]=usePreference<string[]>('favorites',[],(v):v is string[]=>Array.isArray(v)&&v.every(x=>typeof x==='string'));
  const [aliases,setAliases]=usePreference<Record<string,string>>('file.aliases',{},(v):v is Record<string,string>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.values(v).every(x=>typeof x==='string'));
  const favoritesRef=useRef(favorites);favoritesRef.current=favorites;
  const aliasesRef=useRef(aliases);aliasesRef.current=aliases;
  const [view,setView]=useState<'files'|'favorites'>('files');
  const [query,setQuery]=useState('');
  const [refresh,setRefresh]=useState(0);
  const [manage,setManage]=useState<string>();
  const [error,setError]=useState('');
  const [immersive,setImmersive]=useState(standalone);
  const [collapsed,setCollapsed]=usePreference('explorer.collapsed',false,isBoolean);
  const [width,setWidth]=usePreference('explorer.width',280,(v):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=200&&v<=440);
  const [shortcutsEnabled,setShortcutsEnabled]=usePreference('shortcuts.enabled',true,isBoolean);
  const [help,setHelp]=useState(false);
  const [searchActive,setSearchActive]=useState(false);
  const searchRef=useRef<HTMLInputElement>(null);
  const immersionRef=useRef<HTMLButtonElement>(null);
  const searchRestore=useRef<{query:string;focus:HTMLElement|null}|null>(null);
  const immersionRestore=useRef<HTMLElement|null>(null);
  const drag=useRef<{x:number;width:number}|null>(null);
  const request=useRef(0);
  async function reload(){const token=++request.current;try{const next=await api<Snapshot>('/api/projects');if(token===request.current){setData(next);setError('');}}catch(e){if(token===request.current)setError((e as Error).message);}}
  useEffect(()=>{void reload();const events=new EventSource('/api/events');
    for(const type of ['registry-changed','resync'])events.addEventListener(type,()=>{void reload();setRefresh(v=>v+1);});
    return()=>{events.close();request.current++;};
  },[]);
  function discovered(mount:Mount,items:TreeItem[]){
    const next={...aliasesRef.current};let changed=false;
    for(const item of items)for(const old of item.legacyIds||[]){const id=fileReference(mount.id,item.relativePath);if(next[old]!==id){next[old]=id;changed=true;}}
    if(changed){aliasesRef.current=next;setAliases(next);}
    const updated=[...new Set(favoritesRef.current.map(id=>next[id]||id))];
    if(updated.some((id,i)=>id!==favoritesRef.current[i])||updated.length!==favoritesRef.current.length){favoritesRef.current=updated;setFavorites(updated);}
    if(next[selected])setSelected(next[selected]);
  }
  function favorite(id:string){const next=favoritesRef.current.includes(id)?favoritesRef.current.filter(x=>x!==id):[...favoritesRef.current,id];favoritesRef.current=next;setFavorites(next);}
  function finishSearch(cancel=true){if(cancel&&searchRestore.current)setQuery(searchRestore.current.query);setSearchActive(false);restoreFocus(cancel?searchRestore.current?.focus||null:immersionRef.current,immersionRef.current);searchRestore.current=null;}
  function open(id:string){setSelected(aliasesRef.current[id]||id);if(searchActive)finishSearch(false);if(matchMedia('(max-width: 640px)').matches)setCollapsed(true);}
  function toggleImmersion(){if(!selected&&!immersive)return;if(searchActive)finishSearch();if(!immersive)immersionRestore.current=document.activeElement as HTMLElement|null;setImmersive(!immersive);restoreFocus(immersive?immersionRestore.current:immersionRef.current,immersionRef.current);}
  useEffect(()=>{const url=new URL(location.href);if(selected)url.searchParams.set('entry',selected);else url.searchParams.delete('entry');history.replaceState(null,'',url);},[selected]);
  useEffect(()=>{function keydown(e:KeyboardEvent){
    if(document.querySelector('[data-workbench-dialog]'))return;
    const action=shortcutFor(e,isEditing(e.target),shortcutsEnabled);
    if(action==='escape'){
      if(document.getElementById('viewer-settings'))return;
      if(searchActive){e.preventDefault();finishSearch();}else if(immersive){e.preventDefault();toggleImmersion();}return;
    }
    if(action==='immersive'&&selected){e.preventDefault();toggleImmersion();}
    if(action==='help'){e.preventDefault();setHelp(true);}
    if(action==='search'){e.preventDefault();if(!searchActive)searchRestore.current={query,focus:document.activeElement as HTMLElement|null};setSearchActive(true);requestAnimationFrame(()=>searchRef.current?.focus());}
  }document.addEventListener('keydown',keydown);return()=>document.removeEventListener('keydown',keydown);},[selected,immersive,query,searchActive,shortcutsEnabled]);
  function resize(value:number){setWidth(Math.max(200,Math.min(440,value)));}
  const hidden=!searchActive&&(immersive||collapsed);
  const refs=favorites.map(id=>({id,ref:parseFileReference(id)})).filter(({id,ref})=>`${ref?.relativePath||id} ${data.mounts.find(m=>m.id===ref?.mountId)?.label||''}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className={`shell ${hidden?'sidebar-hidden':''} ${immersive?'immersive':''}`} style={{'--sidebar-width':`${width}px`} as CSSProperties}>
    <header className="workspace-header"><button className="sidebar-toggle" aria-label={hidden?'展开文件侧栏':'收起文件侧栏'} aria-expanded={!hidden} onClick={()=>{if(immersive)setImmersive(false);setCollapsed(!hidden);}}>☰</button><strong className="brand">AgentDeck</strong><span className="workspace-context">本地文件工作台</span><div className="workspace-actions">
      {searchActive&&<button onClick={()=>finishSearch()}>结束筛选</button>}
      <button ref={immersionRef} className="immersion-toggle" disabled={!selected&&!immersive} aria-label={immersive?'退出沉浸':'沉浸'} aria-pressed={immersive} onClick={toggleImmersion}>{immersive?'退出沉浸':'沉浸'}</button>
      <button aria-label="快捷键" title="快捷键" onClick={()=>setHelp(true)}>?</button>
    </div></header>
    <aside className="explorer" aria-label="文件资源浏览器" aria-hidden={hidden}>
      <div className="explorer-header"><nav aria-label="浏览视图"><button className={view==='files'?'active':''} onClick={()=>setView('files')}>文件</button><button className={view==='favorites'?'active':''} onClick={()=>setView('favorites')}>收藏</button></nav><div className="explorer-actions"><button aria-label="添加项目" title="添加项目 / 挂载目录" onClick={()=>setManage('new')}>＋</button><button aria-label="刷新目录" title="刷新已展开目录" onClick={()=>{void reload();setRefresh(v=>v+1);}}>↻</button></div></div>
      <div className="explorer-search"><input ref={searchRef} aria-label="筛选文件" type="search" placeholder={view==='favorites'?'筛选收藏':'筛选已加载文件…'} value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.nativeEvent.isComposing)return;if(e.key==='ArrowDown'||e.key==='Enter'){const first=Array.from(document.querySelectorAll<HTMLButtonElement>('.explorer-scroll .node-main:not(.folder)')).find(el=>el.getClientRects().length);if(first){e.preventDefault();if(e.key==='Enter')first.click();else first.focus();}}}}/></div>
      <div className="explorer-scroll" role="tree" aria-label={view==='files'?'目录与文件':'收藏文件'} onKeyDown={e=>{
        if(e.nativeEvent.isComposing||e.ctrlKey||e.altKey||e.metaKey||!['ArrowUp','ArrowDown'].includes(e.key))return;
        const rows=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('.node-main')).filter(el=>el.getClientRects().length&&!el.disabled);
        const index=rows.indexOf(document.activeElement as HTMLButtonElement);if(index<0)return;e.preventDefault();rows[Math.max(0,Math.min(rows.length-1,index+(e.key==='ArrowDown'?1:-1)))]?.focus();
      }}>
        <div hidden={view!=='files'}>{data.projects.map(project=>{
          const mounts=data.mounts.filter(m=>m.projectId===project.id);
          return <div className="project-group" key={project.id}>
            {mounts.length!==1&&<div className="project-heading"><span>{project.name}</span><button aria-label={`管理项目：${project.name}`} onClick={()=>setManage(project.id)}>⋯</button></div>}
            {mounts.map(m=><Tree key={m.id} mount={m} label={mounts.length===1?project.name:m.label} query={query} selected={selected} favorites={favorites} refresh={refresh} open={open} favorite={favorite} discovered={discovered} manage={mounts.length===1?()=>setManage(project.id):undefined}/>)}
            {!mounts.length&&<p className="tree-message">尚未挂载目录</p>}
          </div>;
        })}{!data.projects.length&&<div className="catalog-empty"><p>挂载目录后，展开文件夹开始浏览。</p><button onClick={()=>setManage('new')}>添加项目</button></div>}</div>
        {view==='favorites'&&<>{refs.map(({id,ref})=>{
          const mount=data.mounts.find(m=>m.id===ref?.mountId);const name=ref?.relativePath.split('/').pop()||'旧收藏（展开原目录后恢复）';
          return <div className={`file-row ${id===selected?'selected':''}`} key={id}><button className="node-main" role="treeitem" aria-selected={id===selected} title={ref?`${mount?.label||'挂载不可用'} / ${ref.relativePath}`:id} onClick={()=>open(id)}><FileIcon name={name}/><span className="filename">{name}</span>{ref&&(!mount||!mount.enabled)&&<span className="node-status">不可用</span>}</button><button className="row-action starred" aria-label={`取消收藏：${name}`} onClick={()=>favorite(id)}>★</button></div>;
        })}{!refs.length&&<p className="tree-message">{query?'没有匹配的收藏':'点击文件旁的星标，收藏常用文件。'}</p>}</>}
      </div><div className="explorer-footer">{query?'仅筛选已加载的目录和文件':'按需展开 · 原文件只读'}</div>
    </aside>
    <div className="catalog-resizer" role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" aria-valuemin={200} aria-valuemax={440} aria-valuenow={width} tabIndex={hidden?-1:0} onPointerDown={e=>{if(e.button!==0)return;drag.current={x:e.clientX,width};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(drag.current)resize(drag.current.width+e.clientX-drag.current.x);}} onPointerUp={e=>{drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}} onLostPointerCapture={()=>{drag.current=null;}} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();resize(e.key==='Home'?200:e.key==='End'?440:width+(e.key==='ArrowLeft'?-10:10));}}}/>
    {selected?<Viewer key={selected} id={selected} favorite={favorites.includes(selected)} toggleFavorite={()=>favorite(selected)} back={()=>{if(standalone)location.href='/';else{setSelected('');setImmersive(false);}}} navigate={(mountId,path)=>open(fileReference(mountId,path))}/>:<section className="viewer"><div className="empty"><span className="eyebrow">AGENTDECK</span><h2>打开文件，专注阅读。</h2><p>从左侧展开目录，选择 HTML、Markdown、CSV 或代码文件。</p>{!data.projects.length&&<button className="primary" onClick={()=>setManage('new')}>挂载第一个目录</button>}</div></section>}
    {error&&<div className="toast" role="alert">{error}<button onClick={()=>setError('')}>关闭</button></div>}
    {manage&&<Management snapshot={data} project={data.projects.find(p=>p.id===manage)} close={()=>setManage(undefined)} saved={()=>{void reload();setRefresh(v=>v+1);}} removed={()=>{void reload();}}/>}
    {help&&<ShortcutHelp close={()=>setHelp(false)} enabled={shortcutsEnabled} setEnabled={setShortcutsEnabled}/>}
  </div>;
}
