import type { Snapshot } from '../shared/model.js';
import type { FileUpdate, UpdatesSnapshot } from '../shared/updates.js';
import { isBoolean, usePreference } from './preferences.js';

type Props={snapshot:UpdatesSnapshot;projects:Snapshot;error:string;ready:boolean;saving:boolean;open:(item:FileUpdate)=>void;acknowledge:(input:{id:string;version:string}|{through:number})=>Promise<void>;retry:()=>Promise<void>};
export function UnreadFiles({snapshot,projects,error,ready,saving,open,acknowledge,retry}:Props){
  const [expanded,setExpanded]=usePreference('updates.expanded',true,isBoolean);
  const errors=[error,...snapshot.errors].filter(Boolean);
  return <section className="unread-files" aria-label="更新未读文件">
    <header><button className="unread-toggle" aria-expanded={expanded} aria-controls="unread-list" onClick={()=>setExpanded(!expanded)}><span aria-hidden="true">{expanded?'▾':'▸'}</span> 更新未读 <span className="unread-count">{snapshot.total}</span></button>
      <button className="unread-all" disabled={!snapshot.total||saving||!ready} onClick={()=>void acknowledge({through:snapshot.through}).catch(()=>{})}>全部标为已读</button></header>
    {!!errors.length&&<div className="unread-error" role="alert">{errors.join(' ')}<button onClick={()=>void retry()}>刷新状态</button></div>}
    {expanded&&<div id="unread-list" className="unread-list">
      <p className="unread-status" aria-live="polite">{!ready?'正在准备更新检测…':saving?'正在同步文件类型筛选…':snapshot.busy?'正在核对文件变化…':snapshot.total?'与文件类型筛选一致':'暂无符合筛选的未读更新'}</p>
      <ul>{snapshot.items.map(item=>{
        const mount=projects.mounts.find(m=>m.id===item.mountId),project=projects.projects.find(p=>p.id===mount?.projectId);
        const name=item.relativePath.split('/').pop()!;
        const location=[project?.name,mount?.label!==project?.name?mount?.label:undefined,item.relativePath.includes('/')?item.relativePath.slice(0,item.relativePath.lastIndexOf('/')):undefined].filter(Boolean).join(' / ');
        return <li key={item.id}>
          <button className="unread-open" title={`${location} / ${name}`} onClick={()=>open(item)}>
            <span className={`unread-kind ${item.kind}`}>{item.kind==='added'?'新增':'更新'}</span><span className="unread-name">{name}</span>
            <small className="unread-location">{location}</small><time dateTime={new Date(item.changedAt).toISOString()} title={new Date(item.changedAt).toLocaleString()}>{new Date(item.changedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time>
          </button>
          <button className="unread-mark" aria-label={`标为已读：${name}`} title="标为已读" onClick={()=>void acknowledge({id:item.id,version:item.version}).catch(()=>{})}>✓</button>
        </li>;
      })}</ul>
      {snapshot.total>snapshot.items.length&&<p className="unread-status">显示最近 {snapshot.items.length} 个，共 {snapshot.total} 个；读完后继续显示其余文件。</p>}
    </div>}
  </section>;
}
