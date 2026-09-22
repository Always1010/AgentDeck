import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Entry } from '../shared/model.js';
import { api, ApiError } from './api.js';
import { Icon } from './Icon.js';
import { Markdown } from './Markdown.js';
import { restoreFocus, shortcutFor } from './shortcuts.js';
import { usePreference } from './preferences.js';
import { useHtmlBridge, type HtmlKeyMode } from './useHtmlBridge.js';
import type { BridgeAction, BridgeConfig } from '../shared/bridge.js';
import { pagePanelId, pageTabId } from './PageTabs.js';
export function Viewer({documentFontSize=14,keyboardActive=true,bridgeConfig,bridgeAction,focused,initialScroll,positionChanged,scope,id,active,titleChanged,tool,toggleTool,favorite,toggleFavorite,back,navigate,other}:{documentFontSize?:number;keyboardActive?:boolean;bridgeConfig?:BridgeConfig;bridgeAction?:(action:BridgeAction)=>void;focused?:()=>void;initialScroll?:{x:number;y:number};positionChanged?:(position:{x:number;y:number})=>void;scope?:string;other?:()=>void;id:string;active:boolean;titleChanged:(title:string)=>void;tool:boolean;toggleTool:()=>void;favorite:boolean;toggleFavorite:()=>void;back:()=>void;navigate:(mountId:string,path:string)=>void}) {
  const [entry,setEntry]=useState<Entry>();const [text,setText]=useState('');const [source,setSource]=useState(false);
  const [version,setVersion]=useState(0);const [pending,setPending]=useState('');const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);const [settings,setSettings]=useState(false);const [downloadOnly,setDownloadOnly]=useState(false);
  const [copyStatus,setCopyStatus]=useState('');const [menuPosition,setMenuPosition]=useState({top:0,left:0});
  const menuRef=useRef<HTMLDivElement>(null);
  const readerRef=useRef<HTMLDivElement>(null);
  const initialPosition=useRef(initialScroll);
  useEffect(()=>{if(readerRef.current&&initialPosition.current){readerRef.current.scrollTo(initialPosition.current.x,initialPosition.current.y);}},[text,source]);
  const [keyOverride,setKeyOverride]=usePreference<'inherit'|HtmlKeyMode>(`html.shortcuts:${id}`,'inherit',(value):value is 'inherit'|HtmlKeyMode=>value==='inherit'||value==='web'||value==='workbench');
  const effectiveConfig:BridgeConfig={mode:keyOverride==='inherit'?bridgeConfig?.mode||'web':keyOverride,singles:bridgeConfig?.singles??true,navigation:bridgeConfig?.navigation??true,escape:!!bridgeConfig?.escape||settings,active:active&&!source&&(bridgeConfig?.active??true)};
  const bridge=useHtmlBridge({url:entry&&/^html?$/.test(entry.format)?entry.previewUrl:undefined,version,config:effectiveConfig,focus:()=>{setSettings(false);focused?.();},action:action=>{if(action==='escape'&&settings){setSettings(false);restoreFocus(settingsButton.current);}else bridgeAction?.(action);},position:initialPosition.current,positionChanged});
  const settingsButton=useRef<HTMLButtonElement>(null);const request=useRef(0);const live=useRef<Entry | undefined>(undefined);
  const sourceRef=useRef(source);sourceRef.current=source;
  const activeRef=useRef(active);activeRef.current=active;
  const titleRef=useRef(titleChanged);titleRef.current=titleChanged;
  useEffect(()=>{if(entry)titleRef.current(entry.title);},[entry?.title]);
  const endpoint=`/api/entries/${encodeURIComponent(id)}`;
  async function read(e:Entry){return (await api<{text:string}>(`/api/mounts/${e.mountId}/file?path=${encodeURIComponent(e.relativePath)}`)).text;}
  async function load(){const token=++request.current;setLoading(true);setError('');
    try{const e=await api<Entry>(endpoint);let contents='';let unsupported=false;
      if(/^html?$/.test(e.format)) {const response=await fetch(e.previewUrl!,{method:'HEAD'});if(!response.ok)throw new Error(`页面 HTTP ${response.status}`);if(sourceRef.current)contents=await read(e);}
      else try{contents=await read(e);}catch(error){if(error instanceof ApiError && (error.code==='NOT_TEXT'||error.code==='FILE_TOO_LARGE'))unsupported=true;else throw error;}
      if(token!==request.current)return;
      live.current=e;setEntry(e);setText(contents);setDownloadOnly(unsupported);setPending('');setVersion(v=>v+1);
    }catch(error){if(token===request.current)setError((error as Error).message);}
    finally{if(token===request.current)setLoading(false);}
  }
  useEffect(()=>{void load();return()=>{request.current++;};},[id]);
  useEffect(()=>{if(!active)return;let disposed=false;let checking=false;
    async function check(){
      if(checking||document.visibilityState!=='visible'||!live.current)return;checking=true;
      try{const current=live.current;const e=await api<Entry>(endpoint);if(disposed||!activeRef.current||current!==live.current)return;
        if(e.fileVersion!==current.fileVersion){if(current.refreshMode==='auto'&&!/^html?$/.test(current.format))void load();else setPending('文件已更新，点击加载更新。当前页面保持不变。');}
      }catch(e){if(!disposed)setPending((e as Error).message);}finally{checking=false;}
    }
    void check();const timer=setInterval(()=>void check(),4000);
    return()=>{disposed=true;clearInterval(timer);};
  },[id,active]);
  useEffect(()=>{if(!active)setSettings(false);},[active]);
  useLayoutEffect(()=>{if(!settings||!active)return;const button=settingsButton.current,menu=menuRef.current;if(!button||!menu)return;
    const anchor=button.getBoundingClientRect(),height=menu.offsetHeight,width=menu.offsetWidth;
    setMenuPosition({top:anchor.bottom+height+8>innerHeight?Math.max(8,anchor.top-height-6):anchor.bottom+6,left:Math.max(8,Math.min(innerWidth-width-8,anchor.right-width))});
  },[settings,active,entry?.format]);
  useEffect(()=>{if(!settings||!active)return;
    function outside(event:PointerEvent){const target=event.target as Node;if(!menuRef.current?.contains(target)&&!settingsButton.current?.contains(target))setSettings(false);}
    function escape(event:KeyboardEvent){if(document.querySelector('[data-workbench-dialog]')||shortcutFor(event,false,false)!=='escape')return;event.preventDefault();event.stopImmediatePropagation();setSettings(false);restoreFocus(settingsButton.current);}
    function blur(){if(document.activeElement?.tagName==='IFRAME')setSettings(false);}
    function resize(){setSettings(false);}
    document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape,true);window.addEventListener('blur',blur);window.addEventListener('resize',resize);
    return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);window.removeEventListener('blur',blur);window.removeEventListener('resize',resize);};
  },[settings,active]);
  async function toggleSource(){if(!entry)return;try{if(!source)setText(await read(entry));setSource(!source);}catch(e){setError((e as Error).message);}}
  async function copyOriginal(){if(!entry)return;try{await navigator.clipboard.writeText(await read(entry));setCopyStatus('已复制原文');window.setTimeout(()=>setCopyStatus(''),2500);}catch(e){setError((e as Error).message);}}
  async function preference(patch:Partial<Entry>){try{await api(`${endpoint}/preferences`,'PATCH',patch);const e=await api<Entry>(endpoint);live.current=e;setEntry(e);}catch(e){setError((e as Error).message);}}
  const download=entry?`/api/mounts/${entry.mountId}/download?path=${encodeURIComponent(entry.relativePath)}`:'';
  return <section className="viewer" role="tabpanel" id={pagePanelId(id,scope)} aria-labelledby={pageTabId(id,scope)} hidden={!active} inert={!active}><header className="toolbar"><div className="identity" title={entry?.relativePath}><strong>{entry?.title||'文件预览'}</strong></div><button className="icon-button" aria-label="刷新" data-tooltip="刷新文件" disabled={loading} onClick={()=>void load()}><Icon name="refresh"/></button><button className={`icon-button ${favorite?'is-favorite':''}`} aria-label={favorite?'取消收藏文件':'收藏文件'} data-tooltip={favorite?'取消收藏':'收藏'} aria-pressed={favorite} onClick={toggleFavorite}><Icon name="star" filled={favorite}/></button><a className="icon-button" aria-label="新标签" data-tooltip="在浏览器新标签中打开" href={entry&&/^html?$/.test(entry.format)?entry.previewUrl:`/preview?entry=${encodeURIComponent(id)}`} target="_blank" rel="noopener noreferrer"><Icon name="external"/></a><button className="icon-button" ref={settingsButton} aria-label="更多设置" data-tooltip="更多设置" aria-controls={`viewer-settings-${scope}`} aria-expanded={settings} onClick={()=>setSettings(!settings)}><Icon name="more"/></button><button className="icon-button" onClick={back} aria-label="关闭预览" data-tooltip="关闭当前页面"><Icon name="close"/></button></header>
    <div className="quick-actions"><button disabled={!entry||!other} onClick={()=>{setSettings(false);other?.();}}>分屏打开</button><button disabled={!entry||downloadOnly} onClick={()=>{setSettings(false);void toggleSource();}}>{source?'返回阅读':'查看源码'}</button><button disabled={!entry||downloadOnly} onClick={()=>{setSettings(false);void copyOriginal();}}>复制原文</button><span role="status" className="sr-only">{copyStatus}</span></div>
    {settings&&active&&createPortal(<div className="viewer-popover" ref={menuRef} id={`viewer-settings-${scope}`} data-viewer-settings data-pane={scope?.replace('pane-','')} role="group" aria-label="更多设置" style={menuPosition}>{entry&&<>
      {/^html?$/.test(entry.format)&&<button aria-pressed={tool} onClick={()=>{setSettings(false);toggleTool();}}><Icon name="tool"/>{tool?'从工具移除':'添加到工具'}</button>}
      {!/^html?$/.test(entry.format)&&!downloadOnly&&<label className="inline"><input type="checkbox" checked={entry.refreshMode==='auto'} onChange={e=>{setSettings(false);void preference({refreshMode:e.target.checked?'auto':'prompt'});}}/>自动更新文本</label>}
      <button onClick={()=>{setSettings(false);const title=prompt('显示名称',entry.title);if(title)void preference({title});}}>显示名称</button><a href={download} download onClick={()=>setSettings(false)}>下载原文件</a>
      {/^html?$/.test(entry.format)&&<label className="menu-select">此 HTML 快捷键<select value={keyOverride} onChange={event=>{setKeyOverride(event.target.value as 'inherit'|HtmlKeyMode);setSettings(false);}}><option value="inherit">跟随全局设置</option><option value="web">网页优先</option><option value="workbench">工作台优先</option></select></label>}
      <span className="muted">{entry.relativePath}</span>
    </>}</div>,document.body)}
    {entry&&/^html?$/.test(entry.format)&&active&&!source&&<div className="bridge-state" data-bridge-status={bridge.status} aria-live="polite">{effectiveConfig.mode==='web'?'网页快捷键优先':bridge.status==='ready'?'工作台快捷键优先':bridge.status==='waiting'?'正在连接页面快捷键…':'当前页面未接管快捷键，可使用工作台按钮'}</div>}
    {pending&&<div className="notice" role="status">{pending}<button onClick={()=>void load()}>加载更新</button><button onClick={()=>setPending('')}>稍后</button></div>}
    {error&&<div role="alert">{error}<button onClick={()=>void load()}>重试</button></div>}
    {!entry?<div className="empty">{loading?'正在打开文件…':'文件暂不可用。旧收藏可在展开原目录后自动恢复。'}</div>:downloadOnly?<div className="empty"><p>此文件暂不支持文本预览，或超过 10 MiB。</p><a href={download} download>下载原文件</a></div>:<>
      {/^html?$/.test(entry.format)&&<iframe ref={bridge.frame} onLoad={bridge.onLoad} style={{display:source?'none':undefined}} key={`${id}:${version}`} title={entry.title} src={entry.previewUrl} sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"/>}
      {(source||!/^html?$/.test(entry.format))&&<div className="reader" style={{fontSize:/^html?$/.test(entry.format)?undefined:documentFontSize}} ref={readerRef} onScroll={event=>positionChanged?.({x:event.currentTarget.scrollLeft,y:event.currentTarget.scrollTop})}>{!source&&/^(md|markdown)$/.test(entry.format)?<Markdown text={text} entry={entry} previewOrigin={new URL(entry.previewUrl!).origin} navigate={path=>navigate(entry.mountId,path)}/>:<pre>{text}</pre>}</div>}
    </>}
  </section>;
}
