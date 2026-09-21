import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createWorkbench, type Workbench } from '../app/server/server.js';
let temp:string;let root:string;let app:Workbench;let id:string;
const headers={host:'127.0.0.1:4310','sec-fetch-site':'same-origin',origin:'http://127.0.0.1:4310','x-workbench':'1','content-type':'application/json'};
beforeEach(async()=>{temp=await fs.mkdtemp(path.join(os.tmpdir(),'agentdeck-security-'));root=path.join(temp,'project');await fs.mkdir(root);await fs.writeFile(path.join(root,'index.html'),'<h1>safe</h1>');app=await createWorkbench({stateDir:path.join(temp,'state'),port:4310,previewPort:4311});const r=await app.main.inject({method:'POST',url:'/api/projects',headers,payload:{name:'p',mount:{label:'m',absolutePath:root}}});expect(r.statusCode).toBe(200);id=app.registry.data.mounts[0].id;});
afterEach(async()=>{await app.close();await fs.rm(temp,{recursive:true,force:true});});
const get=(rel:string)=>app.preview.inject({url:`/m/${id}/${rel}`,headers:{host:'127.0.0.1:4311'}});
test('traversal, encoded separators, secrets, unknown MIME and exclusions',async()=>{
  await fs.writeFile(path.join(temp,'outside.txt'),'outside secret');
  await fs.writeFile(path.join(root,'.env.local'),'secret');await fs.writeFile(path.join(root,'secret.key'),'secret');await fs.writeFile(path.join(root,'payload.exe'),'payload');await fs.writeFile(path.join(root,'private.txt'),'private');
  for(const p of ['../outside.txt','%2e%2e/outside.txt','%2e%2e%2foutside.txt','%5c..%5coutside.txt','C%3a%5cWindows%5cwin.ini','.env.local','secret.key','payload.exe','index.html%3a$DATA'])expect((await get(p)).statusCode).toBeGreaterThanOrEqual(400);
  await app.main.inject({method:'PATCH',url:`/api/mounts/${id}`,headers,payload:{excludes:['private.txt']}});
  expect((await get('private.txt')).statusCode).toBe(403);await vi.waitFor(()=>expect(app.index.all().some(e=>e.relativePath==='private.txt')).toBe(false));
  if(process.platform==='win32')expect((await get('PRIVATE.TXT')).statusCode).toBe(403);
  expect((await app.main.inject({url:`/api/mounts/${id}/download?path=..%2Foutside.txt`,headers})).statusCode).toBe(400);
});
test('Windows junction and case boundaries, sensitive roots and state ancestry',async()=>{
  const outside=path.join(temp,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'secret.txt'),'secret');
  await fs.symlink(outside,path.join(root,'linked'),process.platform==='win32'?'junction':'dir');
  expect((await get('linked/secret.txt')).statusCode).toBe(403);await expect(app.policy.root(path.join(root,'linked'))).rejects.toThrow();
  if(process.platform==='win32')expect(await app.policy.root(root.toUpperCase())).toBeTruthy();
  await fs.mkdir(path.join(temp,'.git'));await fs.writeFile(path.join(temp,'.git','credentials.txt'),'secret');
  await expect(app.policy.root(path.join(temp,'.git'))).rejects.toThrow();
  await expect(app.policy.root(temp)).rejects.toThrow();
});

