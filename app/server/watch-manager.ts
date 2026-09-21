import chokidar, { type FSWatcher } from 'chokidar';
import path from 'node:path';
import { hidden, inside } from './path-policy.js';
import type { Entry, Mount } from '../shared/model.js';
import type { Indexer } from './indexer.js';
type Session = { mount:Mount; watcher:FSWatcher; timer?:NodeJS.Timeout; paths:Set<string>; running:boolean; closed:boolean; fingerprint:string };
export class WatchManager {
  private sessions=new Map<string,Session>(); private revision=0; private interval?:NodeJS.Timeout; private recovering=false;
  constructor(private index:Indexer,private emit:(type:string,data:unknown)=>void){}
  async start(){await this.sync();this.interval=setInterval(()=>void this.recover(),1000);}
  private startMount(m:Mount){
    const watcher=chokidar.watch(m.absolutePath,{ignoreInitial:true,followSymlinks:false,atomic:true,awaitWriteFinish:{stabilityThreshold:300,pollInterval:75},ignored:(value,stat)=>{
      const rel=path.relative(m.absolutePath,value).split(path.sep).join('/');
      return inside(this.index.policy.stateDir,value)||!!stat?.isSymbolicLink()||hidden(rel,m.excludes,true);
    }});
    const session:Session={mount:m,watcher,paths:new Set(),running:false,closed:false,fingerprint:JSON.stringify(m)};
    this.sessions.set(m.id,session);
    watcher.on('all',(_event,filename)=>{const rel=path.relative(m.absolutePath,filename).split(path.sep).join('/');session.paths.add(rel);this.schedule(session);});
    watcher.on('error',()=>{session.paths.add('');this.schedule(session);});
  }
  private schedule(s:Session){if(s.closed)return;clearTimeout(s.timer);s.timer=setTimeout(()=>void this.flush(s),300);}
  private async flush(s:Session){
    if(s.closed||s.running)return;
    s.running=true;const paths=[...s.paths];s.paths.clear();const before=this.index.entries.get(s.mount.id)||[];
    try{
      await this.index.scan(s.mount);if(s.closed)return;
      const after=this.index.entries.get(s.mount.id)||[];
      const affects=(e:Entry)=>paths.some(p=>p===''||p===e.relativePath||(!e.resourceRoot||p===e.resourceRoot||p.startsWith(e.resourceRoot+'/')));
      const ids=[...new Set([...before,...after].filter(affects).map(e=>e.id))];
      const now=Date.now();for(const e of after)if(ids.includes(e.id))e.updatedAt=now;
      this.emit('entries-changed',{mountId:s.mount.id,projectId:s.mount.projectId,revision:++this.revision,paths,entryIds:ids});
      this.emit('mount-state',{mountId:s.mount.id,...this.index.states.get(s.mount.id)});
    }finally{s.running=false;if(s.paths.size)this.schedule(s);}
  }
  async sync(){
    for(const [id,s] of this.sessions){const m=this.index.registry.data.mounts.find(m=>m.id===id);if(!m||!m.enabled||JSON.stringify(m)!==s.fingerprint){s.closed=true;clearTimeout(s.timer);await s.watcher.close();this.sessions.delete(id);this.index.remove(id);}}
    for(const m of this.index.registry.data.mounts)if(m.enabled&&!this.sessions.has(m.id))this.startMount(m);
    await this.index.sync();
    this.emit('registry-changed',{revision:this.index.registry.data.revision});
  }
  private async recover(){
    if(this.recovering)return;this.recovering=true;
    try{for(const s of this.sessions.values()){
      if(s.closed||s.running)continue;
      let online=true;try{await this.index.policy.root(s.mount.absolutePath);}catch{online=false;}
      const wasOnline=this.index.states.get(s.mount.id)?.status==='online';
      if(online!==wasOnline){
        if(online){await s.watcher.close();if(s.closed)continue;this.startMount(s.mount);s.closed=true;clearTimeout(s.timer);const fresh=this.sessions.get(s.mount.id)!;fresh.paths.add('');await this.flush(fresh);}
        else{s.paths.add('');await this.flush(s);}
      }
    }}finally{this.recovering=false;}
  }
  async close(){clearInterval(this.interval);for(const s of this.sessions.values()){s.closed=true;clearTimeout(s.timer);this.index.remove(s.mount.id);}await Promise.all([...this.sessions.values()].map(s=>s.watcher.close()));this.sessions.clear();}
}
