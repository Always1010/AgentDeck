import { beforeEach, afterEach, test, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createWorkbench, type Workbench } from '../app/server/server.js';
let temp: string; let app: Workbench;
const headers = {host:'127.0.0.1:4310','sec-fetch-site':'same-origin',origin:'http://127.0.0.1:4310','x-workbench':'1','content-type':'application/json'};
beforeEach(async()=>{temp=await fs.mkdtemp(path.join(os.tmpdir(),'agentdeck-'));app=await createWorkbench({stateDir:path.join(temp,'state'),port:4310,previewPort:4311});});
afterEach(async()=>{await app.close();await fs.rm(temp,{recursive:true,force:true});});
test('two real mounts persist; serialized updates survive reload',async()=>{
  for(const name of ['one','two']){const dir=path.join(temp,name);await fs.mkdir(dir);const r=await app.main.inject({method:'POST',url:'/api/projects',headers,payload:{name,mount:{label:name,absolutePath:dir}}});expect(r.statusCode).toBe(200);}
  await Promise.all(['three','four'].map(name=>app.main.inject({method:'POST',url:'/api/projects',headers,payload:{name}})));
  await app.registry.load();expect(app.registry.data.projects).toHaveLength(4);expect(app.registry.data.mounts).toHaveLength(2);
  expect(await fs.readdir(path.join(temp,'one'))).toEqual([]);
});
test('reject untrusted API requests and sensitive/overlapping paths',async()=>{
  expect((await app.main.inject({url:'/api/projects',headers:{host:headers.host}})).statusCode).toBe(403);
  expect((await app.main.inject({url:'/api/fs/locations',headers:{...headers,origin:'http://127.0.0.1:4311','sec-fetch-site':'same-site'}})).statusCode).toBe(403);
  await expect(app.policy.root(app.registry.directory)).rejects.toThrow();
  await expect(app.policy.root(os.homedir())).rejects.toThrow();
  const dir=path.join(temp,'data');await fs.mkdir(path.join(dir,'tools'),{recursive:true});
  const p=(await app.main.inject({method:'POST',url:'/api/projects',headers,payload:{name:'p',mount:{label:'root',absolutePath:dir}}})).json();
  const r=await app.main.inject({method:'POST',url:`/api/projects/${p.id}/mounts`,headers,payload:{label:'child',absolutePath:path.join(dir,'tools')}});expect(r.statusCode).toBe(409);expect(r.json().error.code).toBe('OVERLAPPING_MOUNT');
});
test('corrupt registry is preserved',async()=>{await fs.writeFile(app.registry.file,'broken');await expect(app.registry.load()).rejects.toThrow('注册表损坏');expect(await fs.readFile(app.registry.file,'utf8')).toBe('broken');});
