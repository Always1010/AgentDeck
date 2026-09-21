import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
let temp:string;
async function json(page:Page,url:string,method='GET',body?:unknown){return page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:method==='GET'?{}:{'Content-Type':'application/json','X-Workbench':'1'},body:method==='GET'?undefined:JSON.stringify(body||{})});return {status:r.status,data:await r.json()};},{url,method,body});}
async function add(page:Page,name:string,dir:string,mode='content',tools=''){
  await page.getByRole('button',{name:'＋ 添加项目',exact:true}).click();
  await page.getByLabel('项目名称',{exact:true}).fill(name);await page.getByLabel('真实绝对路径').fill(dir);await page.getByLabel('用途').selectOption(mode);
  if(tools)await page.getByLabel('工具子目录').fill(tools);
  await page.getByRole('button',{name:'确认范围并保存'}).click();await expect(page.locator('.overlay')).toHaveCount(0);
}
test.beforeAll(async()=>{temp=await fs.mkdtemp(path.join(os.tmpdir(),'agentdeck-browser-'));await fs.cp(path.resolve('examples'),temp,{recursive:true});});
test.afterAll(async()=>{await fs.rm(temp,{recursive:true,force:true});});
test('production: add real projects and run native and built tools',async({page})=>{
  await page.goto('/');const snapshot=await json(page,'/api/projects');for(const p of snapshot.data.projects)await json(page,`/api/projects/${p.id}`,'DELETE');await page.reload();
  await add(page,'大宗商品',path.join(temp,'commodities'));await add(page,'AI 行业',path.join(temp,'ai'),'content','工具');await add(page,'公司工具',path.join(temp,'company','tool','dist'),'single-tool');
  await page.locator('.entry').filter({hasText:'文本清理器'}).click();let frame=page.frameLocator('iframe');await frame.locator('#input').fill('  hello    world  ');await frame.getByRole('button',{name:'整理空白'}).click();await expect(frame.locator('#output')).toHaveText('hello world');
  await page.locator('.entry').filter({hasText:'单位换算器'}).click();frame=page.frameLocator('iframe');await frame.locator('#tonnes').fill('3.4');await frame.getByRole('button',{name:'换算',exact:true}).click();await expect(frame.locator('#result')).toHaveText('3400 千克');
  await page.locator('.entry').filter({hasText:'铜市场 · 多文件演示'}).click();frame=page.frameLocator('iframe');await expect(frame.locator('#data')).toContainText('108');await expect(frame.locator('img')).toBeVisible();
  expect((await json(page,'/api/projects')).data.projects).toHaveLength(3);
});

