import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import type { Entry, Mount, MountState } from '../shared/model.js';
import { Registry } from './registry.js';
import { PathPolicy, hidden, inside } from './path-policy.js';
export const entryId = (mountId: string, key: string) => createHash('sha256').update(`${mountId}\0${key}`).digest('hex').slice(0,32);
const readable = /\.(html?|md|markdown|csv)$/i;
const join = (...parts: string[]) => parts.filter(Boolean).join('/');
export class Indexer {
  entries = new Map<string, Entry[]>();
  states = new Map<string, MountState>();
  private generations = new Map<string, number>();
  private titleCache = new Map<string,{signature:string;title:string}>();
  constructor(public registry: Registry, public policy: PathPolicy) {}
  remove(id: string) { this.generations.set(id,(this.generations.get(id)||0)+1); this.entries.delete(id); this.states.delete(id);for(const key of this.titleCache.keys())if(key.startsWith(`${id}:`))this.titleCache.delete(key); }
  async scan(mount: Mount) {
    if(JSON.stringify(this.registry.data.mounts.find(m=>m.id===mount.id))!==JSON.stringify(mount)) return false;
    const generation = (this.generations.get(mount.id)||0)+1; this.generations.set(mount.id,generation);
    const result: Entry[] = []; const nextTitles = new Map<string,{signature:string;title:string}>();
    this.states.set(mount.id,{ status: mount.enabled ? 'scanning' : 'disabled' });
    const add = async (rel: string, toolRoot?: string, status: Entry['status'] = 'ready', candidates?: string[], scannedFile?:{real:string;stat:Stats}) => {
      const format = path.extname(rel).slice(1).toLowerCase();
      const id = entryId(mount.id, toolRoot === undefined ? rel : `tool:${toolRoot}`);
      let title = path.basename(rel) === 'index.html' ? path.posix.basename(toolRoot || path.posix.dirname(rel)) || mount.label : path.posix.basename(rel);
      let updatedAt = 0;
      if (status === 'ready') {
        try {
          const file = scannedFile || await this.policy.resolve(mount,rel); updatedAt = file.stat.mtimeMs;
          const signature=`${file.real}:${file.stat.mtimeMs}:${file.stat.ctimeMs}:${file.stat.size}`;const cached=this.titleCache.get(`${mount.id}:${id}`);
          if(cached?.signature===signature)title=cached.title;
          else if (/^html?$/.test(format)) { const handle = await fs.open(file.real,'r'); try { const buf = Buffer.alloc(32768); const {bytesRead} = await handle.read(buf,0,buf.length,0); const raw = buf.subarray(0,bytesRead).toString('utf8').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]; if(raw) title=raw.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim().slice(0,200); } finally { await handle.close(); } }
          nextTitles.set(`${mount.id}:${id}`,{signature,title});
        } catch { return; }
      } else { title = path.posix.basename(toolRoot || '') || mount.label; }
      const kind: Entry['kind'] = toolRoot !== undefined ? 'tool' : /^html?$/.test(format) ? 'html' : /^(md|markdown)$/.test(format) ? 'markdown' : /^(csv|json)$/.test(format) ? 'data' : 'text';
      const prefs = this.registry.data.entryPreferences[id] || {};
      result.push({id,projectId:mount.projectId,mountId:mount.id,title,kind,format,relativePath:rel,...(toolRoot!==undefined?{toolRoot}:{}),resourceRoot:path.posix.dirname(rel)==='.'?'':path.posix.dirname(rel),updatedAt,refreshMode:kind==='tool'?'prompt':'auto',status,candidates,...prefs});
    };
    const exists = async (rel: string, internal = false) => { try { return (await this.policy.resolve(mount,rel,internal)).stat.isFile(); } catch { return false; } };
    const dirs = async (rel: string) => {
      const dir = await this.policy.resolve(mount,rel);
      return (await fs.readdir(dir.real,{withFileTypes:true})).filter(d => !d.isSymbolicLink() && !hidden(join(rel,d.name),mount.excludes,true) && !inside(this.policy.stateDir,path.join(dir.real,d.name)));
    };
    const tool = async (root: string) => {
      const override = this.registry.data.toolOverrides.find(o=>o.mountId===mount.id && o.toolRoot===root);
      const candidates = (await Promise.all(['dist/index.html','build/index.html'].map(async p => await exists(join(root,p)) ? join(root,p) : null))).filter((p):p is string=>!!p);
      if (override) { const rel=join(root,override.entry); await add(rel,root,await exists(rel)?'ready':'pending-build'); return true; }
      if (candidates.length > 1) { await add('',root,'choose-entry',candidates); return true; }
      if (candidates.length === 1) { await add(candidates[0],root); return true; }
      if (await exists(join(root,'package.json'),true)) { await add('',root,'pending-build'); return true; }
      if (await exists(join(root,'index.html'))) { await add(join(root,'index.html'),root); return true; }
      return false;
    };
    const library = async (root: string, container = true): Promise<void> => {
      if (!container && await tool(root)) return;
      for (const d of await dirs(root)) { const rel=join(root,d.name); if(d.isDirectory()) await library(rel,false); else if(/\.html?$/i.test(d.name)) await add(rel,rel); }
    };
    const content = async (root: string): Promise<void> => {
      if(mount.toolDirectories.includes(root)) { await library(root); return; }
      // The parent was authorized by dirs(); verify each regular file's real path and
      // lstat here, avoiding re-walking every ancestor for every unchanged title.
      for (const d of await dirs(root)) { const rel=join(root,d.name); if(d.isDirectory()) await content(rel); else if(readable.test(d.name) && !hidden(rel,mount.excludes)){
        try{const absolute=path.join(mount.absolutePath,rel);const stat=await fs.lstat(absolute);if(stat.isSymbolicLink()||!stat.isFile())continue;const real=await fs.realpath(absolute);if(!inside(mount.absolutePath,real)||inside(this.policy.stateDir,real))continue;await add(rel,undefined,'ready',undefined,{real,stat});}catch{/* file removed during traversal */}
      } }
    };
    let state: MountState = {status:mount.enabled?'online':'disabled'};
    if(mount.enabled) try {
      await this.policy.root(mount.absolutePath);
      if(mount.mode==='single-tool') { const override=this.registry.data.toolOverrides.find(o=>o.mountId===mount.id&&o.toolRoot===''); const rel=override?.entry || mount.entry; await add(rel,'',await exists(rel)?'ready':'pending-build'); }
      else if(mount.mode==='tool-library') await library(''); else await content('');
    } catch(e) { state={status:'offline',error:(e as Error).message}; }
    if(this.generations.get(mount.id)!==generation || JSON.stringify(this.registry.data.mounts.find(m=>m.id===mount.id))!==JSON.stringify(mount)) return false;
    for(const entry of result)Object.assign(entry,this.registry.data.entryPreferences[entry.id]||{});
    this.entries.set(mount.id,result); this.states.set(mount.id,state);
    for(const key of this.titleCache.keys())if(key.startsWith(`${mount.id}:`))this.titleCache.delete(key);
    for(const [key,value] of nextTitles)this.titleCache.set(key,value);
    return true;
  }
  all() { return [...this.entries.values()].flat(); }
  async sync() { for(const id of this.entries.keys()) if(!this.registry.data.mounts.some(m=>m.id===id)) this.remove(id); await Promise.all(this.registry.data.mounts.map(m=>this.scan(m))); }
}
