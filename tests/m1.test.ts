import { test, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createWorkbench } from '../app/server/server.js';
test('native and build tools, nested reports, assets and runtime lifecycle',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'agentdeck-m1-'));
  const root=path.join(temp,'project');await fs.mkdir(path.join(root,'工具','app','dist'),{recursive:true});await fs.mkdir(path.join(root,'reports'),{recursive:true});
  await fs.writeFile(path.join(root,'index.html'),'<title>Home</title>');await fs.writeFile(path.join(root,'reports','中文 #%.html'),'<title>Report</title>');
  await fs.writeFile(path.join(root,'工具','native.html'),'<input>');await fs.writeFile(path.join(root,'工具','app','package.json'),'{}');await fs.writeFile(path.join(root,'工具','app','dist','index.html'),'<script src="./app.js"></script>');await fs.writeFile(path.join(root,'工具','app','dist','app.js'),'console.log(1)');
  const app=await createWorkbench({stateDir:path.join(temp,'state'),port:4310,previewPort:4311});
  const headers={host:'127.0.0.1:4310','sec-fetch-site':'same-origin',origin:'http://127.0.0.1:4310','x-workbench':'1','content-type':'application/json'};
  try {
    const response=await app.main.inject({method:'POST',url:'/api/projects',headers,payload:{name:'p',mount:{label:'m',absolutePath:root,toolDirectories:['工具']}}});expect(response.statusCode).toBe(200);
    const entries=app.index.all();expect(entries).toHaveLength(4);expect(entries.filter(e=>e.kind==='tool')).toHaveLength(2);expect(entries.some(e=>e.relativePath==='工具/app/dist/index.html')).toBe(true);
    const m=app.registry.data.mounts[0];const get=(p:string)=>app.preview.inject({url:`/m/${m.id}/${p}`,headers:{host:'127.0.0.1:4311'}});
    expect((await get('reports/'+encodeURIComponent('中文 #%.html'))).statusCode).toBe(200);
    expect((await get(encodeURI('工具/app/dist/app.js'))).headers['content-type']).toContain('javascript');
    expect((await get('missing.js')).statusCode).toBe(404);expect((await get(encodeURI('工具/app/package.json'))).statusCode).toBe(403);
    expect((await get(encodeURI('工具/app/dist'))).statusCode).toBe(302);
    await app.main.inject({method:'PATCH',url:`/api/mounts/${m.id}`,headers,payload:{enabled:false}});expect((await get('index.html')).statusCode).toBe(410);
    await app.main.inject({method:'DELETE',url:`/api/mounts/${m.id}`,headers,payload:{}});expect((await get('index.html')).statusCode).toBe(404);expect(await fs.readFile(path.join(root,'index.html'),'utf8')).toBe('<title>Home</title>');
  } finally {await app.close();await fs.rm(temp,{recursive:true,force:true});}
});
