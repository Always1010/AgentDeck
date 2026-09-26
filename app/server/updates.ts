import fs from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { defaultFileTypeFilter, fileTypeVisible, isFileTypeFilter, type FileTypeFilter } from '../shared/file-types.js';
import { fileVersion, type UpdatesSnapshot } from '../shared/updates.js';
import { fileReference, mountSchema, type Mount } from '../shared/model.js';
import { hidden, PathPolicy, relative } from './path-policy.js';

export const filterSchema = z.custom<FileTypeFilter>(isFileTypeFilter);
const recordSchema = z.object({ mountId:z.string(), relativePath:z.string(), version:z.string(), readVersion:z.string(), active:z.boolean(), kind:z.enum(['added','modified']), changedAt:z.number(), sequence:z.number() });
const stateSchema = z.object({ schemaVersion:z.literal(1), filter:filterSchema, sequence:z.number().int().nonnegative(), mounts:z.record(z.string(),z.object({mount:mountSchema,filter:filterSchema})), records:z.record(z.string(),recordSchema) });
type State = z.infer<typeof stateSchema>;
const under = (name:string, root:string) => !root || name===root || name.startsWith(`${root}/`);
const missing = (e:unknown) => ['ENOENT','ENOTDIR'].includes((e as NodeJS.ErrnoException).code || '');

