import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createWorkbench, type Workbench } from '../app/server/server.js';

let temp:string;let app:Workbench;
const headers={host:'127.0.0.1:4310','sec-fetch-site':'same-origin',origin:'http://127.0.0.1:4310','x-workbench':'1','content-type':'application/json'};
const request=(url:string,method:'POST'|'PATCH'|'DELETE',payload:object)=>app.main.inject({url,method,headers,payload});
const bounded=<T>(promise:Promise<T>,stage:string)=>Promise.race([promise,new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error(`timeout: ${stage}`)),1500))]);
beforeEach(async()=>{temp=await fs.mkdtemp(path.join(os.tmpdir(),'agentdeck-background-'));app=await createWorkbench({stateDir:path.join(temp,'state'),port:4310,previewPort:4311});});
afterEach(async()=>{await app.close();await fs.rm(temp,{recursive:true,force:true});});

test('save returns before indexing; unrelated mounts are not rescanned',async()=>{
  const first=path.join(temp,'first');const second=path.join(temp,'second');await fs.mkdir(first);await fs.mkdir(second);
  const canonicalSecond=await fs.realpath(second);
  await fs.writeFile(path.join(first,'one.html'),'<title>One</title>');await fs.writeFile(path.join(second,'two.csv'),'value');
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
  let entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve);
  const scan=app.index.scan.bind(app.index);
  const spy=vi.spyOn(app.index,'scan').mockImplementation(async m=>{if(m.absolutePath===canonicalSecond){entered();await gate;}return scan(m);});
  try{
    const one=(await bounded(request('/api/projects','POST',{name:'One',mount:{label:'one',absolutePath:first}}),'first save')).json();
    await vi.waitFor(()=>expect(app.index.all().map(e=>e.relativePath)).toContain('one.html'));
    spy.mockClear();
    const two=await bounded(request('/api/projects','POST',{name:'Two',mount:{label:'two',absolutePath:second}}),'second save');
    expect(two.statusCode).toBe(200);await bounded(started,'second scan');
    expect((await app.main.inject({url:'/api/projects',headers})).json().mounts.find((m:{absolutePath:string})=>m.absolutePath===canonicalSecond).status).toBe('scanning');
    expect(app.index.all().map(e=>e.relativePath)).toEqual(['one.html']);
    await request(`/api/projects/${one.id}`,'PATCH',{name:'Renamed'});
    expect(spy.mock.calls.map(([m])=>m.absolutePath)).toEqual([canonicalSecond]);
    release();await vi.waitFor(()=>expect(app.index.all().map(e=>e.relativePath).sort()).toEqual(['one.html','two.csv']));
  }finally{release();spy.mockRestore();}
});

test('relocate and delete invalidate delayed scans without reviving old entries',async()=>{
  const oldRoot=path.join(temp,'old');const newRoot=path.join(temp,'new');await fs.mkdir(oldRoot);await fs.mkdir(newRoot);
  const canonicalOld=await fs.realpath(oldRoot);
  await fs.writeFile(path.join(oldRoot,'old.html'),'<title>Old</title>');await fs.writeFile(path.join(newRoot,'new.html'),'<title>New</title>');
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
  let entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve);
  const scan=app.index.scan.bind(app.index);
  const spy=vi.spyOn(app.index,'scan').mockImplementation(async m=>{if(m.absolutePath===canonicalOld){entered();await gate;}return scan(m);});
  try{
    const project=(await bounded(request('/api/projects','POST',{name:'Moving',mount:{label:'root',absolutePath:oldRoot}}),'moving save')).json();
    await bounded(started,'old scan');const id=app.registry.data.mounts[0].id;
    expect((await request(`/api/mounts/${id}`,'PATCH',{absolutePath:newRoot})).statusCode).toBe(200);
    release();await vi.waitFor(()=>expect(app.index.all().map(e=>e.relativePath)).toEqual(['new.html']));
    expect((await request(`/api/projects/${project.id}`,'DELETE',{})).statusCode).toBe(200);
    expect(app.index.all()).toEqual([]);expect(app.index.states.has(id)).toBe(false);
  }finally{release();spy.mockRestore();}
});
