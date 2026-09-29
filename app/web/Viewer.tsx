import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Entry } from '../shared/model.js';
import { api, ApiError } from './api.js';
import { Icon, type IconName } from './Icon.js';
import { restoreFocus, shortcutFor } from './shortcuts.js';
import { usePreference } from './preferences.js';
import { useHtmlBridge, type HtmlKeyMode } from './useHtmlBridge.js';
import type { BridgeAction, BridgeConfig } from '../shared/bridge.js';
import { pagePanelId, pageTabId } from './PageTabs.js';
import { LatestRead } from './viewers/requests.js';
import { isImageFormat, hasTextSource, versionedImageUrl } from './viewers/formats.js';
import { ImageViewer } from './viewers/ImageViewer.js';
import { HtmlViewer } from './viewers/HtmlViewer.js';
import { TextViewer } from './viewers/TextViewer.js';
import './viewers/viewers.css';
const toolbarActionOrder=['refresh','favorite','external','split','source','copy'] as const;
type ToolbarAction=typeof toolbarActionOrder[number];
export function Viewer({fullPath,reveal,reloadRequest=0,acknowledge,documentFontSize=14,keyboardActive=true,immersive=false,bridgeConfig,bridgeAction,focused,initialScroll,positionChanged,scope,id,active,titleChanged,tool,toggleTool,favorite,toggleFavorite,navigate,other}:{fullPath?:string;reveal?:()=>void;reloadRequest?:number;acknowledge?:(input:{id:string;version:string})=>Promise<void>;documentFontSize?:number;keyboardActive?:boolean;immersive?:boolean;bridgeConfig?:BridgeConfig;bridgeAction?:(action:BridgeAction)=>void;focused?:()=>void;initialScroll?:{x:number;y:number};positionChanged?:(position:{x:number;y:number})=>void;scope?:string;other?:()=>void;id:string;active:boolean;titleChanged:(title:string)=>void;tool:boolean;toggleTool:()=>void;favorite:boolean;toggleFavorite:()=>void;navigate:(mountId:string,path:string)=>void}) {
  const [entry,setEntry]=useState<Entry>();const [text,setText]=useState('');const [source,setSource]=useState(false);
  const [version,setVersion]=useState(0);const [pending,setPending]=useState('');const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);const [settings,setSettings]=useState(false);const [downloadOnly,setDownloadOnly]=useState(false);
  const [loadedVersion,setLoadedVersion]=useState('');const [htmlLoaded,setHtmlLoaded]=useState(false);
  const [sourceLoading,setSourceLoading]=useState(false);
  const [imageLoaded,setImageLoaded]=useState(false);
  const [pageVisible,setPageVisible]=useState(document.visibilityState==='visible');
  const acknowledged=useRef('');
  useEffect(()=>{const changed=()=>setPageVisible(document.visibilityState==='visible');document.addEventListener('visibilitychange',changed);return()=>document.removeEventListener('visibilitychange',changed);},[]);
  const [copyStatus,setCopyStatus]=useState('');const [menuPosition,setMenuPosition]=useState({top:0,left:0});
  const [visibleActions,setVisibleActions]=useState<number>(toolbarActionOrder.length);
  useLayoutEffect(()=>{if(immersive)setSettings(false);},[immersive]);
  const toolbarRef=useRef<HTMLElement>(null);
  const menuRef=useRef<HTMLDivElement>(null);
  const readerRef=useRef<HTMLDivElement>(null);
  const initialPosition=useRef(initialScroll);
  useEffect(()=>{if(active&&readerRef.current&&initialPosition.current){readerRef.current.scrollTo(initialPosition.current.x,initialPosition.current.y);initialPosition.current=undefined;}},[text,source,active]);
  const [keyOverride,setKeyOverride]=usePreference<'inherit'|HtmlKeyMode>(`html.shortcuts:${id}`,'inherit',(value):value is 'inherit'|HtmlKeyMode=>value==='inherit'||value==='web'||value==='workbench');
  const effectiveConfig:BridgeConfig={mode:keyOverride==='inherit'?bridgeConfig?.mode||'web':keyOverride,singles:bridgeConfig?.singles??true,navigation:bridgeConfig?.navigation??true,escape:!!bridgeConfig?.escape||settings,active:active&&!source&&(bridgeConfig?.active??true)};
  const bridge=useHtmlBridge({url:entry&&/^html?$/.test(entry.format)?entry.previewUrl:undefined,version,config:effectiveConfig,focus:()=>{setSettings(false);focused?.();},action:action=>{if(action==='escape'&&settings){setSettings(false);restoreFocus(settingsButton.current);}else bridgeAction?.(action);},position:initialPosition.current,positionChanged});
  const settingsButton=useRef<HTMLButtonElement>(null);const loads=useRef(new LatestRead());const sourceReads=useRef(new LatestRead());const live=useRef<Entry | undefined>(undefined);
  const sourceRef=useRef(source);sourceRef.current=source;
  const activeRef=useRef(active);activeRef.current=active;
  const titleRef=useRef(titleChanged);titleRef.current=titleChanged;
  useEffect(()=>{if(entry)titleRef.current(entry.title);},[entry?.title]);
  const endpoint=`/api/entries/${encodeURIComponent(id)}`;
  async function readResult(e:Entry,signal?:AbortSignal){return api<{text:string;fileVersion?:string}>(`/api/mounts/${e.mountId}/file?path=${encodeURIComponent(e.relativePath)}`,'GET',undefined,{signal});}
  async function read(e:Entry){return (await readResult(e)).text;}
  async function load(){const task=loads.current.begin();sourceReads.current.cancel();setSourceLoading(false);setLoading(true);setError('');setLoadedVersion('');setHtmlLoaded(false);setImageLoaded(false);
    try{const e=await api<Entry>(endpoint,'GET',undefined,{signal:task.signal});if(!task.current())return;let contents='';let unsupported=false;
      if(/^html?$/.test(e.format)||isImageFormat(e.format)) {const response=await fetch(e.previewUrl!,{method:'HEAD',signal:task.signal});if(!task.current())return;if(!response.ok)throw new Error(`页面 HTTP ${response.status}`);if(sourceRef.current&&hasTextSource(e.format)){const result=await readResult(e,task.signal);contents=result.text;e.fileVersion=result.fileVersion;}}
      else try{const result=await readResult(e,task.signal);contents=result.text;e.fileVersion=result.fileVersion;}catch(error){if(error instanceof ApiError && (error.code==='NOT_TEXT'||error.code==='FILE_TOO_LARGE'))unsupported=true;else throw error;}
      if(!task.current())return;
      live.current=e;setEntry(e);setText(contents);setDownloadOnly(unsupported);setPending('');setVersion(v=>v+1);setLoadedVersion(unsupported?'':e.fileVersion||'');
    }catch(error){if(task.current())setError((error as Error).message);}
    finally{if(task.current())setLoading(false);}
  }
  useEffect(()=>{void load();return()=>{loads.current.cancel();sourceReads.current.cancel();};},[id,reloadRequest]);
  useEffect(()=>{
    if(!acknowledge||!active||!pageVisible||loading||error||!loadedVersion||downloadOnly)return;
    if(entry&&/^html?$/.test(entry.format)&&!source&&(!htmlLoaded||bridge.status!=='ready'||bridge.documentVersion!==loadedVersion))return;
    if(entry&&isImageFormat(entry.format)&&!source&&!imageLoaded)return;
    const key=`${id}:${loadedVersion}`;if(acknowledged.current===key)return;
    acknowledged.current=key;
    void acknowledge({id,version:loadedVersion}).catch(()=>{if(acknowledged.current===key)acknowledged.current='';});
  },[acknowledge,id,active,pageVisible,loading,error,loadedVersion,downloadOnly,htmlLoaded,imageLoaded,bridge.status,bridge.documentVersion,source,entry?.format]);
  useEffect(()=>{if(!active)return;let disposed=false;let checking=false;
    async function check(){
      if(checking||document.visibilityState!=='visible'||!live.current)return;checking=true;
      try{const current=live.current;const e=await api<Entry>(endpoint);if(disposed||!activeRef.current||current!==live.current)return;
        if(e.fileVersion!==current.fileVersion){if(current.refreshMode==='auto'&&!/^html?$/.test(current.format)&&!isImageFormat(current.format))void load();else setPending('文件已更新，点击加载更新。当前页面保持不变。');}
      }catch(e){if(!disposed)setPending((e as Error).message);}finally{checking=false;}
    }
    void check();const timer=setInterval(()=>void check(),4000);
    return()=>{disposed=true;clearInterval(timer);};
  },[id,active]);
  useEffect(()=>{if(!active)setSettings(false);},[active]);
  useLayoutEffect(()=>{const bar=toolbarRef.current,trigger=settingsButton.current;if(!bar||!trigger)return;
    function measure(element:HTMLElement,button:HTMLButtonElement){const style=getComputedStyle(element),gap=parseFloat(style.columnGap)||0;
      const width=element.clientWidth-(parseFloat(style.paddingLeft)||0)-(parseFloat(style.paddingRight)||0);
      const buttonWidth=button.offsetWidth||28;
      setVisibleActions(Math.max(0,Math.min(toolbarActionOrder.length,Math.floor((width-88-buttonWidth-gap)/(buttonWidth+gap)))));
    }
    measure(bar,trigger);const observer=new ResizeObserver(()=>measure(bar,trigger));observer.observe(bar);return()=>observer.disconnect();
  },[]);
  useLayoutEffect(()=>{if(!settings||!active)return;const button=settingsButton.current,menu=menuRef.current;if(!button||!menu)return;
    function position(){const anchor=button!.getBoundingClientRect(),height=menu!.offsetHeight,width=menu!.offsetWidth;
      setMenuPosition({top:anchor.bottom+height+8>innerHeight?Math.max(8,anchor.top-height-6):anchor.bottom+6,left:Math.max(8,Math.min(innerWidth-width-8,anchor.right-width))});}
    position();const observer=new ResizeObserver(position);if(toolbarRef.current)observer.observe(toolbarRef.current);return()=>observer.disconnect();
  },[settings,active,entry?.format,visibleActions,source]);
  useEffect(()=>{if(!settings||!active)return;
    function outside(event:PointerEvent){const target=event.target as Node;if(!menuRef.current?.contains(target)&&!settingsButton.current?.contains(target))setSettings(false);}
    function escape(event:KeyboardEvent){if(document.querySelector('[data-workbench-dialog]')||shortcutFor(event,false,false)!=='escape')return;event.preventDefault();event.stopImmediatePropagation();setSettings(false);restoreFocus(settingsButton.current);}
    function blur(){if(document.activeElement?.tagName==='IFRAME')setSettings(false);}
    function resize(){setSettings(false);}
    document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape,true);window.addEventListener('blur',blur);window.addEventListener('resize',resize);
    return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);window.removeEventListener('blur',blur);window.removeEventListener('resize',resize);};
  },[settings,active]);
  async function toggleSource(){
    if(!entry||loading||sourceLoading)return;
    if(source){sourceReads.current.cancel();setSource(false);return;}
    const task=sourceReads.current.begin();const current=entry;setSourceLoading(true);
    try{const result=await readResult(current,task.signal);if(!task.current()||live.current!==current)return;setText(result.text);setLoadedVersion(result.fileVersion||'');setSource(true);}
    catch(e){if(task.current())setError((e as Error).message);}
    finally{if(task.current())setSourceLoading(false);}
  }
  async function copyOriginal(){if(!entry)return;try{await navigator.clipboard.writeText(await read(entry));setCopyStatus('已复制原文');window.setTimeout(()=>setCopyStatus(''),2500);}catch(e){setError((e as Error).message);}}
  async function copyPath(){if(!fullPath)return;try{await navigator.clipboard.writeText(fullPath);setCopyStatus('已复制完整路径');window.setTimeout(()=>setCopyStatus(''),2500);}catch{setError('未能复制路径，请从更多菜单中选中完整路径后手动复制。');}}
  async function preference(patch:Partial<Entry>){try{await api(`${endpoint}/preferences`,'PATCH',patch);const e=await api<Entry>(endpoint);live.current=e;setEntry(e);}catch(e){setError((e as Error).message);}}
  const download=entry?`/api/mounts/${entry.mountId}/download?path=${encodeURIComponent(entry.relativePath)}`:'';
  const actionDetails:Record<ToolbarAction,{label:string;tip:string;icon:IconName;disabled?:boolean;pressed?:boolean;href?:string;run?:()=>void;menuLabel?:string}>={
    refresh:{label:'刷新',tip:'刷新当前文件',icon:'refresh',disabled:loading,run:()=>void load()},
    favorite:{label:favorite?'取消收藏文件':'收藏文件',tip:favorite?'取消收藏':'收藏文件',icon:'star',pressed:favorite,run:toggleFavorite},
    external:{label:'新标签',menuLabel:'在浏览器新标签页打开',tip:'在浏览器新标签页打开',icon:'external',href:entry&&/^html?$/.test(entry.format)?entry.previewUrl:`/preview?entry=${encodeURIComponent(id)}`},
    split:{label:'分屏打开',tip:'在右侧新分屏打开当前文件',icon:'split',disabled:!entry||!other,run:()=>other?.()},
    source:{label:source?'返回阅读':'查看源码',tip:source?'返回阅读':'查看文件源码',icon:source?'book':'code',disabled:!entry||downloadOnly||loading||sourceLoading||!hasTextSource(entry.format),run:()=>void toggleSource()},
    copy:{label:'复制原文',tip:'复制文件原文',icon:'copy',disabled:!entry||downloadOnly||!hasTextSource(entry.format),run:()=>void copyOriginal()},
  };
  function renderAction(action:ToolbarAction,inMenu:boolean){const detail=actionDetails[action];const content=inMenu?detail.menuLabel||detail.label:<Icon name={detail.icon} filled={action==='favorite'&&favorite}/>;
    if(detail.href)return <a key={action} className={inMenu?undefined:'icon-button'} data-toolbar-action={inMenu?undefined:action} data-overflow-action={inMenu?action:undefined} aria-label={inMenu?detail.menuLabel||detail.label:detail.label} data-tooltip={inMenu?undefined:detail.tip} href={detail.href} target="_blank" rel="noopener noreferrer" onClick={()=>{if(inMenu)setSettings(false);}}>{content}</a>;
    return <button key={action} className={inMenu?undefined:`icon-button ${action==='favorite'&&favorite?'is-favorite':''}`} data-toolbar-action={inMenu?undefined:action} data-overflow-action={inMenu?action:undefined} aria-label={detail.label} data-tooltip={inMenu?undefined:detail.tip} aria-pressed={detail.pressed} disabled={detail.disabled} onClick={()=>{if(inMenu)setSettings(false);detail.run?.();}}>{content}</button>;
  }
  return <section className="viewer" role="tabpanel" id={pagePanelId(id,scope)} aria-labelledby={pageTabId(id,scope)} hidden={!active} inert={!active}><header className="toolbar" ref={toolbarRef}><div className="identity" title={entry?.relativePath}><strong>{entry?.title||'文件预览'}</strong></div>{toolbarActionOrder.slice(0,visibleActions).map(action=>renderAction(action,false))}<button className="icon-button" ref={settingsButton} aria-label="更多设置" data-tooltip="更多操作与设置" aria-controls={`viewer-settings-${scope}`} aria-expanded={settings} onClick={()=>setSettings(!settings)}><Icon name="more"/></button></header>
    <span aria-live="polite" className="sr-only">{copyStatus}</span>
    {settings&&active&&createPortal(<div className="viewer-popover" ref={menuRef} id={`viewer-settings-${scope}`} data-viewer-settings data-pane={scope?.replace('pane-','')} role="group" aria-label="更多设置" style={menuPosition}>
      {visibleActions<toolbarActionOrder.length&&<div className="viewer-overflow-actions" role="group" aria-label="收起的工具栏操作">{toolbarActionOrder.slice(visibleActions).map(action=>renderAction(action,true))}</div>}
      {entry&&<>
      <div className="viewer-menu-secondary">
      {fullPath&&<button onClick={()=>{setSettings(false);void copyPath();}}>复制完整路径</button>}
      {reveal&&<button onClick={()=>{setSettings(false);reveal();}}>在文件树中定位</button>}
      {/^html?$/.test(entry.format)&&<button aria-pressed={tool} onClick={()=>{setSettings(false);toggleTool();}}><Icon name="tool"/>{tool?'从工具移除':'添加到工具'}</button>}
      {!/^html?$/.test(entry.format)&&!isImageFormat(entry.format)&&!downloadOnly&&<label className="inline"><input type="checkbox" checked={entry.refreshMode==='auto'} onChange={e=>{setSettings(false);void preference({refreshMode:e.target.checked?'auto':'prompt'});}}/>自动更新文本</label>}
      <button onClick={()=>{setSettings(false);const title=prompt('显示名称',entry.title);if(title)void preference({title});}}>显示名称</button><a href={download} download onClick={()=>setSettings(false)}>下载原文件</a>
      {/^html?$/.test(entry.format)&&<label className="menu-select">此 HTML 快捷键<select value={keyOverride} onChange={event=>{setKeyOverride(event.target.value as 'inherit'|HtmlKeyMode);setSettings(false);}}><option value="inherit">跟随全局设置</option><option value="web">网页优先</option><option value="workbench">工作台优先</option></select></label>}
      <span className="muted">{fullPath||entry.relativePath}</span>
      </div>
    </>}</div>,document.body)}
    {entry&&/^html?$/.test(entry.format)&&active&&!source&&<div className="bridge-state" data-bridge-status={bridge.status} aria-live="polite">{effectiveConfig.mode==='web'?'网页快捷键优先':bridge.status==='ready'?'工作台快捷键优先':bridge.status==='waiting'?'正在连接页面快捷键…':'当前页面未接管快捷键，可使用工作台按钮'}</div>}
    {pending&&<div className="notice" role="status">{pending}<button onClick={()=>void load()}>加载更新</button><button onClick={()=>setPending('')}>稍后</button></div>}
    {error&&<div role="alert">{error}<button onClick={()=>void load()}>重试</button></div>}
    {!entry?<div className="empty">{loading?'正在打开文件…':'文件暂不可用。旧收藏可在展开原目录后自动恢复。'}</div>:downloadOnly?<div className="empty"><p>此文件暂不支持文本预览，或超过 10 MiB。</p><a href={download} download>下载原文件</a></div>:<>
      {/^html?$/.test(entry.format)&&<HtmlViewer frame={bridge.frame} loaded={()=>{bridge.onLoad();setHtmlLoaded(true);}} source={source} key={`${id}:${version}`} title={entry.title} url={entry.previewUrl}/>}
      {isImageFormat(entry.format)&&!source&&<ImageViewer key={`${id}:${version}`} title={entry.title} url={versionedImageUrl(entry.previewUrl!,loadedVersion)} loaded={()=>setImageLoaded(true)}/>}
      {(source||(!/^html?$/.test(entry.format)&&!isImageFormat(entry.format)))&&<div className="reader" style={{fontSize:/^html?$/.test(entry.format)?undefined:documentFontSize}} ref={readerRef} onScroll={event=>positionChanged?.({x:event.currentTarget.scrollLeft,y:event.currentTarget.scrollTop})}><TextViewer text={text} entry={entry} source={source} navigate={path=>navigate(entry.mountId,path)} keyboardActive={active&&keyboardActive} shortcutsEnabled={bridgeConfig?.singles??true}/></div>}
    </>}
  </section>;
}
