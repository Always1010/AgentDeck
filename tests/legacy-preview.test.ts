import {beforeEach,afterEach,test,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createWorkbench,type Workbench} from '../app/server/server.js';
import {fileReference} from '../app/shared/model.js';

const headers={host:'127.0.0.1:4310','sec-fetch-site':'same-origin',origin:'http://127.0.0.1:4310','x-workbench':'1','content-type':'application/json'};
const previewHeaders={host:'127.0.0.1:4311'};
let temp:string,root:string,app:Workbench,mountId:string;
beforeEach(async()=>{
  temp=await fs.mkdtemp(path.join(os.tmpdir(),'agentdeck-legacy-preview-'));root=path.join(temp,'original');await fs.mkdir(root);
  await fs.writeFile(path.join(root,'a.html'),'<p>original a</p>');await fs.writeFile(path.join(root,'b.html'),'<p>original b</p>');await fs.writeFile(path.join(root,'main.js'),'original script');
  app=await createWorkbench({stateDir:path.join(temp,'state'),port:4310,previewPort:4311});
  await app.main.inject({method:'POST',url:'/api/projects',headers,payload:{name:'p',mount:{label:'m',absolutePath:root}}});mountId=app.registry.data.mounts[0].id;
});
afterEach(async()=>{await app.close();await fs.rm(temp,{recursive:true,force:true});});
const register=(name:string)=>app.main.inject({method:'PUT',url:'/api/tools',headers,payload:{absolutePath:path.join(root,name)}});
const old=(name:string)=>app.preview.inject({url:`/m/${mountId}/${name}`,headers:previewHeaders});
const restart=async()=>{await app.close();app=await createWorkbench({stateDir:path.join(temp,'state'),port:4310,previewPort:4311});};

test('legacy assets keep the original root after one of two tools moves, through disable, deletion and restart',async()=>{
  const a=(await register('a.html')).json().id;await register('b.html');
  const moved=path.join(temp,'moved');await fs.mkdir(moved);await fs.rename(path.join(root,'a.html'),path.join(moved,'a.html'));await fs.writeFile(path.join(moved,'main.js'),'different moved script');
  expect((await app.main.inject({method:'PATCH',url:`/api/tools/${encodeURIComponent(a)}`,headers,payload:{absolutePath:path.join(moved,'a.html')}})).statusCode).toBe(200);
  await app.main.inject({method:'PATCH',url:`/api/mounts/${mountId}`,headers,payload:{enabled:false}});
  expect((await old('main.js')).body).toBe('original script');expect((await old('a.html')).statusCode).toBe(404);expect((await old('b.html')).body).toContain('original b');
  await app.main.inject({method:'DELETE',url:`/api/mounts/${mountId}`,headers,payload:{}});await restart();
  expect((await old('main.js')).body).toBe('original script');
  const e=(await app.main.inject({url:`/api/entries/${encodeURIComponent(a)}`,headers})).json();
  expect((await app.preview.inject({url:new URL(e.previewUrl).pathname.replace(/a\.html$/,'main.js'),headers:previewHeaders})).body).toBe('different moved script');
});

test('ambiguous original roots never choose the first existing asset',async()=>{
  await register('a.html');
  const second=path.join(temp,'second');await fs.mkdir(second);await fs.writeFile(path.join(second,'b.html'),'<p>second b</p>');await fs.writeFile(path.join(second,'main.js'),'second script');
  await app.main.inject({method:'PATCH',url:`/api/mounts/${mountId}`,headers,payload:{absolutePath:second}});
  await app.main.inject({method:'PUT',url:'/api/tools',headers,payload:{absolutePath:path.join(second,'b.html')}});
  await app.main.inject({method:'DELETE',url:`/api/mounts/${mountId}`,headers,payload:{}});
  for(const remove of [false,true]){
    if(remove)await fs.unlink(path.join(root,'a.html'));
    const response=await old('main.js');expect(response.statusCode).toBe(409);expect(response.json().error.code).toBe('LEGACY_PREVIEW_AMBIGUOUS');
  }
  expect((await old('b.html')).body).toContain('second b');
});

test('orphaned original entry closes its assets instead of serving moved content',async()=>{
  const id=(await register('a.html')).json().id;
  const moved=path.join(temp,'moved.html');await fs.rename(path.join(root,'a.html'),moved);
  await app.main.inject({method:'PATCH',url:`/api/tools/${encodeURIComponent(id)}`,headers,payload:{absolutePath:moved}});
  await app.main.inject({method:'DELETE',url:`/api/mounts/${mountId}`,headers,payload:{}});
  expect((await old('main.js')).statusCode).toBe(404);
});

test('legacy unbound records migrate only when the physical location is still exact',async()=>{
  const id=(await register('a.html')).json().id;
  await app.registry.mutate(d=>{delete d.fileSources![0].legacyPreview;});await restart();
  expect(app.registry.data.fileSources![0].legacyPreview?.absolutePath).toBe(await fs.realpath(path.join(root,'a.html')));
  const moved=path.join(temp,'moved.html');await fs.rename(path.join(root,'a.html'),moved);
  await app.registry.mutate(d=>{d.fileSources![0].absolutePath=moved;delete d.fileSources![0].legacyPreview;});await restart();
  expect(app.registry.data.fileSources![0].legacyPreview).toBeUndefined();
  await app.main.inject({method:'DELETE',url:`/api/mounts/${mountId}`,headers,payload:{}});
  expect((await old('main.js')).json().error.code).toBe('LEGACY_PREVIEW_UNBOUND');
  expect((await app.main.inject({url:`/api/entries/${encodeURIComponent(id)}`,headers})).statusCode).toBe(200);
});

test('legacy original bindings preserve ancestor resource exclusions',async()=>{
  await fs.mkdir(path.join(root,'private'));await fs.writeFile(path.join(root,'private','tool.html'),'<p>selected</p>');await fs.writeFile(path.join(root,'private','main.js'),'excluded');
  await app.main.inject({method:'PATCH',url:`/api/mounts/${mountId}`,headers,payload:{excludes:['private']}});
  await register('private/tool.html');await app.main.inject({method:'DELETE',url:`/api/mounts/${mountId}`,headers,payload:{}});
  expect((await old('private/tool.html')).statusCode).toBe(200);expect((await old('private/main.js')).statusCode).toBe(403);
});

test.skipIf(process.platform!=='win32')('legacy Windows preview matching preserves differently cased old URLs',async()=>{
  await fs.mkdir(path.join(root,'Mixed'));await fs.writeFile(path.join(root,'Mixed','Tool.HTML'),'<p>mixed case</p>');await fs.writeFile(path.join(root,'Mixed','Main.JS'),'mixed script');
  await register('Mixed/Tool.HTML');await app.main.inject({method:'DELETE',url:`/api/mounts/${mountId}`,headers,payload:{}});
  expect((await old('mixed/tool.html')).body).toContain('mixed case');expect((await old('MIXED/main.js')).body).toBe('mixed script');
});
