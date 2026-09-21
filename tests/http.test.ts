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
test('large text limit, HEAD/MIME and no management credentials in preview',async()=>{
  await fs.writeFile(path.join(root,'large.json'),'x'.repeat(10*1024*1024+1));
  expect((await app.main.inject({url:`/api/mounts/${id}/file?path=large.json`,headers})).statusCode).toBe(413);
  const r=await app.preview.inject({method:'HEAD',url:`/m/${id}/index.html`,headers:{host:'127.0.0.1:4311'}});expect(r.statusCode).toBe(200);expect(r.body).toBe('');expect(r.headers['cache-control']).toBe('no-store');expect(r.headers['set-cookie']).toBeUndefined();expect(r.headers['content-security-policy']).toContain('sandbox');
  for(const endpoint of ['/api/projects','/api/fs/locations','/api/events',`/api/mounts/${id}/file?path=index.html`]){
    expect((await app.main.inject({url:endpoint,headers:{...headers,origin:'http://127.0.0.1:4311','sec-fetch-site':'same-site'}})).statusCode).toBe(403);
    expect((await app.main.inject({url:endpoint,headers:{...headers,host:'evil.example'}})).statusCode).toBe(403);
  }
});

