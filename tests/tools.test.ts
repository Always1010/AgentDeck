import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createWorkbench, type Workbench } from '../app/server/server.js';
import { fileReference } from '../app/shared/model.js';
import { legacyId } from '../app/server/files.js';
let temp: string, root: string, app: Workbench, mountId: string;
const headers = {host:'127.0.0.1:4310','sec-fetch-site':'same-origin',origin:'http://127.0.0.1:4310','x-workbench':'1','content-type':'application/json'};
beforeEach(async () => {
  temp=await fs.mkdtemp(path.join(os.tmpdir(),'agentdeck-tools-'));root=path.join(temp,'project');await fs.mkdir(root);
  await fs.writeFile(path.join(root,'merge.html'),'<input>');await fs.writeFile(path.join(root,'readme.md'),'# Notes');
  app=await createWorkbench({stateDir:path.join(temp,'state'),port:4310,previewPort:4311});
  await app.main.inject({method:'POST',url:'/api/projects',headers,payload:{name:'p',mount:{label:'m',absolutePath:root}}});mountId=app.registry.data.mounts[0].id;
});
afterEach(async () => {vi.restoreAllMocks();await app.close();await fs.rm(temp,{recursive:true,force:true});});
test('HTML tools persist, deduplicate, and can be removed when their file is unavailable',async () => {
  const id=fileReference(mountId,'merge.html');const readdir=vi.spyOn(fs,'readdir');
  for(let i=0;i<2;i++)expect((await app.main.inject({method:'PUT',url:'/api/tools',headers,payload:{id,title:'报表合并'}})).statusCode).toBe(200);
  expect((await app.main.inject({url:'/api/tools',headers})).json()).toEqual([{id,title:'报表合并'}]);
  await app.close();app=await createWorkbench({stateDir:path.join(temp,'state'),port:4310,previewPort:4311});
  expect((await app.main.inject({url:'/api/tools',headers})).json()).toHaveLength(1);expect(readdir).not.toHaveBeenCalled();
  await fs.rename(path.join(root,'merge.html'),path.join(root,'moved.html'));
  expect((await app.main.inject({url:'/api/tools',headers})).json()).toHaveLength(1);
  expect((await app.main.inject({method:'DELETE',url:`/api/tools/${encodeURIComponent(id)}`,headers,payload:{}})).statusCode).toBe(200);
  expect((await app.main.inject({url:'/api/tools',headers})).json()).toEqual([]);expect(await fs.readFile(path.join(root,'moved.html'),'utf8')).toBe('<input>');
});
test('tool registration validates HTML, path boundaries and mount availability',async () => {
  for(const [rel,status] of [['readme.md',400],['../outside.html',400],['missing.html',404]] as const){expect((await app.main.inject({method:'PUT',url:'/api/tools',headers,payload:{id:fileReference(mountId,rel)}})).statusCode).toBe(status);}
  await app.main.inject({method:'PATCH',url:`/api/mounts/${mountId}`,headers,payload:{enabled:false}});
  expect((await app.main.inject({method:'PUT',url:'/api/tools',headers,payload:{id:fileReference(mountId,'merge.html')}})).statusCode).toBe(410);
});
test('known legacy tool entries are restored without scanning and explicit removal stays removed',async () => {
  const old=legacyId(mountId,'tool:merge.html'),id=fileReference(mountId,'merge.html');
  await app.registry.mutate(d=>{d.entryPreferences[old]={title:'旧工具'};});await app.close();
  await fs.writeFile(path.join(temp,'state','legacy-file-references.json'),JSON.stringify({[old]:id,[legacyId(mountId,'readme.md')]:fileReference(mountId,'readme.md')}));
  const readdir=vi.spyOn(fs,'readdir');app=await createWorkbench({stateDir:path.join(temp,'state'),port:4310,previewPort:4311});
  expect((await app.main.inject({url:'/api/tools',headers})).json()).toEqual([{id,title:'旧工具'}]);expect(readdir).not.toHaveBeenCalled();
  await app.main.inject({method:'DELETE',url:`/api/projects/${app.registry.data.projects[0].id}`,headers,payload:{}});
  expect((await app.main.inject({url:`/api/entries/${encodeURIComponent(id)}`,headers})).statusCode).toBe(200);
  await app.main.inject({method:'DELETE',url:`/api/tools/${encodeURIComponent(id)}`,headers,payload:{}});
  await app.close();app=await createWorkbench({stateDir:path.join(temp,'state'),port:4310,previewPort:4311});
  expect((await app.main.inject({url:'/api/tools',headers})).json()).toEqual([]);
});

