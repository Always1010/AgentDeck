import { test, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createWorkbench } from '../app/server/server.js';
import { fileReference } from '../app/shared/model.js';
import { legacyId } from '../app/server/files.js';
test('legacy tool preferences and file references survive restart, relocation and enable patches',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'agentdeck-legacy-'));const root=path.join(temp,'tools');await fs.mkdir(path.join(root,'app','dist'),{recursive:true});await fs.writeFile(path.join(root,'app','dist','index.html'),'<title>tool</title>');
 const options={stateDir:path.join(temp,'state'),port:4310,previewPort:4311};let app=await createWorkbench(options);
 const headers={host:'127.0.0.1:4310','sec-fetch-site':'same-origin',origin:'http://127.0.0.1:4310','x-workbench':'1','content-type':'application/json'};
 try{
  await app.main.inject({method:'POST',url:'/api/projects',headers,payload:{name:'工具',mount:{label:'库',absolutePath:root,mode:'tool-library'}}});const id=app.registry.data.mounts[0].id;const old=legacyId(id,'tool:app');
  await app.registry.mutate(d=>{d.entryPreferences[old]={title:'自定义工具',kind:'tool'};});
  const url=`/api/entries/${encodeURIComponent(fileReference(id,'app/dist/index.html'))}`;
  expect((await app.main.inject({url,headers})).json().title).toBe('自定义工具');
  await app.close();app=await createWorkbench(options);expect((await app.main.inject({url,headers})).json().title).toBe('自定义工具');
  const newRoot=path.join(temp,'relocated');await fs.cp(root,newRoot,{recursive:true});await app.main.inject({method:'PATCH',url:`/api/mounts/${id}`,headers,payload:{absolutePath:newRoot}});expect(app.registry.data.mounts[0].mode).toBe('tool-library');expect((await app.main.inject({url,headers})).statusCode).toBe(200);
  await app.main.inject({method:'PATCH',url:`/api/mounts/${id}`,headers,payload:{enabled:false}});expect((await app.main.inject({url,headers})).statusCode).toBe(410);
  await app.main.inject({method:'PATCH',url:`/api/mounts/${id}`,headers,payload:{enabled:true}});expect((await app.main.inject({url,headers})).json().title).toBe('自定义工具');
  await app.main.inject({url:`/api/mounts/${id}/tree?path=app%2Fdist`,headers});expect((await app.main.inject({url:`/api/entries/${old}`,headers})).json().relativePath).toBe('app/dist/index.html');
  await fs.rm(path.join(newRoot,'app','dist'),{recursive:true});expect((await app.main.inject({url,headers})).statusCode).toBe(404);
 }finally{await app.close();await fs.rm(temp,{recursive:true,force:true});}
});
