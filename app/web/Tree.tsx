import { useEffect, useRef, useState } from 'react';
import { fileReference, type Mount, type TreeItem } from '../shared/model.js';
import { api } from './api.js';
import { FileOpenMenu } from './FileOpenMenu.js';

type Listing = { items?: TreeItem[]; error?: string; loading?: boolean };
type Props = { mount: Mount; label: string; query: string; selected: string; favorites: string[]; refresh: number; open: (id: string, keep?: boolean) => void; internal: (id: string) => void; browserUrl: (id: string) => string | undefined; other?: (id: string) => void; favorite: (id: string) => void; discovered: (mount: Mount, items: TreeItem[]) => void; manage?: () => void };
export function FileIcon({name}:{name:string}) {
  const ext = name.split('.').pop()?.toLowerCase();
  const kind = /^(html?|md|markdown|csv)$/.test(ext || '') ? ext : 'file';
  return <span aria-hidden="true" className={`file-icon icon-${kind}`}>{/^html?$/.test(ext || '') ? 'H' : /^(md|markdown)$/.test(ext || '') ? 'M' : ext === 'csv' ? 'C' : '≡'}</span>;
}
export function Tree({mount,label,query,selected,favorites,refresh,open,internal,browserUrl,other,favorite,discovered,manage}:Props) {
  const [expanded,setExpanded] = useState<Set<string>>(new Set());
  const [cache,setCache] = useState<Record<string,Listing>>({});
  const live = useRef({expanded,mount,discovered}); live.current = {expanded,mount,discovered};
  const generation = useRef(0); const pending = useRef(new Set<string>());
  async function load(path:string, quiet=false) {
    if (pending.current.has(path)) return;
    const token = generation.current; pending.current.add(path);
    if (!quiet) setCache(c=>({...c,[path]:{...c[path],loading:true,error:undefined}}));
    try {
      const items = await api<TreeItem[]>(`/api/mounts/${mount.id}/tree?path=${encodeURIComponent(path)}`);
      if (token !== generation.current) return;
      setCache(c=>({...c,[path]:{items}})); live.current.discovered(live.current.mount,items);
    } catch (e) { if(token === generation.current) setCache(c=>({...c,[path]:{...c[path],loading:false,error:(e as Error).message}})); }
    finally { if(token === generation.current) pending.current.delete(path); }
  }
  useEffect(()=>{
    generation.current++; pending.current.clear(); setCache({});
    if(mount.enabled) for(const path of live.current.expanded) void load(path);
    return ()=>{generation.current++;pending.current.clear();};
  },[mount.absolutePath,mount.enabled,JSON.stringify(mount.excludes)]);
  useEffect(()=>{
    if(!mount.enabled)return;
    for(const path of live.current.expanded) void load(path,true);
    const timer=setInterval(()=>{if(document.visibilityState==='visible')for(const path of live.current.expanded){const parts=path.split('/');if(path==='' || (live.current.expanded.has('')&&parts.slice(0,-1).every((_,i)=>live.current.expanded.has(parts.slice(0,i+1).join('/')))))void load(path,true);}},4000);
    return ()=>clearInterval(timer);
  },[refresh,mount.enabled,mount.absolutePath,JSON.stringify(mount.excludes)]);
  function toggle(path:string) {
    const next = new Set(expanded);
    if(next.has(path)) next.delete(path); else {next.add(path);if(!cache[path]?.items || cache[path]?.error)void load(path);}
    setExpanded(next);
  }
  const term=query.trim().toLowerCase();
  function matches(item:TreeItem):boolean {return item.name.toLowerCase().includes(term) || item.relativePath.toLowerCase().includes(term) || !!(item.directory && cache[item.relativePath]?.items?.some(matches));}
  function directory(path:string,name:string,depth:number,root=false) {
    const listing=cache[path];
    const opened=expanded.has(path) || !!(term && listing?.items?.some(matches));
    return <div role="none" key={path}>
      <div className="file-row" style={{paddingLeft:8+depth*14}}>
        <button className="node-main folder" role="treeitem" aria-level={depth+1} aria-expanded={opened} disabled={!mount.enabled} title={root?mount.absolutePath:path} onClick={()=>toggle(path)} onKeyDown={e=>{
          if(e.key==='ArrowRight'&&!opened){e.preventDefault();toggle(path);}else if(e.key==='ArrowLeft'&&opened){e.preventDefault();toggle(path);}
        }}><span className="chevron" aria-hidden="true">{listing?.loading?'·':opened?'▾':'▸'}</span><span className="filename">{name}</span>{!mount.enabled&&<span className="node-status">停用</span>}</button>
        {root&&manage&&<button className="row-action" aria-label={`管理项目：${label}`} title="管理目录" onClick={manage}>⋯</button>}
      </div>
      {opened&&<div role="group">
        {listing?.error&&<div className="tree-message" role="alert">{listing.error}<button onClick={()=>void load(path)}>重试</button></div>}
        {!listing?.items&&!listing?.error&&<div className="tree-message">正在读取…</div>}
        {listing?.items?.length===0&&<div className="tree-message">空目录</div>}
        {listing?.items?.filter(item=>!term||matches(item)).map(item=>{
          if(item.directory)return directory(item.relativePath,item.name,depth+1);
          const id=fileReference(mount.id,item.relativePath);const starred=favorites.includes(id);
          return <div className={`file-row ${selected===id?'selected':''}`} role="none" key={item.relativePath} style={{paddingLeft:8+(depth+1)*14}}>
            <button className="node-main" role="treeitem" aria-level={depth+2} aria-selected={selected===id} title={item.relativePath} onClick={event=>{if(event.detail<=1)open(id);}} onDoubleClick={()=>open(id,true)}><FileIcon name={item.name}/><span className="filename">{item.name}</span></button>
            {/\.html?$/i.test(item.name)&&<FileOpenMenu name={item.name} url={browserUrl(id)} internal={()=>internal(id)} other={other?()=>other(id):undefined}/>}
            <button className={`row-action ${starred?'starred':''}`} aria-label={`${starred?'取消收藏':'收藏'}：${item.name}`} onClick={()=>favorite(id)}>{starred?'★':'☆'}</button>
          </div>;
        })}
      </div>}
    </div>;
  }
  return <div className="mount-tree">{directory('',label,0,true)}</div>;
}
