import { beforeEach, afterEach, test, expect } from 'vitest';
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
  expect((await get('private.txt')).statusCode).toBe(403);expect((await app.main.inject({url:`/api/mounts/${id}/tree`,headers})).json().some((e:{name:string})=>e.name==='private.txt')).toBe(false);
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

test.each(['/%61pi/projects', '/%61%70%69/projects'])('encoded API route %s requires the same trusted headers as its canonical route', async url => {
  const registry = structuredClone(app.registry.data);
  const hostOnly = { host: headers.host };
  const untrustedGet = await app.main.inject({ url, headers: hostOnly });
  expect(untrustedGet.statusCode).toBe(403);
  expect(untrustedGet.json().error.code).toBe('UNTRUSTED_ORIGIN');
  const untrustedPost = await app.main.inject({ method: 'POST', url, headers: hostOnly, payload: { name: 'blocked' } });
  expect(untrustedPost.statusCode).toBe(403);
  expect(untrustedPost.json().error.code).toBe('UNTRUSTED_ORIGIN');
  const missingToken = await app.main.inject({ method: 'POST', url, headers: { host: headers.host, origin: headers.origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, payload: { name: 'blocked' } });
  expect(missingToken.statusCode).toBe(403);
  expect(missingToken.json().error.code).toBe('CSRF_REJECTED');
  expect(app.registry.data).toEqual(registry);
  expect((await app.main.inject({ url, headers })).statusCode).toBe(200);
  expect((await app.main.inject({ method: 'POST', url, headers, payload: { name: 'trusted' } })).statusCode).toBe(200);
  expect(app.registry.data.projects.map(project => project.name)).toContain('trusted');
});

test('unknown API paths retain their origin guard before returning a not-found response', async () => {
  expect((await app.main.inject({ url: '/api/unknown', headers: { host: headers.host } })).statusCode).toBe(403);
  expect((await app.main.inject({ url: '/api/unknown', headers })).statusCode).toBe(404);
});

