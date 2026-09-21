import { test, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createWorkbench } from '../app/server/server.js';
test('tool container rules, candidate selection, stable IDs and restart persistence',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'agentdeck-discovery-'));const root=path.join(temp,'tools');
  for(const rel of ['group/app/src','group/app/dist','group/app/build','source-only/src','native'])await fs.mkdir(path.join(root,rel),{recursive:true});
  for(const rel of ['index.html','group/app/src/index.html','group/app/dist/index.html','group/app/build/index.html','source-only/src/index.html','native/index.html'])await fs.writeFile(path.join(root,rel),`<title>${rel}</title>`);
  for(const rel of ['group/app/package.json','source-only/package.json'])await fs.writeFile(path.join(root,rel),'{"scripts":{"build":"must-not-run"}}');
  const options={stateDir:path.join(temp,'state'),port:4310,previewPort:4311};let app=await createWorkbench(options);
  const headers={host:'127.0.0.1:4310','sec-fetch-site':'same-origin',origin:'http://127.0.0.1:4310','x-workbench':'1','content-type':'application/json'};
  try{
    await app.main.inject({method:'POST',url:'/api/projects',headers,payload:{name:'工具',mount:{label:'库',absolutePath:root,mode:'tool-library'}}});
    const all=app.index.all();expect(all).toHaveLength(4);const conflict=all.find(e=>e.toolRoot==='group/app')!;expect(conflict.status).toBe('choose-entry');expect(all.find(e=>e.toolRoot==='source-only')?.status).toBe('pending-build');
    const r=await app.main.inject({method:'PUT',url:`/api/mounts/${conflict.mountId}/tool-override`,headers,payload:{toolRoot:'group/app',entry:'dist/index.html'}});expect(r.statusCode).toBe(200);expect(app.index.all().find(e=>e.id===conflict.id)?.relativePath).toBe('group/app/dist/index.html');
    await app.main.inject({method:'PATCH',url:`/api/entries/${conflict.id}/preferences`,headers,payload:{title:'自定义工具'}});await app.close();app=await createWorkbench(options);expect(app.index.all().find(e=>e.id===conflict.id)?.title).toBe('自定义工具');
    const newRoot=path.join(temp,'relocated');await fs.cp(root,newRoot,{recursive:true});const relocated=await app.main.inject({method:'PATCH',url:`/api/mounts/${conflict.mountId}`,headers,payload:{absolutePath:newRoot}});expect(relocated.statusCode,relocated.body).toBe(200);expect(app.index.all().find(e=>e.id===conflict.id)?.relativePath,JSON.stringify([...app.index.states])).toBe('group/app/dist/index.html');
    expect(app.registry.data.mounts[0].mode).toBe('tool-library');await app.main.inject({method:'PATCH',url:`/api/mounts/${conflict.mountId}`,headers,payload:{enabled:false}});await app.main.inject({method:'PATCH',url:`/api/mounts/${conflict.mountId}`,headers,payload:{enabled:true}});expect(app.registry.data.mounts[0].mode).toBe('tool-library');expect(app.index.all().find(e=>e.id===conflict.id)?.title).toBe('自定义工具');
    await fs.rm(path.join(newRoot,'group/app/dist'),{recursive:true});await app.index.sync();expect(app.index.all().find(e=>e.id===conflict.id)?.status).toBe('pending-build');
  }finally{await app.close();await fs.rm(temp,{recursive:true,force:true});}
});