/** One shared service. Only directory metadata is indexed; document contents are never read. */
export class FileUpdates {
  private state:State = {schemaVersion:1,filter:defaultFileTypeFilter,sequence:0,mounts:{},records:{}};
  private initialized=false;
  private closed=false;
  private corrupt=false;
  private queue:Promise<unknown>=Promise.resolve();
  private watchers=new Map<string,{mountId:string;rel:string;watcher:FSWatcher}>();
  private pending=new Map<string,Set<string>>();
  private debounce?:ReturnType<typeof setTimeout>;
  private interval?:ReturnType<typeof setInterval>;
  private errors=new Map<string,string>();
  private jobs=0;
  private saved='';
  constructor(private directory:string,private policy:PathPolicy,private mounts:()=>Mount[],private emit:()=>void) {}
  private get file(){return path.join(this.directory,'file-updates.json');}
  async load(){
    try{this.state=stateSchema.parse(JSON.parse(await fs.readFile(this.file,'utf8')));this.saved=JSON.stringify(this.state);this.initialized=true;}
    catch(e){if(!missing(e)){this.corrupt=true;this.errors.set('storage','更新记录无法读取，原文件已保留；请检查 file-updates.json。');}}
    if(this.initialized)this.scheduleSync();
    this.interval=setInterval(()=>{if(this.initialized)this.scheduleSync();},5*60_000);this.interval.unref();
  }
  snapshot():UpdatesSnapshot {
    const mounts=new Map(this.mounts().filter(m=>m.enabled).map(m=>[m.id,m]));
    const items=Object.entries(this.state.records).filter(([,r])=>{
      const m=mounts.get(r.mountId);return m&&this.state.mounts[m.id]?.mount.absolutePath===m.absolutePath&&r.active&&r.version!==r.readVersion&&!hidden(r.relativePath,m.excludes)&&fileTypeVisible(path.posix.basename(r.relativePath),this.state.filter);
    }).map(([id,r])=>({id,mountId:r.mountId,relativePath:r.relativePath,version:r.version,kind:r.kind,changedAt:r.changedAt,sequence:r.sequence})).sort((a,b)=>b.sequence-a.sequence||a.id.localeCompare(b.id));
    return {initialized:this.initialized,filter:this.state.filter,items:items.slice(0,200),total:items.length,through:this.state.sequence,busy:this.jobs>0,errors:[...this.errors.values()]};
  }
  private enqueue<T>(task:()=>Promise<T>):Promise<T|undefined>{
    if(this.closed)return Promise.resolve(undefined);
    this.jobs++;this.emit();
    const job=this.queue.then(task).then(async result=>{await this.save();return result;});
    this.queue=job.catch(e=>{this.errors.set('operation',`更新检测失败：${(e as Error).message}`);}).finally(()=>{this.jobs--;this.emit();});
    return job;
  }
  private async save(){
    if(!this.initialized||this.corrupt)return;
    const bytes=JSON.stringify(this.state);if(bytes===this.saved)return;
    try{await fs.writeFile(`${this.file}.tmp`,bytes);await fs.rename(`${this.file}.tmp`,this.file);this.saved=bytes;this.errors.delete('storage');}
    catch(e){this.errors.set('storage','更新记录保存失败，重启后可能丢失本次未读状态。');throw e;}
  }
  async configure(filter:FileTypeFilter,initializeOnly=false){
    if(this.corrupt)throw new Error('更新记录损坏，请先恢复 file-updates.json');
    await this.enqueue(async()=>{
      if(initializeOnly&&this.initialized)return;
      this.state.filter=structuredClone(filter);this.initialized=true;
      // Save the preference before a potentially long baseline pass.
      await this.save();await this.sync();
    });
    return this.snapshot();
  }
  scheduleSync(){if(this.initialized&&!this.closed)void this.enqueue(()=>this.sync()).catch(()=>{});}
  async reconcile(){await this.enqueue(()=>this.sync());}
  private dropWatchers(mountId:string,scope=''){
    for(const [key,w] of this.watchers)if(w.mountId===mountId&&under(w.rel,scope)){w.watcher.close();this.watchers.delete(key);}
  }
  private listen(m:Mount,rel:string,real:string){
    const key=fileReference(m.id,rel);if(this.watchers.has(key)||this.closed)return;
    try{
      const watcher=watch(real,(_event,name)=>{
        const child=name?String(name).split(path.sep).join('/'):'';
        const target=[rel,child].filter(Boolean).join('/');
        const current=this.mounts().find(item=>item.id===m.id&&item.enabled);
        try{relative(target);if(!current||hidden(target,current.excludes))return;}catch{return;}
        this.changed(m.id,target);
      });
      watcher.unref();watcher.on('error',()=>{watcher.close();this.watchers.delete(key);this.errors.set(m.id,`${m.label}：监听中断，将在后台核对时重试。`);this.emit();});
      this.watchers.set(key,{mountId:m.id,rel,watcher});
    }catch{this.errors.set(m.id,`${m.label}：实时监听不可用，暂由后台定期核对。`);}
  }
  private changed(mountId:string,rel:string){
    if(this.closed)return;
    const paths=this.pending.get(mountId)||new Set<string>();
    if(![...paths].some(p=>under(rel,p))){for(const p of paths)if(under(p,rel))paths.delete(p);paths.add(rel);}
    if(paths.size>1000){paths.clear();paths.add('');}
    this.pending.set(mountId,paths);
    if(!this.debounce)this.debounce=setTimeout(()=>{
      this.debounce=undefined;const pending=this.pending;this.pending=new Map();
      void this.enqueue(async()=>{
        for(const [id,paths] of pending){const m=this.mounts().find(m=>m.id===id&&m.enabled);if(!m||this.state.mounts[id]?.mount.absolutePath!==m.absolutePath)continue;
          for(const rel of paths)await this.scan(m,rel,()=>false);
        }
      }).catch(()=>{});
    },650);
  }
  private observe(m:Mount,rel:string,version:string,baseline:boolean){
    const id=fileReference(m.id,rel),old=this.state.records[id];
    if(old?.active&&old.version===version)return;
    const unread=old&&old.version!==old.readVersion;
    const silent=baseline||!!old&&!old.active;
    const sequence=silent?old?.sequence||0:++this.state.sequence;
    this.state.records[id]={mountId:m.id,relativePath:rel,version,readVersion:silent&&!unread?version:old?.readVersion||'',active:true,
      kind:unread?old.kind:old?'modified':'added',changedAt:silent?old?.changedAt||0:Date.now(),sequence};
  }
  private async scan(m:Mount,scope:string,baseline:(rel:string)=>boolean):Promise<boolean>{
    const seen=new Set<string>(),failed:string[]=[];
    const visit=async(rel:string):Promise<void>=>{
      if(this.closed)return;
      if(hidden(rel,m.excludes))return;
      try{
        const item=await this.policy.resolve(m,rel,false,'file');
        if(item.stat.isDirectory()){
          this.listen(m,rel,item.real);
          for(const d of await fs.readdir(item.real,{withFileTypes:true})){
            if(d.isSymbolicLink())continue;
            const child=[rel,d.name].filter(Boolean).join('/');
            if(hidden(child,m.excludes)||(!d.isDirectory()&&!fileTypeVisible(d.name,this.state.filter)))continue;
            await visit(child);
          }
        }else if(fileTypeVisible(path.posix.basename(rel),this.state.filter)){
          seen.add(fileReference(m.id,rel));this.observe(m,rel,fileVersion(item.stat),baseline(rel));
        }
      }catch(e){
        const code=(e as {code?:string}).code;
        if(missing(e)||code==='FORBIDDEN_PATH'||code==='FORBIDDEN_FILE')this.dropWatchers(m.id,rel);
        else{failed.push(rel);this.errors.set(m.id,`${m.label}：部分目录无法检查，保留原有未读记录。`);}
      }
    };
    await visit(scope);
    if(this.closed)return false;
    for(const [id,r] of Object.entries(this.state.records)){
      if(r.mountId!==m.id||!under(r.relativePath,scope)||failed.some(p=>under(r.relativePath,p)))continue;
      if(hidden(r.relativePath,m.excludes)||!fileTypeVisible(path.posix.basename(r.relativePath),this.state.filter)){r.active=false;continue;}
      if(!seen.has(id))delete this.state.records[id];
    }
    return failed.length===0;
  }
  private async sync(){
    if(!this.initialized)return;
    this.errors.delete('operation');
    const mounts=this.mounts();
    for(const id of this.errors.keys())if(!['operation','storage'].includes(id)&&!mounts.some(m=>m.id===id))this.errors.delete(id);
    for(const w of this.watchers.values())if(!mounts.some(m=>m.id===w.mountId))this.dropWatchers(w.mountId);
    for(const id of Object.keys(this.state.mounts))if(!mounts.some(m=>m.id===id)){
      this.dropWatchers(id);delete this.state.mounts[id];this.errors.delete(id);
      for(const [key,r] of Object.entries(this.state.records))if(r.mountId===id)delete this.state.records[key];
    }
    for(const m of mounts){
      if(this.closed)return;
      const previous=this.state.mounts[m.id];
      const moved=previous&&previous.mount.absolutePath!==m.absolutePath;
      if(moved){this.dropWatchers(m.id);for(const [id,r] of Object.entries(this.state.records))if(r.mountId===m.id)delete this.state.records[id];}
      if(!m.enabled){this.dropWatchers(m.id);for(const r of Object.values(this.state.records))if(r.mountId===m.id)r.active=false;this.state.mounts[m.id]={mount:structuredClone(m),filter:structuredClone(this.state.filter)};continue;}
      for(const [,w] of this.watchers)if(w.mountId===m.id&&hidden(w.rel,m.excludes))this.dropWatchers(m.id,w.rel);
      this.errors.delete(m.id);
      const baseline=(rel:string)=>!previous||!!moved||!previous.mount.enabled||hidden(rel,previous.mount.excludes)||!fileTypeVisible(path.posix.basename(rel),previous.filter);
      if(await this.scan(m,'',baseline))this.state.mounts[m.id]={mount:structuredClone(m),filter:structuredClone(this.state.filter)};
    }
  }
  async acknowledge(input:{id?:string;version?:string;through?:number}){
    await this.enqueue(async()=>{
      // A reader can finish before the debounced watcher event is processed.
      // Observe that specific file first, then acknowledge only its exact loaded version.
      if(input.id!==undefined){
        const match=/^file:([^:]+):(.+)$/.exec(input.id);
        const m=match&&this.mounts().find(m=>m.id===match[1]&&m.enabled);
        if(m&&match&&!hidden(match[2],m.excludes)&&fileTypeVisible(path.posix.basename(match[2]),this.state.filter)){
          relative(match[2],false);await this.scan(m,match[2],()=>!this.state.mounts[m.id]);
        }
      }
      for(const [id,r] of Object.entries(this.state.records)){
        const m=this.mounts().find(m=>m.id===r.mountId&&m.enabled);
        if(!m||!r.active||hidden(r.relativePath,m.excludes)||!fileTypeVisible(path.posix.basename(r.relativePath),this.state.filter))continue;
        if(input.id!==undefined?input.id===id&&input.version===r.version:input.through!==undefined&&r.sequence<=input.through)r.readVersion=r.version;
      }
    });
    return this.snapshot();
  }
  async close(){
    this.closed=true;clearTimeout(this.debounce);clearInterval(this.interval);
    for(const w of this.watchers.values())w.watcher.close();this.watchers.clear();
    await this.queue;
  }
}
