import { useEffect, useReducer, useRef, useState, type CSSProperties } from 'react';
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
import { pagesReducer, type PageAction } from './pages.js';
import { OpenPages, PageTabs, pageTabId } from './PageTabs.js';
import { initialWorkspace, workspaceReducer, isLayout, type Layout, type PaneId } from './workspace.js';
import { ThemePicker } from './Theme.js';
import { isEditing, restoreFocus, shortcutFor } from './shortcuts.js';
import { Settings, isHtmlOpening, type HtmlOpening } from './Settings.js';
import { isHtmlKeyMode, type HtmlKeyMode } from './useHtmlBridge.js';
import type { BridgeAction } from '../shared/bridge.js';
import { FileOpenMenu } from './FileOpenMenu.js';
import './style.css';
import './theme.css';
const empty:Snapshot={projects:[],mounts:[],revision:0};
export function App() {
  const standalone=location.pathname==='/preview';
  const [data,setData]=useState<Snapshot>(empty);
  const [workspace,dispatchWorkspace]=useReducer(workspaceReducer,new URLSearchParams(location.search).get('entry')||'',initialWorkspace);
  const pages=workspace.panes[workspace.active];
  const dispatchPages=(action:PageAction,pane:PaneId=workspace.active)=>dispatchWorkspace(action.type==='aliases'?action:{type:'page',pane,action});
  const [layout,setLayout]=usePreference<Layout>('reading.layout','single',isLayout);
  const validRatio=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=20&&value<=80;
  const [columnsRatio,setColumnsRatio]=usePreference('reading.columns-ratio',50,validRatio);
  const [rowsRatio,setRowsRatio]=usePreference('reading.rows-ratio',50,validRatio);
  const splitRatio=layout==='rows'?rowsRatio:columnsRatio;
  const readingArea=useRef<HTMLElement>(null);
  const paneDrag=useRef(false);
  function resizePane(value:number){const next=Math.max(20,Math.min(80,value));if(layout==='rows')setRowsRatio(next);else setColumnsRatio(next);}
  function activatePane(pane:PaneId){dispatchWorkspace({type:'activate',pane});}
  function openOther(id:string){const pane=(1-workspace.active) as PaneId;if(layout==='single')setLayout('columns');dispatchPages({type:'open',id:aliasesRef.current[id]||id,keep:true},pane);activatePane(pane);}
  useEffect(()=>{function focusFrame(){queueMicrotask(()=>{const pane=document.activeElement?.closest<HTMLElement>('[data-pane]');if(pane)activatePane(Number(pane.dataset.pane) as PaneId);});}window.addEventListener('blur',focusFrame);return()=>window.removeEventListener('blur',focusFrame);},[]);
  const selected=pages.active;
  const [openedExpanded,setOpenedExpanded]=usePreference('pages.expanded',true,isBoolean);
  const [favorites,setFavorites]=usePreference<string[]>('favorites',[],(v):v is string[]=>Array.isArray(v)&&v.every(x=>typeof x==='string'));
  const [aliases,setAliases]=usePreference<Record<string,string>>('file.aliases',{},(v):v is Record<string,string>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.values(v).every(x=>typeof x==='string'));
  const favoritesRef=useRef(favorites);favoritesRef.current=favorites;
  const aliasesRef=useRef(aliases);aliasesRef.current=aliases;
  const [view,setView]=useState<'files'|'favorites'|'tools'>('files');
  const [tools,setTools]=useState<ToolItem[]>([]);
  const [toolPicker,setToolPicker]=useState(false);
  const [query,setQuery]=useState('');
  const [refresh,setRefresh]=useState(0);
  const [manage,setManage]=useState<string>();
  const [error,setError]=useState('');
  const [immersive,setImmersive]=useState(standalone);
  const [collapsed,setCollapsed]=usePreference('explorer.collapsed',false,isBoolean);
  const [width,setWidth]=usePreference('explorer.width',280,(v):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=200&&v<=440);
  const [shortcutsEnabled,setShortcutsEnabled]=usePreference('shortcuts.enabled',true,isBoolean);
  const [htmlKeys,setHtmlKeys]=usePreference<HtmlKeyMode>('html.shortcuts','web',isHtmlKeyMode);
  const [navigationEnabled,setNavigationEnabled]=usePreference('shortcuts.navigation',true,isBoolean);
  const positions=useRef(new Map<string,{x:number;y:number}>());
  const [htmlOpening,setHtmlOpening]=usePreference<HtmlOpening>('html.opening','workbench',isHtmlOpening);
  const [previewOrigin,setPreviewOrigin]=useState('');
  const [settingsPage,setSettingsPage]=useState(location.hash==='#settings');
  useEffect(()=>{const changed=()=>setSettingsPage(location.hash==='#settings');window.addEventListener('hashchange',changed);return()=>window.removeEventListener('hashchange',changed);},[]);
  function closeSettings(){history.replaceState(null,'',location.pathname+location.search);setSettingsPage(false);}
  useEffect(()=>{void api<{previewOrigin:string}>('/api/status').then(status=>setPreviewOrigin(status.previewOrigin)).catch(()=>setError('无法获取 HTML 预览地址，请刷新工作台。'));},[]);
  const [help,setHelp]=useState(false);
  const [guide,setGuide]=useState(false);
  const [searchActive,setSearchActive]=useState(false);
  const searchRef=useRef<HTMLInputElement>(null);
  const immersionRef=useRef<HTMLButtonElement>(null);
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
    const next=pagesReducer(workspace.panes[pane],{type:'close',id});dispatchPages({type:'close',id},pane);
    if(!next.items.length)setImmersive(false);
    requestAnimationFrame(()=>{(document.getElementById(pageTabId(next.active,`pane-${pane}`))||sidebarRef.current)?.focus({preventScroll:true});});
  }
  function toggleSidebar(){const show=!searchActive&&(immersive||collapsed);if(searchActive)finishSearch();if(show&&immersive)setImmersive(false);setCollapsed(!show);restoreFocus(sidebarRef.current);}
  function toggleImmersion(){if(!selected&&!immersive)return;if(searchActive)finishSearch();if(!immersive)immersionRestore.current=document.activeElement as HTMLElement|null;setImmersive(!immersive);restoreFocus(immersive?immersionRestore.current:immersionRef.current,immersionRef.current);}
  useEffect(()=>{const url=new URL(location.href);if(selected)url.searchParams.set('entry',selected);else url.searchParams.delete('entry');history.replaceState(null,'',url);},[selected]);
  function runAction(action:BridgeAction,pane:PaneId=workspace.active){
    if(document.querySelector('[data-workbench-dialog]'))return;
    if(action==='back'||action==='forward'){dispatchWorkspace({type:'history',pane,direction:action==='back'?-1:1});return;}
    if(action==='escape'){
      if(document.querySelector(`[data-pane="${workspace.active}"] [data-viewer-settings]`))return;
      if(searchActive)finishSearch();else if(immersive)toggleImmersion();return;
    }
    if(action==='sidebar')toggleSidebar();
    if(action==='immersive'&&workspace.panes[pane].active)toggleImmersion();
    if(action==='help')setHelp(true);
    if(action==='search'){if(!searchActive)searchRestore.current={query,focus:document.activeElement as HTMLElement|null};setSearchActive(true);requestAnimationFrame(()=>searchRef.current?.focus());}
  }
  useEffect(()=>{function keydown(e:KeyboardEvent){
    if(document.querySelector('[data-workbench-dialog]'))return;
    const action=shortcutFor(e,isEditing(e.target),shortcutsEnabled,navigationEnabled);
    if(!action)return;
    if(action==='escape'&&(document.querySelector(`[data-pane="${workspace.active}"] [data-viewer-settings]`)||(!searchActive&&!immersive)))return;
    e.preventDefault();if(!e.repeat)runAction(action);
  }document.addEventListener('keydown',keydown);return()=>document.removeEventListener('keydown',keydown);},[selected,immersive,collapsed,query,searchActive,shortcutsEnabled,navigationEnabled,workspace.active]);
  function resize(value:number){setWidth(Math.max(200,Math.min(440,value)));}
  const hidden=!searchActive&&(immersive||collapsed);
  const refs=(view==='tools'?tools:favorites.map(id=>({id,title:''}))).map(({id,title})=>({id,title,ref:parseFileReference(id)})).filter(({id,title,ref})=>`${title} ${ref?.relativePath||id} ${data.mounts.find(m=>m.id===ref?.mountId)?.label||''}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <><div inert={settingsPage} className={`shell ${hidden?'sidebar-hidden':''} ${immersive?'immersive':''}`} style={{'--sidebar-width':`${width}px`} as CSSProperties}>
    <header className="workspace-header"><button ref={sidebarRef} className="sidebar-toggle" aria-keyshortcuts={shortcutsEnabled?'b':undefined} title={`${hidden?'展开文件侧栏':'收起文件侧栏'}${shortcutsEnabled?' · B（工作台获得焦点时）':''}`} aria-label={hidden?'展开文件侧栏':'收起文件侧栏'} aria-expanded={!hidden} onClick={toggleSidebar}><Icon name="sidebar"/>{shortcutsEnabled&&<kbd aria-hidden="true">B</kbd>}</button><strong className="brand">AgentDeck</strong><span className="workspace-context">本地文件工作台</span><div className="workspace-actions">
      {searchActive&&<button onClick={()=>finishSearch()}>结束筛选</button>}
      <button ref={immersionRef} className="immersion-toggle" disabled={!selected&&!immersive} aria-label={immersive?'退出沉浸':'沉浸'} aria-pressed={immersive} aria-keyshortcuts={shortcutsEnabled?'f':undefined} title={`${immersive?'退出沉浸':'沉浸阅读'}${shortcutsEnabled?' · F（工作台获得焦点时）':''}`} onClick={toggleImmersion}><Icon name={immersive?'collapse':'expand'}/><span>{immersive?'退出沉浸':'沉浸'}</span>{shortcutsEnabled&&<kbd aria-hidden="true">F</kbd>}</button>
      <label className="layout-picker"><span className="sr-only">阅读布局</span><select aria-label="阅读布局" value={layout} onChange={e=>setLayout(e.target.value as Layout)}><option value="single">单屏</option><option value="columns">左右分屏</option><option value="rows">上下分屏</option></select></label>
      <ThemePicker/>
      <button aria-label="设置" onClick={()=>{location.hash='settings';setSettingsPage(true);}}>设置</button>
      <button aria-label="使用帮助" onClick={()=>setGuide(true)}>使用帮助</button>
      <button aria-label="快捷键" title="快捷键" onClick={()=>setHelp(true)}>?</button>
    </div></header>
    <aside className="explorer" aria-label="文件资源浏览器" aria-hidden={hidden}>
      <OpenPages pages={pages.items} active={selected} snapshot={data} open={open} keep={keepPage} close={closePage} expanded={openedExpanded} toggle={()=>setOpenedExpanded(!openedExpanded)}/>
      <div className="explorer-header"><nav aria-label="浏览视图"><button className={view==='files'?'active':''} onClick={()=>{setView('files');setQuery('');}}>文件</button><button className={view==='favorites'?'active':''} onClick={()=>{setView('favorites');setQuery('');}}>收藏</button><button className={view==='tools'?'active':''} onClick={()=>{setView('tools');setQuery('');}}>工具</button></nav><div className="explorer-actions"><button aria-label={view==='tools'?'添加工具':'添加项目'} title={view==='tools'?'添加 HTML 工具':'添加项目 / 挂载目录'} onClick={()=>view==='tools'?setToolPicker(true):setManage('new')}><Icon name="plus"/></button><button aria-label="刷新目录" title="刷新已展开目录" onClick={()=>{void reload();setRefresh(v=>v+1);}}>↻</button></div></div>
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
            {mounts.map(m=><Tree key={m.id} mount={m} label={mounts.length===1?project.name:m.label} query={query} selected={selected} favorites={favorites} refresh={refresh} open={openFile} internal={open} browserUrl={browserUrl} other={openOther} favorite={favorite} discovered={discovered} manage={mounts.length===1?()=>setManage(project.id):undefined}/>)}
            {!mounts.length&&<p className="tree-message">尚未挂载目录</p>}
          </div>;
        })}{!data.projects.length&&<div className="catalog-empty"><p>挂载目录后，展开文件夹开始浏览。</p><button onClick={()=>setManage('new')}>添加项目</button></div>}</div>
        {view!=='files'&&<>{refs.map(({id,title,ref})=>{
          const mount=data.mounts.find(m=>m.id===ref?.mountId);const name=title||ref?.relativePath.split('/').pop()||'旧收藏（展开原目录后恢复）';
          return <div className={`file-row ${id===selected?'selected':''}`} key={id}><button className="node-main" role="treeitem" aria-selected={id===selected} title={ref?`${mount?.label||'挂载不可用'} / ${ref.relativePath}${favoriteErrors[id]?' · '+favoriteErrors[id]:''}`:id} onClick={event=>{if(event.detail<=1)openFile(id);}} onDoubleClick={()=>openFile(id,true)}>{view==='tools'?<Icon name="tool"/>:<FileIcon name={name}/>}<span className="filename">{name}</span>{ref&&(!mount||!mount.enabled||favoriteErrors[id])&&<span className="node-status">不可用</span>}</button>{/\.html?$/i.test(ref?.relativePath||'')&&<FileOpenMenu name={name} url={browserUrl(id)} internal={()=>open(id)} other={()=>openOther(id)}/>}<button className={`row-action ${view==='tools'?'':'starred'}`} aria-label={`${view==='tools'?'移除工具':'取消收藏'}：${name}`} title={view==='tools'?'从工具列表移除，原文件保留':'取消收藏'} onClick={()=>view==='tools'?void changeTool(id,true):favorite(id)}>{view==='tools'?<Icon name="close"/>:'★'}</button></div>;
        })}{!refs.length&&<p className="tree-message">{query?'没有匹配的文件':view==='tools'?'点击上方＋添加 HTML，或在预览的更多菜单中加入工具。':'点击文件旁的星标，收藏常用文件。'}</p>}</>}
      </div><div className="explorer-footer">{view==='tools'?'常用 HTML 工具 · 原文件只读':view==='favorites'?'常用文件收藏':query?'仅筛选已加载的目录和文件':'按需展开 · 原文件只读'}</div>
    </aside>
    <div className="catalog-resizer" role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" aria-valuemin={200} aria-valuemax={440} aria-valuenow={width} tabIndex={hidden?-1:0} onPointerDown={e=>{if(e.button!==0)return;drag.current={x:e.clientX,width};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(drag.current)resize(drag.current.width+e.clientX-drag.current.x);}} onPointerUp={e=>{drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}} onLostPointerCapture={()=>{drag.current=null;}} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();resize(e.key==='Home'?200:e.key==='End'?440:width+(e.key==='ArrowLeft'?-10:10));}}}/>
    <main ref={readingArea} className={`workspace-pages layout-${layout}`} style={{'--split-ratio':`${splitRatio}%`} as CSSProperties}>
      {workspace.panes.map((pane,index)=>{
        const paneId=index as PaneId;const visible=layout!=='single'||workspace.active===paneId;const scope=`pane-${paneId}`;const history=workspace.histories[paneId];
        return <section key={paneId} className={`reading-pane ${workspace.active===paneId?'active-pane':''}`} data-pane={paneId} aria-label={`阅读区 ${paneId+1}`} hidden={!visible} inert={!visible} onPointerDownCapture={()=>activatePane(paneId)} onFocusCapture={()=>activatePane(paneId)}>
          <div className="pane-navigation"><span>阅读区 {paneId+1}</span><button aria-label="后退" title="上一个文件 · Alt＋←" disabled={history.index<=0} onClick={()=>dispatchWorkspace({type:'history',pane:paneId,direction:-1})}>←</button><button aria-label="前进" title="下一个文件 · Alt＋→" disabled={history.index>=history.entries.length-1} onClick={()=>dispatchWorkspace({type:'history',pane:paneId,direction:1})}>→</button></div>
          {!!pane.items.length&&<PageTabs scope={scope} pages={pane.items} active={pane.active} snapshot={data} open={id=>open(id,false,paneId)} keep={id=>keepPage(id,paneId)} close={id=>closePage(id,paneId)}/>}
          {pane.items.length?pane.items.map(page=><Viewer keyboardActive={workspace.active===paneId} bridgeConfig={{mode:htmlKeys,singles:shortcutsEnabled,navigation:navigationEnabled,escape:immersive||searchActive,active:!settingsPage&&!help&&!guide&&!manage&&!toolPicker}} bridgeAction={action=>runAction(action,paneId)} focused={()=>activatePane(paneId)} initialScroll={positions.current.get(`${paneId}:${page.id}`)} positionChanged={position=>positions.current.set(`${paneId}:${page.id}`,position)} scope={scope} key={page.id} id={page.id} active={visible&&page.id===pane.active} titleChanged={title=>dispatchPages({type:'title',id:page.id,title},paneId)} tool={tools.some(t=>t.id===page.id)} toggleTool={()=>void changeTool(page.id,tools.some(t=>t.id===page.id))} favorite={favorites.includes(page.id)} toggleFavorite={()=>favorite(page.id)} back={()=>{if(standalone&&pane.items.length===1)location.href='/';else closePage(page.id,paneId);}} navigate={(mountId,path)=>{activatePane(paneId);openFile(fileReference(mountId,path),false,paneId);}} other={()=>openOther(page.id)}/>):<section className="viewer"><div className="empty"><span className="eyebrow">AGENTDECK</span><h2>{layout==='single'?'打开报告，专注阅读。':'选择文件，开始对照。'}</h2><p>点击此阅读区，再从侧栏选择文件。双击文件保留标签。</p>{!data.projects.length&&<button className="primary" onClick={()=>setManage('new')}>挂载第一个目录</button>}<button onClick={()=>{activatePane(paneId);setCollapsed(false);}}>选择文件</button><button className="help-entry" onClick={()=>setGuide(true)}>如何使用与协作</button></div></section>}
        </section>;
      })}
      <div className="reading-resizer" hidden={layout==='single'} role="separator" tabIndex={layout==='single'?-1:0} aria-label="调整阅读区比例" aria-orientation={layout==='rows'?'horizontal':'vertical'} aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(splitRatio)} onPointerDown={e=>{if(e.button!==0)return;paneDrag.current=true;e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(!paneDrag.current)return;const rect=readingArea.current!.getBoundingClientRect();resizePane(layout==='rows'?(e.clientY-rect.top)/rect.height*100:(e.clientX-rect.left)/rect.width*100);}} onPointerUp={e=>{paneDrag.current=false;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}} onLostPointerCapture={()=>{paneDrag.current=false;}} onDoubleClick={()=>resizePane(50)} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();resizePane(e.key==='Home'?20:e.key==='End'?80:splitRatio+(['ArrowLeft','ArrowUp'].includes(e.key)?-2:2));}}}/>
    </main>
    {error&&<div className="toast" role="alert">{error}<button onClick={()=>setError('')}>关闭</button></div>}
    {manage&&<Management snapshot={data} project={data.projects.find(p=>p.id===manage)} close={()=>setManage(undefined)} saved={()=>{void reload();setRefresh(v=>v+1);}} removed={()=>{void reload();}}/>}
    {toolPicker&&<ToolPicker snapshot={data} close={()=>setToolPicker(false)} saved={()=>void reload()}/>}
    {guide&&<Help snapshot={data} selected={selected} close={()=>setGuide(false)} shortcuts={()=>setHelp(true)}/>}
    {help&&<ShortcutHelp close={()=>setHelp(false)} enabled={shortcutsEnabled} setEnabled={setShortcutsEnabled}/>}
  </div>{settingsPage&&<Settings close={closeSettings} htmlOpening={htmlOpening} setHtmlOpening={setHtmlOpening} singles={shortcutsEnabled} setSingles={setShortcutsEnabled} navigation={navigationEnabled} setNavigation={setNavigationEnabled} htmlKeys={htmlKeys} setHtmlKeys={setHtmlKeys} layout={layout} setLayout={setLayout}/>}</>;
}
