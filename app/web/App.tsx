import { useEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from 'react';
import { fileReference, parseFileReference, previewPath, type Mount, type Snapshot, type TreeItem, type ToolItem } from '../shared/model.js';
import { Management } from './Management.js';
import { Tree, FileIcon } from './Tree.js';
import { ToolPicker } from './ToolPicker.js';
import { Icon } from './Icon.js';
import { Viewer } from './Viewer.js';
import { api } from './api.js';
import { isBoolean, usePreference } from './preferences.js';
import { ShortcutHelp } from './ShortcutHelp.js';
import { Help } from './Help.js';
import { type PageAction } from './pages.js';
import { OpenPages, PageTabs, pageTabId } from './PageTabs.js';
import { initialWorkspace, workspaceReducer, layoutRects, minimumPane, dividerSize, type SplitDirection, type PaneId } from './workspace.js';
import { ReadingLayout } from './ReadingLayout.js';
import { ThemePicker } from './Theme.js';
import { isEditing, restoreFocus, shortcutFor } from './shortcuts.js';
import { Dialog } from './Dialog.js';
import { Settings, isHtmlOpening, type HtmlOpening } from './Settings.js';
import { isHtmlKeyMode, type HtmlKeyMode } from './useHtmlBridge.js';
import type { BridgeAction } from '../shared/bridge.js';
import { FileOpenMenu } from './FileOpenMenu.js';
import { FileTypeFilterControl } from './FileTypeFilter.js';
import { defaultFileTypeFilter, isFileTypeFilter, type FileTypeFilter } from './fileExtensions.js';
import { openReadingSession, type ReadingSession, type ReadingSnapshot } from './readingSessions.js';
import { useReadingPersistence } from './useReadingPersistence.js';
import './style.css';
import './theme.css';
const empty:Snapshot={projects:[],mounts:[],revision:0};
let documentSession: Promise<ReadingSession> | undefined;
function oldPreference<T>(key:string,fallback:T,valid:(value:unknown)=>value is T):T {
  try{const value:unknown=JSON.parse(localStorage.getItem(key)||'null');return valid(value)?value:fallback;}catch{return fallback;}
}
export function App() {
  const [boot,setBoot]=useState<{session:ReadingSession|null;error:string}>();
  useEffect(()=>{
    let live=true;
    const params=new URLSearchParams(location.search);
    // A file link opens its own scene. A ws link restores the entire saved scene.
    documentSession ||= openReadingSession(params.get('ws') || (params.has('entry')?crypto.randomUUID():undefined));
    void documentSession.then(session=>{
      if(!live)return;
      const url=new URL(location.href);url.searchParams.set('ws',session.id);history.replaceState(null,'',url);
      setBoot({session,error:''});
    }).catch(error=>{if(live)setBoot({session:null,error:`当前阅读现场无法保存：${(error as Error).message}`});});
    return()=>{live=false;};
  },[]);
  return boot?<Workbench session={boot.session} startupError={boot.error}/>:<div className="startup-state" role="status">正在恢复阅读现场…</div>;
}
function Workbench({session,startupError}:{session:ReadingSession|null;startupError:string}) {
  const standalone=location.pathname==='/preview';
  const [data,setData]=useState<Snapshot>(empty);
  const [workspace,dispatchWorkspace]=useReducer(workspaceReducer,undefined,()=>{
    if(session?.snapshot)return session.snapshot.workspace;
    let state=initialWorkspace(new URLSearchParams(location.search).get('entry')||'');
    const legacy=oldPreference('reading.layout','single',(v):v is 'single'|'columns'|'rows'=>v==='single'||v==='columns'||v==='rows');
    if(legacy!=='single'){
      state=workspaceReducer(state,{type:'split',pane:0,direction:legacy,file:''});
      const ratio=oldPreference(`reading.${legacy}-ratio`,50,(v):v is number=>typeof v==='number'&&v>=20&&v<=80);
      state=workspaceReducer(state,{type:'resize',id:'split-1',ratio});state=workspaceReducer(state,{type:'activate',pane:0});
    }
    return state;
  });
  const pages=workspace.panes[workspace.active];
  const dispatchPages=(action:PageAction,pane:PaneId=workspace.active)=>dispatchWorkspace(action.type==='aliases'?action:{type:'page',pane,action});
  const [closeEmpty,setCloseEmpty]=usePreference<'keep'|'remove'>('reading.close-empty','keep',(value):value is 'keep'|'remove'=>value==='keep'||value==='remove');
  const [confirmPaneClose,setConfirmPaneClose]=usePreference('reading.confirm-pane-close',true,isBoolean);
  const [closingPane,setClosingPane]=useState<PaneId|null>(null);
  function activatePane(pane:PaneId){markActivity();dispatchWorkspace({type:'activate',pane});}
  function splitPane(direction:SplitDirection,pane:PaneId=workspace.active,file?:string){
    const area=document.querySelector('.workspace-pages')?.getBoundingClientRect();
    if(!area)return;
    const box=layoutRects(workspace.root,{x:0,y:0,width:area.width,height:area.height}).panes[pane];
    if(!box)return;
    if((direction==='columns'?box.width<minimumPane.width*2+dividerSize:box.height<minimumPane.height*2+dividerSize)){
      setError('当前区域空间不足，请先拖动分隔线扩大区域。');return;
    }
    const nextId=workspace.nextPane;
    dispatchWorkspace({type:'split',pane,direction,file:file?aliasesRef.current[file]||file:undefined});
    requestAnimationFrame(()=>document.querySelector<HTMLElement>(`.reading-pane[data-pane="${nextId}"]`)?.focus({preventScroll:true}));
  }
  function openOther(id:string){splitPane('columns',workspace.active,id);}
  useEffect(()=>{function focusFrame(){queueMicrotask(()=>{const pane=document.activeElement?.closest<HTMLElement>('[data-pane]');if(pane)activatePane(Number(pane.dataset.pane) as PaneId);});}window.addEventListener('blur',focusFrame);return()=>window.removeEventListener('blur',focusFrame);},[]);
  const selected=pages.active;
  const [openedExpanded,setOpenedExpanded]=useState(()=>session?.snapshot?.view.openedExpanded??oldPreference('pages.expanded',true,isBoolean));
  const [favorites,setFavorites]=usePreference<string[]>('favorites',[],(v):v is string[]=>Array.isArray(v)&&v.every(x=>typeof x==='string'));
  const [fileTypeFilter,setFileTypeFilter]=usePreference<FileTypeFilter>('explorer.file-types',defaultFileTypeFilter,isFileTypeFilter);
  const [aliases,setAliases]=usePreference<Record<string,string>>('file.aliases',{},(v):v is Record<string,string>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.values(v).every(x=>typeof x==='string'));
  const favoritesRef=useRef(favorites);favoritesRef.current=favorites;
  const aliasesRef=useRef(aliases);aliasesRef.current=aliases;
  const [view,setView]=useState<'files'|'favorites'|'tools'>(session?.snapshot?.view.view||'files');
  const [tools,setTools]=useState<ToolItem[]>([]);
  const [toolPicker,setToolPicker]=useState(false);
  const [query,setQuery]=useState(session?.snapshot?.view.query||'');
  const [refresh,setRefresh]=useState(0);
  const [manage,setManage]=useState<string>();
  const [error,setError]=useState('');
  const [immersive,setImmersive]=useState(session?.snapshot?.view.immersive??standalone);
  const [collapsed,setCollapsed]=useState(()=>session?.snapshot?.view.collapsed??oldPreference('explorer.collapsed',false,isBoolean));
  const [width,setWidth]=useState(()=>session?.snapshot?.view.width??oldPreference('explorer.width',280,(v):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=200&&v<=440));
  const [shortcutsEnabled,setShortcutsEnabled]=usePreference('shortcuts.enabled',true,isBoolean);
  const [htmlKeys,setHtmlKeys]=usePreference<HtmlKeyMode>('html.shortcuts','web',isHtmlKeyMode);
  const [navigationEnabled,setNavigationEnabled]=usePreference('shortcuts.navigation',true,isBoolean);
  const [documentFontSize,setDocumentFontSize]=usePreference('reading.font-size',14,(value):value is number=>typeof value==='number'&&Number.isInteger(value)&&value>=12&&value<=24);
  const positions=useRef(new Map<string,{x:number;y:number}>(Object.entries(session?.snapshot?.positions||{})));
  const [positionVersion,updatePositions]=useReducer((v:number)=>v+1,0);
  const positionTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const [expanded,setExpanded]=useState<Record<string,string[]>>(session?.snapshot?.expanded||{});
  function positionChanged(key:string,position:{x:number;y:number}){
    positions.current.set(key,{x:Math.max(0,position.x),y:Math.max(0,position.y)});
    if(!positionTimer.current)positionTimer.current=setTimeout(()=>{positionTimer.current=undefined;updatePositions();},200);
  }
  useEffect(()=>()=>clearTimeout(positionTimer.current),[]);
  const savedScene=useMemo<ReadingSnapshot>(()=>({version:1,workspace,view:{immersive,collapsed,width,openedExpanded,view,query},positions:Object.fromEntries(positions.current),expanded}),[workspace,immersive,collapsed,width,openedExpanded,view,query,positionVersion,expanded]);
  const {saveError,retrySave,markActivity}=useReadingPersistence(session,savedScene);
  const [htmlOpening,setHtmlOpening]=usePreference<HtmlOpening>('html.opening','workbench',isHtmlOpening);
  const [previewOrigin,setPreviewOrigin]=useState('');
  const [settingsPage,setSettingsPage]=useState(location.hash==='#settings');
  useEffect(()=>{if(location.hash==='#settings')history.replaceState(null,'',location.pathname+location.search);},[]);
  function closeSettings(){setSettingsPage(false);}
  useEffect(()=>{void api<{previewOrigin:string}>('/api/status').then(status=>setPreviewOrigin(status.previewOrigin)).catch(()=>setError('无法获取 HTML 预览地址，请刷新工作台。'));},[]);
  const [help,setHelp]=useState(false);
  const [guide,setGuide]=useState(false);
  const [searchActive,setSearchActive]=useState(false);
  const searchRef=useRef<HTMLInputElement>(null);
  const immersionRef=useRef<HTMLButtonElement>(null);
  const immersionExitRef=useRef<HTMLButtonElement>(null);
  const sidebarRef=useRef<HTMLButtonElement>(null);
  const searchRestore=useRef<{query:string;focus:HTMLElement|null}|null>(null);
  const immersionRestore=useRef<HTMLElement|null>(null);
  const drag=useRef<{x:number;width:number}|null>(null);
  const request=useRef(0);
  async function reload(){const token=++request.current;try{const [next,toolList]=await Promise.all([api<Snapshot>('/api/projects'),api<ToolItem[]>('/api/tools')]);if(token===request.current){setData(next);setTools(toolList);setError('');}}catch(e){if(token===request.current)setError((e as Error).message);}}
  useEffect(()=>{void reload();const events=new EventSource('/api/events');
    for(const type of ['registry-changed','resync'])events.addEventListener(type,()=>{void reload();setRefresh(v=>v+1);});
    return()=>{events.close();request.current++;};
  },[]);
  useEffect(()=>{let cancelled=false;
    void api<Record<string,string>>('/api/legacy-files').then(mapping=>{
      if(cancelled)return;
      const valid=Object.fromEntries(Object.entries(mapping).filter(([id,ref])=>/^[a-f0-9]{32}$/i.test(id)&&typeof ref==='string'&&parseFileReference(ref)));
      const next={...aliasesRef.current,...valid};aliasesRef.current=next;setAliases(next);
      const migrated=[...new Set(favoritesRef.current.map(id=>next[id]||id))];favoritesRef.current=migrated;setFavorites(migrated);
      dispatchPages({type:'aliases',aliases:next});
    }).catch(()=>{/* Existing local aliases and lazy directory migration remain available. */});
    return()=>{cancelled=true;};
  },[]);
  const [favoriteErrors,setFavoriteErrors]=useState<Record<string,string>>({});
  useEffect(()=>{if(view==='files')return;let cancelled=false;let checking=false;
    async function check(){if(checking||document.visibilityState!=='visible')return;checking=true;const next:Record<string,string>={};
      const ids=(view==='tools'?tools.map(t=>t.id):favorites).filter(id=>parseFileReference(id));
      for(let i=0;i<ids.length&&!cancelled;i+=6)await Promise.all(ids.slice(i,i+6).map(async id=>{try{await api(`/api/entries/${encodeURIComponent(id)}`);}catch(e){next[id]=(e as Error).message;}}));
      if(!cancelled)setFavoriteErrors(next);checking=false;
    }
    void check();const timer=setInterval(()=>void check(),4000);return()=>{cancelled=true;clearInterval(timer);};
  },[view,favorites,tools,data.revision,refresh]);
  function discovered(mount:Mount,items:TreeItem[]){
    const next={...aliasesRef.current};let changed=false;
    for(const item of items)for(const old of item.legacyIds||[]){const id=fileReference(mount.id,item.relativePath);if(next[old]!==id){next[old]=id;changed=true;}}
    if(changed){aliasesRef.current=next;setAliases(next);}
    const updated=[...new Set(favoritesRef.current.map(id=>next[id]||id))];
    if(updated.some((id,i)=>id!==favoritesRef.current[i])||updated.length!==favoritesRef.current.length){favoritesRef.current=updated;setFavorites(updated);}
    if(changed)dispatchPages({type:'aliases',aliases:next});
  }
  async function changeTool(id:string,remove:boolean){try{await api(remove?`/api/tools/${encodeURIComponent(id)}`:'/api/tools',remove?'DELETE':'PUT',remove?undefined:{id});await reload();}catch(e){setError((e as Error).message);}}
  function favorite(id:string){const next=favoritesRef.current.includes(id)?favoritesRef.current.filter(x=>x!==id):[...favoritesRef.current,id];favoritesRef.current=next;setFavorites(next);}
  function finishSearch(cancel=true){if(cancel&&searchRestore.current)setQuery(searchRestore.current.query);setSearchActive(false);restoreFocus(cancel?searchRestore.current?.focus||null:immersionRef.current,immersionRef.current);searchRestore.current=null;}
  function open(id:string,keep=false,pane:PaneId=workspace.active){dispatchPages({type:'open',id:aliasesRef.current[id]||id,keep},pane);if(searchActive)finishSearch(false);if(matchMedia('(max-width: 640px)').matches)setCollapsed(true);}
  function browserUrl(id:string){const ref=parseFileReference(aliasesRef.current[id]||id);return ref&&previewOrigin?previewOrigin+previewPath(ref.mountId,ref.relativePath):undefined;}
  function openFile(id:string,keep=false,pane:PaneId=workspace.active){
    const path=parseFileReference(aliasesRef.current[id]||id)?.relativePath||'';
    if(htmlOpening==='browser'&&/\.html?$/i.test(path)){
      if(keep)return;
      const url=browserUrl(id);if(url)window.open(url,'_blank','noopener,noreferrer');else setError('HTML 预览地址尚未就绪，请稍后重试。');
      return;
    }
    open(id,keep,pane);
  }
  function keepPage(id:string,pane:PaneId=workspace.active){dispatchPages({type:'keep',id:aliasesRef.current[id]||id},pane);}
  function closePage(id:string,pane:PaneId=workspace.active){
    if(!id)return;
    const action={type:'page' as const,pane,action:{type:'close' as const,id},closeEmpty:closeEmpty==='remove'};
    const next=workspaceReducer(workspace,action);dispatchWorkspace(action);
    if(Object.values(next.panes).every(item=>!item.items.length))setImmersive(false);
    requestAnimationFrame(()=>{const active=next.active;const file=next.panes[active].active;(document.getElementById(pageTabId(file,`pane-${active}`))||document.querySelector<HTMLElement>(`.reading-pane[data-pane="${active}"]`)||sidebarRef.current)?.focus({preventScroll:true});});
  }
  function focusPane(pane:PaneId,file:string){
    // Let the confirmation dialog restore focus before targeting the surviving pane.
    requestAnimationFrame(()=>requestAnimationFrame(()=>{(document.getElementById(pageTabId(file,`pane-${pane}`))||document.querySelector<HTMLElement>(`.reading-pane[data-pane="${pane}"]`))?.focus({preventScroll:true});}));
  }
  function closeReadingPane(pane:PaneId){
    if(!workspace.panes[pane])return;
    const action={type:'close-pane' as const,pane},next=workspaceReducer(workspace,action);
    for(const key of positions.current.keys())if(key.startsWith(`${pane}:`))positions.current.delete(key);
    dispatchWorkspace(action);setClosingPane(null);
    if(Object.values(next.panes).every(item=>!item.items.length))setImmersive(false);
    focusPane(next.active,next.panes[next.active].active);
  }
  function requestClosePane(pane:PaneId){
    if(!workspace.panes[pane])return;
    if(confirmPaneClose&&workspace.panes[pane].items.length>1)setClosingPane(pane);else closeReadingPane(pane);
  }
  function cancelPaneClose(){setClosingPane(null);focusPane(workspace.active,workspace.panes[workspace.active].active);}
  function closePreview(id:string,pane:PaneId=workspace.active){closePage(id,pane);}
  function toggleSidebar(){const show=!searchActive&&(immersive||collapsed);if(searchActive)finishSearch();if(show&&immersive)setImmersive(false);setCollapsed(!show);restoreFocus(sidebarRef.current);}
  function toggleImmersion(){
    if(!selected&&!immersive)return;
    if(searchActive)finishSearch();
    if(!immersive)immersionRestore.current=document.activeElement as HTMLElement|null;
    setImmersive(!immersive);
    requestAnimationFrame(()=>restoreFocus(immersive?immersionRestore.current:immersionExitRef.current,immersionRef.current));
  }
  useEffect(()=>{const url=new URL(location.href);if(selected)url.searchParams.set('entry',selected);else url.searchParams.delete('entry');history.replaceState(null,'',url);},[selected]);
  function runAction(action:BridgeAction,pane:PaneId=workspace.active){
    if(document.querySelector('[data-workbench-dialog]'))return;
    if(action==='split-rows'||action==='split-columns'){
      if(immersive){setImmersive(false);requestAnimationFrame(()=>splitPane(action==='split-rows'?'rows':'columns',pane));}
      else splitPane(action==='split-rows'?'rows':'columns',pane);
      return;
    }
    if(action==='maximize'){if(immersive)setImmersive(false);if(!immersive||workspace.maximized===null)dispatchWorkspace({type:'maximize',pane});return;}
    if(action==='toggle-keep-tab'){const id=workspace.panes[pane]?.active;if(id)dispatchPages({type:'toggle-keep',id},pane);return;}
    if(action==='close-pane'){if(immersive)setImmersive(false);requestClosePane(pane);return;}
    if(action==='close-tab'){if(immersive)setImmersive(false);closePage(workspace.panes[pane]?.active||'',pane);return;}
    if(action==='back'||action==='forward'){dispatchWorkspace({type:'history',pane,direction:action==='back'?-1:1});return;}
    if(action==='escape'){
      if(document.querySelector(`[data-viewer-settings][data-pane="${pane}"]`))return;
      if(searchActive)finishSearch();else if(immersive)toggleImmersion();else if(workspace.maximized!==null)dispatchWorkspace({type:'maximize',pane:workspace.maximized});return;
    }
    if(action==='sidebar')toggleSidebar();
    if(action==='immersive'&&workspace.panes[pane].active)toggleImmersion();
    if(action==='help')setHelp(true);
    if(action==='search'){if(immersive)setImmersive(false);if(!searchActive)searchRestore.current={query,focus:document.activeElement as HTMLElement|null};setSearchActive(true);requestAnimationFrame(()=>searchRef.current?.focus());}
  }
  useEffect(()=>{function keydown(e:KeyboardEvent){
    if(document.querySelector('[data-workbench-dialog]'))return;
    const action=shortcutFor(e,isEditing(e.target,e.composedPath()),shortcutsEnabled,navigationEnabled);
    if(!action)return;
    if(['split-rows','split-columns','maximize','toggle-keep-tab','close-tab','close-pane'].includes(action)&&document.querySelector('[role=menu],[data-viewer-settings]'))return;
    if(action==='escape'&&(document.querySelector(`[data-viewer-settings][data-pane="${workspace.active}"]`)||(!searchActive&&!immersive&&workspace.maximized===null)))return;
    e.preventDefault();if(!e.repeat)runAction(action);
  }document.addEventListener('keydown',keydown);return()=>document.removeEventListener('keydown',keydown);},[selected,immersive,collapsed,query,searchActive,shortcutsEnabled,navigationEnabled,workspace,closeEmpty,confirmPaneClose]);
  function resize(value:number){setWidth(Math.max(200,Math.min(440,value)));}
  const hidden=!searchActive&&(immersive||collapsed);
  const refs=(view==='tools'?tools:favorites.map(id=>({id,title:''}))).map(({id,title})=>({id,title,ref:parseFileReference(id)})).filter(({id,title,ref})=>`${title} ${ref?.relativePath||id} ${data.mounts.find(m=>m.id===ref?.mountId)?.label||''}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <><div inert={settingsPage||closingPane!==null} className={`shell ${hidden?'sidebar-hidden':''} ${immersive?'immersive':''}`} style={{'--sidebar-width':`${width}px`} as CSSProperties}>
    <header className="workspace-header"><button ref={sidebarRef} className="sidebar-toggle" aria-keyshortcuts={shortcutsEnabled?'b':undefined} title={`${hidden?'展开文件侧栏':'收起文件侧栏'}${shortcutsEnabled?' · B（工作台获得焦点时）':''}`} aria-label={hidden?'展开文件侧栏':'收起文件侧栏'} aria-expanded={!hidden} onClick={toggleSidebar}><Icon name="sidebar"/>{shortcutsEnabled&&<kbd aria-hidden="true">B</kbd>}</button><strong className="brand">AgentDeck</strong><span className="workspace-context">本地文件工作台</span><div className="workspace-actions">
      {searchActive&&<button onClick={()=>finishSearch()}>结束筛选</button>}
      <button ref={immersionRef} className="immersion-toggle" disabled={!selected&&!immersive} aria-label={immersive?'退出沉浸':'沉浸'} aria-pressed={immersive} aria-keyshortcuts={shortcutsEnabled?'f':undefined} title={`${immersive?'退出沉浸':'沉浸阅读'}${shortcutsEnabled?' · F（工作台获得焦点时）':''}`} onClick={toggleImmersion}><Icon name={immersive?'collapse':'expand'}/><span>{immersive?'退出沉浸':'沉浸'}</span>{shortcutsEnabled&&<kbd aria-hidden="true">F</kbd>}</button>
      <button aria-label="上下分屏" title="上下分屏 · O" onClick={()=>splitPane('rows')}>上下分屏</button>
      <button aria-label="左右分屏" title="左右分屏 · E" onClick={()=>splitPane('columns')}>左右分屏</button>
      <button aria-label={workspace.maximized===null?'最大化当前阅读区':'恢复分屏'} title="最大化 / 恢复 · X" disabled={Object.keys(workspace.panes).length===1} onClick={()=>dispatchWorkspace({type:'maximize',pane:workspace.active})}>{workspace.maximized===null?'最大化':'恢复分屏'}</button>
      <ThemePicker/>
      <button aria-label="设置" onClick={()=>setSettingsPage(true)}>设置</button>
      <button aria-label="使用帮助" onClick={()=>setGuide(true)}>使用帮助</button>
      <button aria-label="快捷键" title="快捷键" onClick={()=>setHelp(true)}>?</button>
    </div></header>
    <aside className="explorer" aria-label="文件资源浏览器" aria-hidden={hidden}>
      <OpenPages pages={pages.items} active={selected} snapshot={data} open={open} keep={keepPage} close={closePreview} expanded={openedExpanded} toggle={()=>setOpenedExpanded(!openedExpanded)}/>
      <div className="explorer-header"><nav aria-label="浏览视图"><button className={view==='files'?'active':''} onClick={()=>{setView('files');setQuery('');}}>文件</button><button className={view==='favorites'?'active':''} onClick={()=>{setView('favorites');setQuery('');}}>收藏</button><button className={view==='tools'?'active':''} onClick={()=>{setView('tools');setQuery('');}}>工具</button></nav><div className="explorer-actions">{view==='files'&&<FileTypeFilterControl value={fileTypeFilter} onChange={setFileTypeFilter}/>}<button aria-label={view==='tools'?'添加工具':'添加项目'} title={view==='tools'?'添加 HTML 工具':'添加项目 / 挂载目录'} onClick={()=>view==='tools'?setToolPicker(true):setManage('new')}><Icon name="plus"/></button><button aria-label="刷新目录" title="刷新已展开目录" onClick={()=>{void reload();setRefresh(v=>v+1);}}>↻</button></div></div>
      <div className="explorer-search"><input ref={searchRef} aria-label="筛选文件" type="search" placeholder={view==='tools'?'筛选工具':view==='favorites'?'筛选收藏':'筛选已加载文件…'} value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.nativeEvent.isComposing)return;if(e.key==='ArrowDown'||e.key==='Enter'){const first=Array.from(document.querySelectorAll<HTMLButtonElement>('.explorer-scroll .node-main:not(.folder)')).find(el=>el.getClientRects().length);if(first){e.preventDefault();if(e.key==='Enter')first.click();else first.focus();}}}}/></div>
      <div className="explorer-scroll" role="tree" aria-label={view==='files'?'目录与文件':view==='tools'?'常用工具':'收藏文件'} onKeyDown={e=>{
        if(e.nativeEvent.isComposing||e.ctrlKey||e.altKey||e.metaKey||!['ArrowUp','ArrowDown'].includes(e.key))return;
        const rows=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('.node-main')).filter(el=>el.getClientRects().length&&!el.disabled);
        const index=rows.indexOf(document.activeElement as HTMLButtonElement);if(index<0)return;e.preventDefault();rows[Math.max(0,Math.min(rows.length-1,index+(e.key==='ArrowDown'?1:-1)))]?.focus();
      }}>
        <div hidden={view!=='files'}>{data.projects.map(project=>{
          const mounts=data.mounts.filter(m=>m.projectId===project.id);
          return <div className="project-group" key={project.id}>
            {mounts.length!==1&&<div className="project-heading"><span>{project.name}</span><button aria-label={`管理项目：${project.name}`} onClick={()=>setManage(project.id)}>⋯</button></div>}
            {mounts.map(m=><Tree key={m.id} initialExpanded={expanded[m.id]} expansionChanged={paths=>setExpanded(previous=>({...previous,[m.id]:paths}))} mount={m} label={mounts.length===1?project.name:m.label} query={query} typeFilter={fileTypeFilter} selected={selected} favorites={favorites} refresh={refresh} open={openFile} internal={open} browserUrl={browserUrl} other={openOther} favorite={favorite} discovered={discovered} manage={mounts.length===1?()=>setManage(project.id):undefined}/>)}
            {!mounts.length&&<p className="tree-message">尚未挂载目录</p>}
          </div>;
        })}{!data.projects.length&&<div className="catalog-empty"><p>挂载目录后，展开文件夹开始浏览。</p><button onClick={()=>setManage('new')}>添加项目</button></div>}</div>
        {view!=='files'&&<>{refs.map(({id,title,ref})=>{
          const mount=data.mounts.find(m=>m.id===ref?.mountId);const name=title||ref?.relativePath.split('/').pop()||'旧收藏（展开原目录后恢复）';
          return <div className={`file-row ${id===selected?'selected':''}`} key={id}><button className="node-main" role="treeitem" aria-selected={id===selected} title={ref?`${mount?.label||'挂载不可用'} / ${ref.relativePath}${favoriteErrors[id]?' · '+favoriteErrors[id]:''}`:id} onClick={event=>{if(event.detail<=1)openFile(id);}} onDoubleClick={()=>openFile(id,true)}>{view==='tools'?<Icon name="tool"/>:<FileIcon name={name}/>}<span className="filename">{name}</span>{ref&&(!mount||!mount.enabled||favoriteErrors[id])&&<span className="node-status">不可用</span>}</button>{/\.html?$/i.test(ref?.relativePath||'')&&<FileOpenMenu name={name} url={browserUrl(id)} internal={()=>open(id)} other={()=>openOther(id)}/>}<button className={`row-action ${view==='tools'?'':'starred'}`} aria-label={`${view==='tools'?'移除工具':'取消收藏'}：${name}`} title={view==='tools'?'从工具列表移除，原文件保留':'取消收藏'} onClick={()=>view==='tools'?void changeTool(id,true):favorite(id)}>{view==='tools'?<Icon name="close"/>:'★'}</button></div>;
        })}{!refs.length&&<p className="tree-message">{query?'没有匹配的文件':view==='tools'?'点击上方＋添加 HTML，或在预览的更多菜单中加入工具。':'点击文件旁的星标，收藏常用文件。'}</p>}</>}
      </div><div className="explorer-footer">{view==='tools'?'常用 HTML 工具 · 原文件只读':view==='favorites'?'常用文件收藏':fileTypeFilter.mode!=='all'?`${fileTypeFilter.mode==='allow'?'白名单':'黑名单'} · ${fileTypeFilter.extensions.length} 种类型${query?' · 名称筛选中':''}`:query?'仅筛选已加载的目录和文件':'按需展开 · 原文件只读'}</div>
    </aside>
    <div className="catalog-resizer" role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" aria-valuemin={200} aria-valuemax={440} aria-valuenow={width} tabIndex={hidden?-1:0} onPointerDown={e=>{if(e.button!==0)return;drag.current={x:e.clientX,width};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(drag.current)resize(drag.current.width+e.clientX-drag.current.x);}} onPointerUp={e=>{drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}} onLostPointerCapture={()=>{drag.current=null;}} onKeyDown={e=>{if(e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||e.nativeEvent.isComposing)return;if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();resize(e.key==='Home'?200:e.key==='End'?440:width+(e.key==='ArrowLeft'?-10:10));}}}/>
    <ReadingLayout workspace={workspace} immersivePane={immersive?workspace.active:null} resize={(id,ratio)=>dispatchWorkspace({type:'resize',id,ratio})}>
      {(paneId,visible,style)=>{
        const pane=workspace.panes[paneId];const scope=`pane-${paneId}`;const history=workspace.histories[paneId];
        return <section key={paneId} tabIndex={-1} style={style} className={`reading-pane ${workspace.active===paneId?'active-pane':''}`} data-pane={paneId} aria-label={`阅读区 ${paneId+1}`} hidden={!visible} inert={!visible} onPointerDownCapture={()=>activatePane(paneId)} onFocusCapture={()=>activatePane(paneId)}>
          <div className="pane-navigation"><span>阅读区 {paneId+1}</span><button aria-label="后退" title="上一个文件 · Alt＋←" disabled={history.index<=0} onClick={()=>dispatchWorkspace({type:'history',pane:paneId,direction:-1})}>←</button><button aria-label="前进" title="下一个文件 · Alt＋→" disabled={history.index>=history.entries.length-1} onClick={()=>dispatchWorkspace({type:'history',pane:paneId,direction:1})}>→</button><button className="pane-close" aria-label={`关闭阅读区 ${paneId+1}`} title="关闭阅读区 · Q" aria-keyshortcuts={shortcutsEnabled?'q':undefined} onClick={()=>requestClosePane(paneId)}><Icon name="close"/></button></div>
          {!!pane.items.length&&<PageTabs scope={scope} pages={pane.items} active={pane.active} snapshot={data} open={id=>open(id,false,paneId)} keep={id=>keepPage(id,paneId)} close={id=>closePreview(id,paneId)}/>}
          {pane.items.length?pane.items.map(page=><Viewer documentFontSize={documentFontSize} keyboardActive={workspace.active===paneId} immersive={immersive} bridgeConfig={{mode:htmlKeys,singles:shortcutsEnabled,navigation:navigationEnabled,escape:immersive||searchActive||workspace.maximized!==null,active:!settingsPage&&!help&&!guide&&!manage&&!toolPicker&&closingPane===null}} bridgeAction={action=>runAction(action,paneId)} focused={()=>activatePane(paneId)} initialScroll={positions.current.get(`${paneId}:${page.id}`)} positionChanged={position=>positionChanged(`${paneId}:${page.id}`,position)} scope={scope} key={page.id} id={page.id} active={visible&&page.id===pane.active} titleChanged={title=>dispatchPages({type:'title',id:page.id,title},paneId)} tool={tools.some(t=>t.id===page.id)} toggleTool={()=>void changeTool(page.id,tools.some(t=>t.id===page.id))} favorite={favorites.includes(page.id)} toggleFavorite={()=>favorite(page.id)} navigate={(mountId,path)=>{activatePane(paneId);openFile(fileReference(mountId,path),false,paneId);}} other={()=>openOther(page.id)}/>):<section className="viewer"><div className="empty"><span className="eyebrow">AGENTDECK</span><h2>{Object.keys(workspace.panes).length===1?'打开报告，专注阅读。':'选择文件，开始对照。'}</h2><p>点击此阅读区，再从侧栏选择文件。双击文件保留标签。</p>{!data.projects.length&&<button className="primary" onClick={()=>setManage('new')}>挂载第一个目录</button>}<button onClick={()=>{activatePane(paneId);setImmersive(false);setCollapsed(false);}}>选择文件</button><button className="help-entry" onClick={()=>setGuide(true)}>如何使用与协作</button></div></section>}
        </section>;
      }}
    </ReadingLayout>
    {immersive&&<div className="immersion-exit-zone"><button ref={immersionExitRef} className="immersion-exit" aria-label="退出沉浸" title="退出沉浸 · F / Esc" onClick={toggleImmersion}>退出沉浸</button></div>}
    {(saveError||startupError)&&<div className="save-warning" role="alert">{saveError||startupError}{session&&<button onClick={retrySave}>重试保存</button>}</div>}
    {error&&<div className="toast" role="alert">{error}<button onClick={()=>setError('')}>关闭</button></div>}
    {manage&&<Management snapshot={data} project={data.projects.find(p=>p.id===manage)} close={()=>setManage(undefined)} saved={()=>{void reload();setRefresh(v=>v+1);}} removed={()=>{void reload();}}/>}
    {toolPicker&&<ToolPicker snapshot={data} close={()=>setToolPicker(false)} saved={()=>void reload()}/>}
    {guide&&<Help snapshot={data} selected={selected} close={()=>setGuide(false)} shortcuts={()=>setHelp(true)}/>}
    {help&&<ShortcutHelp close={()=>setHelp(false)} enabled={shortcutsEnabled} setEnabled={setShortcutsEnabled}/>}
  </div>{closingPane!==null&&<Dialog label="关闭阅读区" close={cancelPaneClose}><header><h2>关闭阅读区</h2><button aria-label="取消关闭阅读区" onClick={cancelPaneClose}>×</button></header><p>阅读区 {closingPane+1} 中有 {workspace.panes[closingPane]?.items.length||0} 个标签页，确定关闭整个阅读区吗？</p><footer><button onClick={cancelPaneClose}>取消</button><button className="primary" data-autofocus onClick={()=>closeReadingPane(closingPane)}>确定关闭</button></footer></Dialog>}{settingsPage&&<Settings currentSession={session?.id} close={closeSettings} htmlOpening={htmlOpening} setHtmlOpening={setHtmlOpening} singles={shortcutsEnabled} setSingles={setShortcutsEnabled} navigation={navigationEnabled} setNavigation={setNavigationEnabled} htmlKeys={htmlKeys} setHtmlKeys={setHtmlKeys} closeEmpty={closeEmpty} setCloseEmpty={setCloseEmpty} confirmPaneClose={confirmPaneClose} setConfirmPaneClose={setConfirmPaneClose} documentFontSize={documentFontSize} setDocumentFontSize={setDocumentFontSize}/>}</>;
}
