import { useState } from 'react';
import type { Mount, TreeItem } from '../shared/model.js';
import { api } from './api.js';
export function Tree({mount,open,path=''}:{mount:Mount;open:(path:string)=>void;path?:string}) {
  const [items,setItems]=useState<TreeItem[]>();const [error,setError]=useState('');
  return <div className="tree">{!items?<button onClick={()=>void api<TreeItem[]>(`/api/mounts/${mount.id}/tree?path=${encodeURIComponent(path)}`).then(setItems).catch(e=>setError(e.message))}>展开目录</button>:items.map(item=>item.directory?<details key={item.relativePath}><summary>{item.name}/</summary><Tree mount={mount} path={item.relativePath} open={open}/></details>:<button key={item.relativePath} onClick={()=>open(item.relativePath)}>{item.name}</button>)}{error&&<small role="alert">{error}</small>}</div>;
}
