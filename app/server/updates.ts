import fs from 'node:fs/promises';
import { watch, type FSWatcher, type Stats } from 'node:fs';
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
const watchEventLimit=1024;
const watchRetryMs=30_000;
type DirectoryWatch = {mountId:string;rel:string;identity:string;watcher:FSWatcher};
type WatchRecovery = {mountId:string;rel:string;message:string;timer:ReturnType<typeof setTimeout>};

/** One shared service. Only directory metadata is indexed; document contents are never read. */
export class FileUpdates {
  private state:State = {schemaVersion:1,filter:defaultFileTypeFilter,sequence:0,mounts:{},records:{}};
  private initialized=false;
  private closed=false;
  private corrupt=false;
  private queue:Promise<unknown>=Promise.resolve();
  private watchers=new Map<string,DirectoryWatch>();
  private recovering=new Map<string,WatchRecovery>();
  private pending=new Map<string,Set<string>>();
  private debounce?:ReturnType<typeof setTimeout>;
  private interval?:ReturnType<typeof setInterval>;
  private errors=new Map<string,string>();
  private jobs=0;
  private dirty=false;
  private unread=new Set<string>();
  private directoryRecords=new Map<string,Set<string>>();
  private syncPending=false;
  private syncRunning=false;
  private syncAgain=false;
  constructor(private directory:string,private policy:PathPolicy,private mounts:()=>Mount[],private emit:()=>void) {}
  private get file(){return path.join(this.directory,'file-updates.json');}
  async load(){
    try{this.state=stateSchema.parse(JSON.parse(await fs.readFile(this.file,'utf8')));for(const [id,record] of Object.entries(this.state.records))this.indexRecord(id,record);this.initialized=true;}
    catch(e){if(!missing(e)){this.corrupt=true;this.errors.set('storage','更新记录无法读取，原文件已保留；请检查 file-updates.json。');}}
    if(this.initialized)this.scheduleSync();
    this.interval=setInterval(()=>{if(this.initialized)this.scheduleSync();},5*60_000);this.interval.unref();
  }
  snapshot():UpdatesSnapshot {
    const mounts=new Map(this.mounts().filter(m=>m.enabled).map(m=>[m.id,m]));
    const items=[...this.unread].map(id=>[id,this.state.records[id]] as const).filter(([,r])=>{
      const m=mounts.get(r.mountId);return m&&this.state.mounts[m.id]?.mount.absolutePath===m.absolutePath&&r.active&&r.version!==r.readVersion&&!hidden(r.relativePath,m.excludes)&&fileTypeVisible(path.posix.basename(r.relativePath),this.state.filter);
    }).map(([id,r])=>({id,mountId:r.mountId,relativePath:r.relativePath,version:r.version,kind:r.kind,changedAt:r.changedAt,sequence:r.sequence})).sort((a,b)=>b.sequence-a.sequence||a.id.localeCompare(b.id));
    return {initialized:this.initialized,filter:this.state.filter,items:items.slice(0,200),total:items.length,through:this.state.sequence,busy:this.jobs>0,errors:[...new Set([...this.errors.values(),...[...this.recovering.values()].map(r=>r.message)])]};
  }
  private enqueue<T>(task:()=>Promise<T>):Promise<T|undefined>{
    if(this.closed)return Promise.resolve(undefined);
    this.jobs++;if(this.jobs===1)this.emit();
    const job=this.queue.then(task).then(async result=>{await this.save();return result;});
    this.queue=job.catch(e=>{this.errors.set('operation',`更新检测失败：${(e as Error).message}`);}).finally(()=>{this.jobs--;if(this.jobs===0)this.emit();});
    return job;
  }
  private async save(){
    if(!this.initialized||this.corrupt||!this.dirty)return;
    const bytes=JSON.stringify(this.state);
    try{await fs.writeFile(`${this.file}.tmp`,bytes);await fs.rename(`${this.file}.tmp`,this.file);this.dirty=false;this.errors.delete('storage');}
    catch(e){this.errors.set('storage','更新记录保存失败，重启后可能丢失本次未读状态。');throw e;}
  }
  async configure(filter:FileTypeFilter,initializeOnly=false){
    if(this.corrupt)throw new Error('更新记录损坏，请先恢复 file-updates.json');
    await this.enqueue(async()=>{
      if(initializeOnly&&this.initialized)return;
      if(!this.initialized||JSON.stringify(this.state.filter)!==JSON.stringify(filter))this.dirty=true;
      this.state.filter=structuredClone(filter);this.initialized=true;
      // Save the preference before a potentially long baseline pass.
      await this.save();await this.sync();
    });
    return this.snapshot();
  }
  scheduleSync(){
    if(!this.initialized||this.closed)return;
    if(this.syncPending){if(this.syncRunning)this.syncAgain=true;return;}
    this.syncPending=true;
    void this.enqueue(async()=>{this.syncRunning=true;await this.sync();}).catch(()=>{}).finally(()=>{
      this.syncPending=false;this.syncRunning=false;
      if(this.syncAgain){this.syncAgain=false;this.scheduleSync();}
    });
  }
  async reconcile(){await this.enqueue(()=>this.sync());}
  private parentKeys(record:State['records'][string]){
    const parts=record.relativePath.split('/');
    return parts.map((_,index)=>fileReference(record.mountId,parts.slice(0,index).join('/')));
  }
  private indexRecord(id:string,record:State['records'][string]){
    for(const key of this.parentKeys(record)){
      const ids=this.directoryRecords.get(key)||new Set<string>();ids.add(id);this.directoryRecords.set(key,ids);
    }
    this.updateUnread(id,record);
  }
  private updateUnread(id:string,record:State['records'][string]){
    if(record.active&&record.version!==record.readVersion)this.unread.add(id);else this.unread.delete(id);
  }
  private scopedRecords(mountId:string,scope=''){
    const key=fileReference(mountId,scope);
    const ids=[...this.directoryRecords.get(key)||[]];
    if(this.state.records[key])ids.push(key);
    return ids.map(id=>[id,this.state.records[id]] as const);
  }
  private removeRecord(id:string){
    const record=this.state.records[id];if(!record)return;
    for(const key of this.parentKeys(record)){
      const ids=this.directoryRecords.get(key);ids?.delete(id);if(!ids?.size)this.directoryRecords.delete(key);
    }
    this.unread.delete(id);delete this.state.records[id];this.dirty=true;
  }
  private deactivate(id:string,record:State['records'][string]){
    if(record.active){record.active=false;this.dirty=true;}
    this.unread.delete(id);
  }
  private rememberMount(mount:Mount){
    const value={mount:structuredClone(mount),filter:structuredClone(this.state.filter)};
    if(JSON.stringify(this.state.mounts[mount.id])!==JSON.stringify(value)){this.state.mounts[mount.id]=value;this.dirty=true;}
  }
  private dropWatchers(mountId:string,scope='',cancelRecovery=false){
    for(const [key,w] of this.watchers)if(w.mountId===mountId&&under(w.rel,scope)){this.watchers.delete(key);w.watcher.close();}
    if(cancelRecovery)for(const [key,r] of this.recovering)if(r.mountId===mountId&&under(r.rel,scope)){clearTimeout(r.timer);this.recovering.delete(key);}
  }
  private recoverWatch(m:Mount,rel:string){
    // Close synchronously: filtering or debouncing callbacks cannot stop a native
    // Windows watcher that repeatedly reports a deleted directory's absolute path.
    this.dropWatchers(m.id,rel,true);
    const key=fileReference(m.id,rel);
    const timer=setTimeout(()=>{
      this.recovering.delete(key);
      const current=this.mounts().find(item=>item.id===m.id&&item.enabled);
      if(!this.closed&&current?.absolutePath===m.absolutePath&&!hidden(rel,current.excludes))this.changed(m.id,rel);
      this.emit();
    },watchRetryMs);
    timer.unref();
    this.recovering.set(key,{mountId:m.id,rel,timer,message:`${m.label}：目录监听异常，已暂停该目录的监听；30 秒后重试，期间保留后台核对。`});
    this.changed(m.id,rel);this.emit();
  }
  private listen(m:Mount,rel:string,real:string,stat:Stats){
    if(this.closed||[...this.recovering.values()].some(r=>r.mountId===m.id&&under(rel,r.rel)))return;
    const key=fileReference(m.id,rel),identity=`${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
    const previous=this.watchers.get(key);
    if(previous?.identity===identity)return;
    if(previous)this.dropWatchers(m.id,rel);
    try{
      let entry:DirectoryWatch;
      let windowStart=Date.now(),events=0;
      const watcher=watch(real,(_event,name)=>{
        // Already queued callbacks/errors must not retire a replacement watcher.
        if(this.closed||this.watchers.get(key)!==entry)return;
        const current=this.mounts().find(item=>item.id===m.id&&item.enabled);
        if(!current||current.absolutePath!==m.absolutePath||hidden(rel,current.excludes)){this.dropWatchers(m.id,rel,true);return;}
        const now=Date.now();if(now-windowStart>=1000){windowStart=now;events=0;}
        if(++events>watchEventLimit){this.recoverWatch(m,rel);return;}
        const child=name?String(name).split(path.sep).join('/'):'';
        const target=[rel,child].filter(Boolean).join('/');
        try{
          // Do not resolve event-supplied absolute/invalid names or keep their
          // watcher alive. Reconcile only the original, authorized scope.
          relative(child);relative(target);
          if(!child&&_event==='rename'){this.recoverWatch(m,rel);return;}
          if(hidden(target,current.excludes))return;
        }catch{this.recoverWatch(m,rel);return;}
        this.changed(m.id,target);
      });
      entry={mountId:m.id,rel,identity,watcher};
      this.watchers.set(key,entry);
      watcher.unref();watcher.on('error',()=>{if(!this.closed&&this.watchers.get(key)===entry)this.recoverWatch(m,rel);});
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
    if(old)this.updateUnread(id,this.state.records[id]);else this.indexRecord(id,this.state.records[id]);
    this.dirty=true;
  }
  private async scan(m:Mount,scope:string,baseline:(rel:string)=>boolean):Promise<boolean>{
    const seen=new Set<string>(),directories=new Set<string>(),failed:string[]=[];
    const visit=async(rel:string):Promise<void>=>{
      if(this.closed)return;
      if(hidden(rel,m.excludes))return;
      try{
        const item=await this.policy.resolve(m,rel,false,'file');
        if(item.stat.isDirectory()){
          directories.add(rel);this.listen(m,rel,item.real,item.stat);
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
    // A successful parent enumeration may no longer contain a formerly watched
    // child, so visiting only existing entries is insufficient to retire it.
    for(const w of this.watchers.values()){
      if(w.mountId===m.id&&under(w.rel,scope)&&!directories.has(w.rel)&&!failed.some(p=>under(w.rel,p)))this.dropWatchers(m.id,w.rel);
    }
    for(const [id,r] of this.scopedRecords(m.id,scope)){
      if(failed.some(p=>under(r.relativePath,p)))continue;
      if(hidden(r.relativePath,m.excludes)||!fileTypeVisible(path.posix.basename(r.relativePath),this.state.filter)){this.deactivate(id,r);continue;}
      if(!seen.has(id))this.removeRecord(id);
    }
    return failed.length===0;
  }
  private async sync(){
    if(!this.initialized)return;
    this.errors.delete('operation');
    const mounts=this.mounts();
    for(const id of this.errors.keys())if(!['operation','storage'].includes(id)&&!mounts.some(m=>m.id===id))this.errors.delete(id);
    for(const w of [...this.watchers.values(),...this.recovering.values()])if(!mounts.some(m=>m.id===w.mountId))this.dropWatchers(w.mountId,'',true);
    for(const id of Object.keys(this.state.mounts))if(!mounts.some(m=>m.id===id)){
      this.dropWatchers(id,'',true);delete this.state.mounts[id];this.errors.delete(id);this.dirty=true;
      for(const [key] of this.scopedRecords(id))this.removeRecord(key);
    }
    for(const m of mounts){
      if(this.closed)return;
      const previous=this.state.mounts[m.id];
      const moved=previous&&previous.mount.absolutePath!==m.absolutePath;
      if(moved){this.dropWatchers(m.id,'',true);for(const [id] of this.scopedRecords(m.id))this.removeRecord(id);}
      if(!m.enabled){this.dropWatchers(m.id,'',true);for(const [id,r] of this.scopedRecords(m.id))this.deactivate(id,r);this.rememberMount(m);continue;}
      for(const w of [...this.watchers.values(),...this.recovering.values()])if(w.mountId===m.id&&hidden(w.rel,m.excludes))this.dropWatchers(m.id,w.rel,true);
      this.errors.delete(m.id);
      const baseline=(rel:string)=>!previous||!!moved||!previous.mount.enabled||hidden(rel,previous.mount.excludes)||!fileTypeVisible(path.posix.basename(rel),previous.filter);
      if(await this.scan(m,'',baseline))this.rememberMount(m);
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
      const records=input.id!==undefined?(this.state.records[input.id]?[[input.id,this.state.records[input.id]] as const]:[]):Object.entries(this.state.records);
      for(const [id,r] of records){
        const m=this.mounts().find(m=>m.id===r.mountId&&m.enabled);
        if(!m||!r.active||hidden(r.relativePath,m.excludes)||!fileTypeVisible(path.posix.basename(r.relativePath),this.state.filter))continue;
        if(input.id!==undefined?input.id===id&&input.version===r.version:input.through!==undefined&&r.sequence<=input.through){
          if(r.readVersion!==r.version){r.readVersion=r.version;this.dirty=true;}
          this.updateUnread(id,r);
        }
      }
    });
    return this.snapshot();
  }
  async close(){
    this.closed=true;clearTimeout(this.debounce);clearInterval(this.interval);
    for(const r of this.recovering.values())clearTimeout(r.timer);this.recovering.clear();
    for(const w of this.watchers.values())w.watcher.close();this.watchers.clear();
    await this.queue;
  }
}
