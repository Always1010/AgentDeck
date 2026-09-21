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
  await app.main.inject({method:'DELETE',url:`/api/tools/${encodeURIComponent(id)}`,headers,payload:{}});
  await app.close();app=await createWorkbench({stateDir:path.join(temp,'state'),port:4310,previewPort:4311});
  expect((await app.main.inject({url:'/api/tools',headers})).json()).toEqual([]);
});
