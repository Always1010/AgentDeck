import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
test('production: process restart restores configuration; offline roots persist; occupied port exits',async()=>{
  test.setTimeout(45000);const temp=await fs.mkdtemp(path.join(os.tmpdir(),'agentdeck-restart-'));const root=path.join(temp,'content');await fs.mkdir(root);await fs.writeFile(path.join(root,'index.html'),'<title>恢复验证</title>');
  const children:ChildProcess[]=[];const args=[path.resolve('dist/server/server/main.js'),'--state-dir',path.join(temp,'state'),'--port','4420','--preview-port','4421'];
  // Launch from outside the checkout, as a login task or absolute-path command can do.
  const start=()=>{const child=spawn(process.execPath,args,{cwd:temp,windowsHide:true,stdio:'pipe'});children.push(child);return child;};
  const stop=async(child:ChildProcess)=>{if(child.exitCode!==null||child.signalCode!==null)return;const closed=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill();await closed;};
  const waitReady=async()=>expect.poll(async()=>{try{return(await fetch('http://127.0.0.1:4420/')).status;}catch{return 0;}},{timeout:10000}).toBe(200);
  const request=async(url:string,method='GET',body?:unknown)=>{const response=await fetch('http://127.0.0.1:4420'+url,{method,headers:{'sec-fetch-site':'same-origin',origin:'http://127.0.0.1:4420','x-workbench':'1','content-type':'application/json'},body:method==='GET'?undefined:JSON.stringify(body||{})});return response.json();};
  try{
    let child=start();await waitReady();await request('/api/projects','POST',{name:'恢复项目',mount:{label:'主目录',absolutePath:root}});const original=await request('/api/projects');const entry=(await request('/api/entries'))[0];await request(`/api/entries/${entry.id}/preferences`,'PATCH',{title:'保持名称',refreshMode:'prompt'});await stop(child);
    child=start();await waitReady();const restored=await request('/api/projects');expect(restored.projects).toEqual(original.projects);expect(restored.mounts[0].id).toBe(original.mounts[0].id);expect((await request('/api/entries'))[0]).toMatchObject({id:entry.id,title:'保持名称',refreshMode:'prompt'});await stop(child);
    await fs.rename(root,root+'-offline');child=start();await waitReady();expect((await request('/api/projects')).mounts[0].status).toBe('offline');
    const duplicate=start();let output='';duplicate.stderr?.on('data',chunk=>output+=chunk);await expect.poll(()=>duplicate.exitCode,{timeout:6000}).toBe(1);expect(output).toContain('EADDRINUSE');
  }finally{for(const child of children)await stop(child);await fs.rm(temp,{recursive:true,force:true});}
});
