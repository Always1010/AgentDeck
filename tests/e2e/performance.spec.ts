import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
let temp:string;let otherDisk:string;
async function json(page:Page,url:string,method='GET',body?:unknown){return page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:method==='GET'?{}:{'Content-Type':'application/json','X-Workbench':'1'},body:method==='GET'?undefined:JSON.stringify(body||{})});return {status:r.status,data:await r.json()};},{url,method,body});}
async function add(page:Page,name:string,dir:string,mode='content',tools=''){
  await page.getByRole('button',{name:'＋ 添加项目',exact:true}).click();
  await page.getByLabel('项目名称',{exact:true}).fill(name);await page.getByLabel('真实绝对路径').fill(dir);await page.getByLabel('用途').selectOption(mode);
  if(tools)await page.getByLabel('工具子目录').fill(tools);
  await page.getByRole('button',{name:'确认范围并保存'}).click();await expect(page.locator('.overlay')).toHaveCount(0);
}
test.beforeAll(async()=>{temp=await fs.mkdtemp(path.join(os.tmpdir(),'agentdeck-browser-'));otherDisk=await fs.mkdtemp(path.join(process.cwd(),'test-fixtures-'));await fs.cp(path.resolve('examples'),temp,{recursive:true});});
test.afterAll(async()=>{await fs.rm(temp,{recursive:true,force:true});await fs.rm(otherDisk,{recursive:true,force:true});});
test('production: 3 mounts / 1000 files, update latency, reconnection and read-only lifecycle',async({page,context})=>{
  test.setTimeout(120000);await page.goto('/');const snap=await json(page,'/api/projects');for(const p of snap.data.projects)await json(page,`/api/projects/${p.id}`,'DELETE');
  const roots=Array.from({length:3},(_,i)=>path.join(temp,`load-${i}`));for(const root of roots)await fs.mkdir(root,{recursive:true});
  await Promise.all(Array.from({length:1000},(_,i)=>fs.writeFile(path.join(roots[i%3],`report-${i}.html`),`<title>负载报告 ${i}</title><p>${i}</p>`)));
  const initial=Date.now();for(const [i,root] of roots.entries()){expect((await json(page,'/api/projects','POST',{name:`负载 ${i}`,mount:{label:`目录 ${i}`,absolutePath:root}})).status).toBe(200);}
  await expect.poll(async()=>(await json(page,'/api/entries')).data.length,{timeout:30000}).toBe(1000);const indexingMs=Date.now()-initial;
  const start=Date.now();await fs.writeFile(path.join(roots[0],'report-0.html'),'<title>负载更新完成</title><p>updated</p>');await expect(page.locator('.entry').filter({hasText:'负载更新完成'})).toBeVisible({timeout:15000});const updateMs=Date.now()-start;
  console.log(JSON.stringify({measurement:'production-1000-files',platform:process.platform,node:process.version,cpu:os.cpus()[0].model,mounts:3,files:1000,indexingMs,updateMs}));
  await page.locator('.entry').filter({hasText:'负载更新完成'}).click();await expect(page.frameLocator('iframe').locator('p')).toHaveText('updated');
  const popupPromise=page.waitForEvent('popup');await page.getByRole('link',{name:'新标签',exact:true}).click();const popup=await popupPromise;await expect(popup.frameLocator('iframe').locator('p')).toHaveText('updated');await fs.writeFile(path.join(roots[0],'report-0.html'),'<title>负载更新完成</title><p>independent</p>');await expect(popup.frameLocator('iframe').locator('p')).toHaveText('independent');await popup.close();
  await context.setOffline(true);await fs.writeFile(path.join(roots[1],'reconnected.html'),'<title>SSE 重连发现</title>');await context.setOffline(false);await expect(page.locator('.entry').filter({hasText:'SSE 重连发现'})).toBeVisible({timeout:15000});
  const entries=(await json(page,'/api/entries')).data;const saved=entries.find((e:{title:string})=>e.title==='负载更新完成');const registry=(await json(page,'/api/projects')).data;
  await page.getByRole('button',{name:'☆ 收藏',exact:true}).click();await json(page,`/api/projects/${saved.projectId}`,'PATCH',{name:'改名保持链接'});expect((await json(page,`/api/entries/${saved.id}`)).status).toBe(200);
  const hash=async()=>{const {createHash}=await import('node:crypto');const items=[];for(const root of roots)for(const name of (await fs.readdir(root)).sort())items.push([root,name,createHash('sha256').update(await fs.readFile(path.join(root,name))).digest('hex')]);return items;};const before=await hash();
  const m=registry.mounts[0];await json(page,`/api/mounts/${m.id}`,'PATCH',{enabled:false});const raw=`http://127.0.0.1:4411/m/${m.id}/report-0.html`;expect((await page.request.get(raw)).status()).toBe(410);await json(page,`/api/mounts/${m.id}`,'PATCH',{enabled:true});expect((await page.request.get(raw)).status()).toBe(200);
  for(const p of registry.projects)await json(page,`/api/projects/${p.id}`,'DELETE');expect((await page.request.get(raw)).status()).toBe(404);expect(await hash()).toEqual(before);
});


