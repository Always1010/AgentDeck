import chokidar, { type FSWatcher } from 'chokidar';
import path from 'node:path';
import { hidden, inside } from './path-policy.js';
import type { Entry, Mount } from '../shared/model.js';
import type { Indexer } from './indexer.js';
type Session = { mount:Mount; watcher:FSWatcher; timer?:NodeJS.Timeout; paths:Set<string>; running:boolean; closed:boolean; fingerprint:string };
export class WatchManager {
  private sessions=new Map<string,Session>(); private revision=0; private interval?:NodeJS.Timeout; private recovering=false;
  private configured=new Map<string,string>(); private pending=new Set<string>(); private queue:Promise<void>=Promise.resolve(); private scans=new Set<Promise<void>>(); private stopped=false;
  constructor(private index:Indexer,private emit:(type:string,data:unknown)=>void){}
  async start(){for(const m of this.index.registry.data.mounts){this.configured.set(m.id,JSON.stringify(m));if(m.enabled)this.startMount(m);}this.interval=setInterval(()=>void this.recover(),1000);}
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
      if(!await this.index.scan(s.mount)||s.closed)return;
      const after=this.index.entries.get(s.mount.id)||[];
      const affects=(e:Entry)=>paths.some(p=>p===''||p===e.relativePath||(!e.resourceRoot||p===e.resourceRoot||p.startsWith(e.resourceRoot+'/')));
      const ids=[...new Set([...before,...after].filter(affects).map(e=>e.id))];
      const now=Date.now();for(const e of after)if(ids.includes(e.id))e.updatedAt=now;
      this.emit('entries-changed',{mountId:s.mount.id,projectId:s.mount.projectId,revision:++this.revision,paths,entryIds:ids});
      this.emit('mount-state',{mountId:s.mount.id,...this.index.states.get(s.mount.id)});
    }finally{s.running=false;if(s.paths.size)this.schedule(s);}
  }
  sync(force: string[] = []){
    if(this.stopped)return;
    const mounts=this.index.registry.data.mounts;
    for(const [id] of this.configured)if(!mounts.some(m=>m.id===id)){this.configured.delete(id);this.index.remove(id);}
    for(const m of mounts){const fingerprint=JSON.stringify(m);if(this.configured.get(m.id)===fingerprint)continue;
      this.configured.set(m.id,fingerprint);this.index.remove(m.id);this.index.states.set(m.id,{status:m.enabled?'scanning':'disabled'});
    }
    for(const id of force){const m=mounts.find(m=>m.id===id);if(m?.enabled){this.pending.add(id);this.index.remove(id);this.index.states.set(id,{status:'scanning'});}}
    this.emit('registry-changed',{revision:this.index.registry.data.revision});
    this.queue=this.queue.then(()=>this.reconcile()).catch(error=>{
      for(const m of this.index.registry.data.mounts)if(this.index.states.get(m.id)?.status==='scanning'){
        this.index.states.set(m.id,{status:'offline',error:String(error)});
        this.emit('mount-state',{mountId:m.id,...this.index.states.get(m.id)});
      }
    });
  }
  private async reconcile(){
    if(this.stopped)return;
    for(const [id,s] of this.sessions){const m=this.index.registry.data.mounts.find(m=>m.id===id);if(!m||!m.enabled||JSON.stringify(m)!==s.fingerprint){s.closed=true;clearTimeout(s.timer);await s.watcher.close();this.sessions.delete(id);this.index.remove(id);if(m)this.index.states.set(id,{status:m.enabled?'scanning':'disabled'});}}
    if(this.stopped)return;
    for(const m of this.index.registry.data.mounts)if(m.enabled&&(!this.sessions.has(m.id)||this.pending.has(m.id))){
      if(!this.sessions.has(m.id))this.startMount(m);
      this.pending.delete(m.id);
      const session=this.sessions.get(m.id)!;
      const scan=this.index.scan(m).then(committed=>{
        if(!committed||session.closed||this.stopped)return;
        const entries=this.index.entries.get(m.id)||[];
        this.emit('entries-changed',{mountId:m.id,projectId:m.projectId,revision:++this.revision,paths:[''],entryIds:entries.map(e=>e.id)});
        this.emit('mount-state',{mountId:m.id,...this.index.states.get(m.id)});
      }).catch(error=>{if(!session.closed&&!this.stopped&&this.configured.get(m.id)===JSON.stringify(m)){this.index.states.set(m.id,{status:'offline',error:String(error)});this.emit('mount-state',{mountId:m.id,...this.index.states.get(m.id)});}});
      this.scans.add(scan);void scan.finally(()=>this.scans.delete(scan));
    }
  }
  private async recover(){
    if(this.recovering)return;this.recovering=true;
    try{for(const s of this.sessions.values()){
      if(s.closed||s.running||this.index.states.get(s.mount.id)?.status==='scanning')continue;
      let online=true;try{await this.index.policy.root(s.mount.absolutePath);}catch{online=false;}
      const wasOnline=this.index.states.get(s.mount.id)?.status==='online';
      if(online!==wasOnline){
        if(online){await s.watcher.close();if(s.closed)continue;this.startMount(s.mount);s.closed=true;clearTimeout(s.timer);const fresh=this.sessions.get(s.mount.id)!;fresh.paths.add('');await this.flush(fresh);}
        else{s.paths.add('');await this.flush(s);}
      }
    }}finally{this.recovering=false;}
  }
  async close(){this.stopped=true;clearInterval(this.interval);for(const s of this.sessions.values()){s.closed=true;clearTimeout(s.timer);this.index.remove(s.mount.id);}await this.queue;await Promise.all([...this.sessions.values()].map(s=>s.watcher.close()));this.sessions.clear();await Promise.all([...this.scans]);}
}