test('absolute HTML registration works without mounts and serves bounded original assets', async () => {
  await app.main.inject({method:'DELETE',url:`/api/projects/${app.registry.data.projects[0].id}`,headers,payload:{}});
  const html = path.join(temp, 'tool.HTML');
  await fs.writeFile(html, '<link rel="stylesheet" href="assets/app.css"><input>');
  await fs.mkdir(path.join(temp, 'assets')); await fs.writeFile(path.join(temp, 'assets', 'app.css'), 'body{color:red}');
  await fs.writeFile(path.join(temp, 'secret.key'), 'private');
  await fs.writeFile(path.join(temp, 'payload.exe'), 'private');
  const register = () => app.main.inject({method:'PUT',url:'/api/tools',headers,payload:{absolutePath:html,title:'独立工具'}});
  const first = (await register()).json(); const second = (await register()).json();
  expect(first.alreadyRegistered).toBe(false); expect(second).toEqual({id:first.id,alreadyRegistered:true});
  const snapshot = (await app.main.inject({url:'/api/projects',headers})).json();
  expect(snapshot.mounts).toEqual([]); expect(snapshot.projects).toEqual([]);
  const e = (await app.main.inject({url:`/api/entries/${encodeURIComponent(first.id)}`,headers})).json();
  const url = new URL(e.previewUrl).pathname; const base = url.slice(0,url.lastIndexOf('/')+1);
  const previewHeaders = {host:'127.0.0.1:4311'};
  expect((await app.preview.inject({url,headers:previewHeaders})).body).toContain('<input>');
  expect((await app.preview.inject({url:base+'assets/app.css',headers:previewHeaders})).body).toBe('body{color:red}');
  for (const resource of ['%2e%2e%2foutside.css','%5c..%5coutside.css','secret.key','state/registry.json','payload.exe']) {
    expect((await app.preview.inject({url:base+resource,headers:previewHeaders})).statusCode).toBeGreaterThanOrEqual(400);
  }
  await fs.mkdir(path.join(temp,'help'));await fs.writeFile(path.join(temp,'help','index.html'),'<p>帮助页</p>');
  expect((await app.preview.inject({url:base+'help/',headers:previewHeaders})).body).toContain('帮助页');
  expect((await app.main.inject({url:`/api/mounts/${e.mountId}/tree`,headers})).statusCode).toBe(404);
  expect((await app.main.inject({url:`/api/mounts/${e.mountId}/file?path=${encodeURIComponent(e.relativePath)}`,headers})).body).toContain('<input>');
  expect((await app.main.inject({url:`/api/mounts/${e.mountId}/resource-version?path=${encodeURIComponent(e.relativePath)}`,headers})).statusCode).toBe(200);
  await app.close(); app=await createWorkbench({stateDir:path.join(temp,'state'),port:4310,previewPort:4311});
  expect((await app.main.inject({url:'/api/tools',headers})).json()).toEqual([{id:first.id,title:'独立工具'}]);
});

