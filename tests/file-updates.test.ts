import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createWorkbench, type Workbench } from '../app/server/server.js';
import { fileReference } from '../app/shared/model.js';
let temp:string,root:string,app:Workbench,id:string;
const headers={host:'127.0.0.1:4310','sec-fetch-site':'same-origin',origin:'http://127.0.0.1:4310','x-workbench':'1','content-type':'application/json'};
const filter={mode:'allow' as const,extensions:['.md'],custom:[]};
const options=()=>({stateDir:path.join(temp,'state'),port:4310,previewPort:4311});
beforeEach(async()=>{
  temp=await fs.mkdtemp(path.join(os.tmpdir(),'agentdeck-updates-'));root=path.join(temp,'project');
  await fs.mkdir(path.join(root,'nested'),{recursive:true});await fs.writeFile(path.join(root,'nested','old.md'),'old');
  app=await createWorkbench(options());await app.main.inject({method:'POST',url:'/api/projects',headers,payload:{name:'测试',mount:{label:'资料',absolutePath:root}}});id=app.registry.data.mounts[0].id;
});
afterEach(async()=>{vi.restoreAllMocks();await app.close();await fs.rm(temp,{recursive:true,force:true});});
test('baseline excludes history; native events discover unopened directories and coalesce repeated writes without reading content',async()=>{
  const read=vi.spyOn(fs,'readFile');await app.updates.configure(filter);expect(app.updates.snapshot().total).toBe(0);
  await fs.mkdir(path.join(root,'new'));await fs.writeFile(path.join(root,'new','report.md'),'a');await fs.writeFile(path.join(root,'new','report.md'),'latest report');await fs.writeFile(path.join(root,'ignore.txt'),'text');
  await expect.poll(()=>app.updates.snapshot().total,{timeout:7000}).toBe(1);
  expect(app.updates.snapshot().items[0]).toMatchObject({relativePath:'new/report.md',kind:'added'});
  expect(read.mock.calls.some(([file])=>String(file).startsWith(root))).toBe(false);
  await fs.writeFile(path.join(root,'nested','old.md'),'changed text');
  await expect.poll(()=>app.updates.snapshot().items.some(x=>x.kind==='modified'&&x.relativePath==='nested/old.md'),{timeout:7000}).toBe(true);
});
test('read acknowledgements only consume observed versions and bulk acknowledgements preserve later changes',async()=>{
  await app.updates.configure(filter);await fs.writeFile(path.join(root,'nested','old.md'),'first edit');await app.updates.reconcile();const first=app.updates.snapshot();
  await fs.writeFile(path.join(root,'nested','old.md'),'second longer edit');await app.updates.reconcile();
  await app.updates.acknowledge({id:first.items[0].id,version:first.items[0].version});expect(app.updates.snapshot().total).toBe(1);
  await app.updates.acknowledge({through:first.through});expect(app.updates.snapshot().total).toBe(1);
  const current=app.updates.snapshot().items[0];await app.updates.acknowledge({id:current.id,version:current.version});expect(app.updates.snapshot().total).toBe(0);
  await fs.writeFile(path.join(root,'fresh.md'),'new');await app.updates.reconcile();expect(app.updates.snapshot().items[0].kind).toBe('added');
  await fs.writeFile(path.join(root,'fresh.md'),'new again');await app.updates.reconcile();expect(app.updates.snapshot().items[0].kind).toBe('added');
});
test('filter expansion establishes baseline, excluded periods are not replayed, existing unread survives',async()=>{
  await fs.writeFile(path.join(root,'historical.txt'),'text');await app.updates.configure(filter);
  await fs.writeFile(path.join(root,'nested','old.md'),'unread');await app.updates.reconcile();
  await app.updates.configure({mode:'allow',extensions:['.txt'],custom:[]});expect(app.updates.snapshot().total).toBe(0);
  await fs.writeFile(path.join(root,'nested','old.md'),'excluded changes');await fs.writeFile(path.join(root,'untracked.md'),'excluded addition');
  await app.updates.configure(filter);expect(app.updates.snapshot().items.map(x=>x.relativePath)).toEqual(['nested/old.md']);
  const current=app.updates.snapshot().items[0];await app.updates.acknowledge({id:current.id,version:current.version});
  await app.updates.configure({mode:'deny',extensions:['.txt'],custom:[]});expect(app.updates.snapshot().total).toBe(0);
});
test('restart preserves unread and detects changes while service was stopped; deletes and renames reconcile',async()=>{
  await app.updates.configure(filter);await fs.writeFile(path.join(root,'one.md'),'new');await app.updates.reconcile();await app.close();
  await fs.writeFile(path.join(root,'two.md'),'offline addition');await fs.writeFile(path.join(root,'nested','old.md'),'offline edit');
  app=await createWorkbench(options());await app.updates.reconcile();expect(app.updates.snapshot().total).toBe(3);
  await fs.rename(path.join(root,'one.md'),path.join(root,'renamed.md'));await fs.unlink(path.join(root,'two.md'));await app.updates.reconcile();
  expect(app.updates.snapshot().items.map(x=>x.relativePath).sort()).toEqual(['nested/old.md','renamed.md']);
});
test('excluded trees and symlinks are not enumerated; disabled and removed mounts stop reporting',async()=>{
  await fs.mkdir(path.join(root,'node_modules'));await fs.writeFile(path.join(root,'node_modules','secret.md'),'hidden');
  const outside=path.join(temp,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'linked.md'),'not published');await fs.symlink(outside,path.join(root,'linked'),'junction');
  const read=vi.spyOn(fs,'readdir');await app.updates.configure(filter);expect(read.mock.calls.some(([p])=>String(p).includes('node_modules'))).toBe(false);
  expect(read.mock.calls.some(([p])=>String(p).includes('linked')||String(p)===outside)).toBe(false);
  await fs.writeFile(path.join(root,'one.md'),'new');await app.updates.reconcile();expect(app.updates.snapshot().total).toBe(1);
  await app.main.inject({method:'PATCH',url:`/api/mounts/${id}`,headers,payload:{enabled:false}});await app.updates.reconcile();expect(app.updates.snapshot().total).toBe(0);
  await fs.writeFile(path.join(root,'paused.md'),'new');await app.main.inject({method:'PATCH',url:`/api/mounts/${id}`,headers,payload:{enabled:true}});await app.updates.reconcile();expect(app.updates.snapshot().items.map(x=>x.relativePath)).toEqual(['one.md']);
  await app.main.inject({method:'DELETE',url:`/api/mounts/${id}`,headers,payload:{}});await app.updates.reconcile();expect(app.updates.snapshot().total).toBe(0);
});
test('API validates inputs, first-client migration does not overwrite shared filter, preview validates version',async()=>{
  expect((await app.main.inject({method:'PUT',url:'/api/file-updates/filter',headers,payload:{filter:{mode:'wrong'}}})).statusCode).toBe(400);
  expect((await app.main.inject({method:'POST',url:'/api/file-updates/read',headers,payload:{}})).statusCode).toBe(400);
  await app.updates.configure(filter);await app.updates.configure({mode:'all',extensions:[],custom:[]},true);expect(app.updates.snapshot().filter).toEqual(filter);
  await fs.writeFile(path.join(root,'page.html'),'<h1>test</h1>');
  const entry=(await app.main.inject({url:`/api/entries/${encodeURIComponent(fileReference(id,'page.html'))}`,headers})).json();
  const previewHeaders={host:'127.0.0.1:4311'};
  expect((await app.preview.inject({url:`/m/${id}/page.html?fileVersion=${encodeURIComponent(entry.fileVersion)}`,headers:previewHeaders})).statusCode).toBe(200);
  await fs.writeFile(path.join(root,'page.html'),'<h1>changed</h1>');
  expect((await app.preview.inject({url:`/m/${id}/page.html?fileVersion=${encodeURIComponent(entry.fileVersion)}`,headers:previewHeaders})).statusCode).toBe(409);
});
test('removing a mount that failed its first baseline clears its stale error',async()=>{
  await fs.rm(root,{recursive:true,force:true});await app.updates.configure(filter);
  expect(app.updates.snapshot().errors.length).toBeGreaterThan(0);
  await app.main.inject({method:'DELETE',url:`/api/mounts/${id}`,headers,payload:{}});await app.updates.reconcile();
  expect(app.updates.snapshot().errors).toEqual([]);
});
test('reading before watcher debounce consumes only that loaded version; unread is durable after restart',async()=>{
  await app.updates.configure(filter);await fs.writeFile(path.join(root,'fast.md'),'read immediately');
  const id=fileReference(app.registry.data.mounts[0].id,'fast.md');
  const file=(await app.main.inject({url:`/api/mounts/${app.registry.data.mounts[0].id}/file?path=fast.md`,headers})).json();
  await app.updates.acknowledge({id,version:file.fileVersion});await app.updates.reconcile();expect(app.updates.snapshot().total).toBe(0);
  await app.close();app=await createWorkbench(options());await app.updates.reconcile();expect(app.updates.snapshot().total).toBe(0);
});
test('corrupt update storage is preserved and reported without replacing it',async()=>{
  await app.close();const storage=path.join(temp,'state','file-updates.json');await fs.writeFile(storage,'broken');app=await createWorkbench(options());
  expect(app.updates.snapshot().errors.join(' ')).toContain('原文件已保留');await expect(app.updates.configure(filter)).rejects.toThrow('损坏');
  expect(await fs.readFile(storage,'utf8')).toBe('broken');
});
test('1000-file smoke: idle and a single modification do not enumerate directories; batches remain coalesced',async()=>{
  await Promise.all(Array.from({length:1000},(_,i)=>fs.writeFile(path.join(root,`report-${i}.md`),`report ${i}`)));
  const started=performance.now();await app.updates.configure(filter);const baselineMs=Math.round(performance.now()-started);
  // Windows may deliver directory notifications queued during the initial baseline.
  await new Promise(resolve=>setTimeout(resolve,1500));await expect.poll(()=>app.updates.snapshot().busy).toBe(false);
  const listing=vi.spyOn(fs,'readdir');await new Promise(resolve=>setTimeout(resolve,750));expect(listing).not.toHaveBeenCalled();
  const single=performance.now();await fs.writeFile(path.join(root,'report-0.md'),'changed report');
  await expect.poll(()=>app.updates.snapshot().total,{timeout:10000}).toBe(1);const singleMs=Math.round(performance.now()-single);expect(listing).not.toHaveBeenCalled();
  const batch=performance.now();await Promise.all(Array.from({length:100},(_,i)=>fs.writeFile(path.join(root,`batch-${i}.md`),`new ${i}`)));
  await expect.poll(()=>app.updates.snapshot().total,{timeout:10000}).toBe(101);const batchMs=Math.round(performance.now()-batch);expect(listing).not.toHaveBeenCalled();
  console.log(JSON.stringify({measurement:'file-updates-1000-files',baselineMs,singleMs,batch100Ms:batchMs,idleDirectoryReads:0,singleAndBatchDirectoryReads:0}));
},25000);
