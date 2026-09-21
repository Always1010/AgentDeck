import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
test('development entry serves the same management UI',async({page})=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'agentdeck-dev-'));
  const child=spawn(process.execPath,['--import','tsx','app/server/main.ts','--dev','--state-dir',temp,'--port','4430','--preview-port','4431'],{windowsHide:true,stdio:'pipe'});
  try{await expect.poll(async()=>{try{return(await fetch('http://127.0.0.1:4430/')).status;}catch{return 0;}},{timeout:15000}).toBe(200);await page.goto('http://127.0.0.1:4430/');await expect(page.getByRole('button',{name:'添加第一个项目'})).toBeVisible();await expect(page.locator('.connection')).toContainText('实时连接');}
  finally{if(child.exitCode===null){const exited=new Promise<void>(r=>child.once('exit',()=>r()));child.kill();await exited;}await fs.rm(temp,{recursive:true,force:true});}
});