test('mounted tools keep their ID and survive project removal; relocated tools keep their references', async () => {
  const id = fileReference(mountId,'merge.html');
  await app.main.inject({method:'PUT',url:'/api/tools',headers,payload:{id,title:'原名称'}});
  expect((await app.main.inject({method:'PUT',url:'/api/tools',headers,payload:{absolutePath:path.join(root,'merge.html')}})).json().id).toBe(id);
  await app.main.inject({method:'DELETE',url:`/api/projects/${app.registry.data.projects[0].id}`,headers,payload:{}});
  expect((await app.main.inject({url:`/api/entries/${encodeURIComponent(id)}`,headers})).statusCode).toBe(200);
  expect((await app.preview.inject({url:`/m/${mountId}/merge.html`,headers:{host:'127.0.0.1:4311'}})).statusCode).toBe(200);
  const moved = path.join(temp,'renamed.htm'); await fs.rename(path.join(root,'merge.html'),moved);
  expect((await app.main.inject({url:`/api/entries/${encodeURIComponent(id)}`,headers})).statusCode).toBe(404);
  expect((await app.main.inject({method:'PATCH',url:`/api/tools/${encodeURIComponent(id)}`,headers,payload:{absolutePath:moved}})).json()).toEqual({id});
  const e = (await app.main.inject({url:`/api/entries/${encodeURIComponent(id)}`,headers})).json();
  expect(e.title).toBe('原名称'); expect(new URL(e.previewUrl).pathname).toContain('renamed.htm');
  expect((await app.preview.inject({url:new URL(e.previewUrl).pathname,headers:{host:'127.0.0.1:4311'}})).statusCode).toBe(200);
  const other = path.join(temp,'other.html'); await fs.writeFile(other,'<p>other</p>');
  await app.main.inject({method:'PUT',url:'/api/tools',headers,payload:{absolutePath:other}});
  expect((await app.main.inject({method:'PATCH',url:`/api/tools/${encodeURIComponent(id)}`,headers,payload:{absolutePath:other}})).statusCode).toBe(409);
  const otherId = app.registry.data.toolSources!.find(source => source.absolutePath.endsWith('other.html'))!.id;
  await app.main.inject({method:'DELETE',url:`/api/tools/${encodeURIComponent(otherId)}`,headers,payload:{}});
  await app.main.inject({method:'DELETE',url:`/api/tools/${encodeURIComponent(id)}`,headers,payload:{}});
  expect((await app.main.inject({url:'/api/tools',headers})).json()).toEqual([]);
  expect((await app.main.inject({url:`/api/entries/${encodeURIComponent(id)}`,headers})).statusCode).toBe(200);
  expect(await fs.readFile(moved,'utf8')).toBe('<input>');
});

test('HTML selection checks actual file types, sources, junctions and broad directory locations', async () => {
  for (const [absolutePath,status] of [[path.join(root,'readme.md'),400],[root,400],[path.join(root,'missing.html'),404],['relative.html',400],[path.join(temp,'state','registry.json'),403]] as const) {
    expect((await app.main.inject({method:'PUT',url:'/api/tools',headers,payload:{absolutePath}})).statusCode).toBe(status);
  }
  await fs.symlink(root,path.join(temp,'linked'),process.platform==='win32'?'junction':'dir');
  expect((await app.main.inject({method:'PUT',url:'/api/tools',headers,payload:{absolutePath:path.join(temp,'linked','merge.html')}})).statusCode).toBe(403);
  expect((await app.main.inject({method:'PUT',url:'/api/tools',headers:{...headers,origin:'https://example.com'},payload:{absolutePath:path.join(root,'merge.html')}})).statusCode).toBe(403);
  const listing = (await app.main.inject({url:`/api/fs/html-files?absolutePath=${encodeURIComponent(root)}`,headers})).json();
  expect(listing.items.map((item:{name:string})=>item.name)).toEqual(['merge.html']);
  await expect(app.policy.toolLocation(os.homedir(),true)).resolves.toBeTruthy();
  await expect(app.policy.toolLocation(path.parse(root).root,true)).resolves.toBeTruthy();
  await fs.writeFile(path.join(root,'private.css'),'private');
  await app.main.inject({method:'PATCH',url:`/api/mounts/${mountId}`,headers,payload:{excludes:[process.platform==='win32'?'MERGE.HTML':'merge.html','private.css']}});
  const registered = await app.main.inject({method:'PUT',url:'/api/tools',headers,payload:{absolutePath:path.join(root,'merge.html')}});
  expect(registered.statusCode).toBe(200);
  const e = (await app.main.inject({url:`/api/entries/${encodeURIComponent(registered.json().id)}`,headers})).json();
  expect(e.previewUrl).toBeTruthy();
  expect((await app.preview.inject({url:new URL(e.previewUrl).pathname.replace(/merge\.html$/, 'private.css'),headers:{host:'127.0.0.1:4311'}})).statusCode).toBe(403);
});
