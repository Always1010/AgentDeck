import { useEffect, useState } from 'react';
import type { Snapshot } from '../shared/model.js';
import { api } from './api.js';
import { Management } from './Management.js';
import './style.css';
export function App() {
  const [data,setData] = useState<Snapshot>({projects:[],mounts:[],revision:0}); const [project,setProject] = useState(''); const [manage,setManage] = useState(false); const [error,setError] = useState('');
  function reload(){ void api<Snapshot>('/api/projects').then(setData).catch(e=>setError(e.message)); }
  useEffect(reload,[]);
  return <div className="shell"><aside><h1>AgentDeck</h1><p>本地项目工作台</p><button onClick={()=>{setProject('');setManage(true);}}>＋ 添加项目</button>{data.projects.map(p=><button key={p.id} onClick={()=>setProject(p.id)}>{p.name}</button>)}</aside><main><h2>{data.projects.find(p=>p.id===project)?.name || '从一个真实目录开始'}</h2><p>原地挂载，不移动原文件。</p>{project && <button onClick={()=>setManage(true)}>管理挂载</button>}{data.mounts.filter(m=>m.projectId===project).map(m=><p key={m.id}>{m.label} · {m.absolutePath}</p>)}{error && <p role="alert">{error}</p>}</main>{manage && <Management snapshot={data} project={data.projects.find(p=>p.id===project)} close={()=>setManage(false)} saved={reload} />}</div>;
}
