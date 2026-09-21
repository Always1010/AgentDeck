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

test('production: dynamic files, report reload, tool input retained, dist recovery and Markdown',async({page})=>{
  await page.goto('/');const snap=await json(page,'/api/projects');for(const p of snap.data.projects)await json(page,`/api/projects/${p.id}`,'DELETE');
  for(const [name,dir,tools,mode] of [['报告','commodities',[],'content'],['笔记','ai',['工具'],'content'],['构建','company/tool/dist',[],'single-tool']] as const){const r=await json(page,'/api/projects','POST',{name,mount:{label:name,absolutePath:path.join(temp,dir),toolDirectories:tools,mode}});expect(r.status).toBe(200);}
  await expect(page.locator('.entry').filter({hasText:'文本清理器'})).toBeVisible();await page.locator('.entry').filter({hasText:'文本清理器'}).click();const frame=page.frameLocator('iframe');await frame.locator('#input').fill('保留我的输入');
  await fs.appendFile(path.join(temp,'ai','工具','cleaner','app.js'),'\n// changed');await expect(page.getByRole('status')).toContainText('有新版本');await expect(frame.locator('#input')).toHaveValue('保留我的输入');
  await fs.writeFile(path.join(temp,'commodities','new.html'),'<title>动态新报告</title><h1>新增无需重建</h1>');await expect(page.locator('.entry').filter({hasText:'动态新报告'})).toBeVisible();await expect(frame.locator('#input')).toHaveValue('保留我的输入');
  await page.locator('.entry').filter({hasText:'动态新报告'}).click();await expect(page.frameLocator('iframe').locator('h1')).toHaveText('新增无需重建');await fs.writeFile(path.join(temp,'commodities','new.html'),'<title>动态新报告</title><h1>报告自动更新成功</h1>');await expect(page.frameLocator('iframe').locator('h1')).toHaveText('报告自动更新成功');
  await page.getByRole('button',{name:'更多设置'}).click();await page.getByLabel('自动更新').uncheck();await fs.writeFile(path.join(temp,'commodities','new.html'),'<title>动态新报告</title><h1>提示模式内容</h1>');await expect(page.getByRole('status')).toContainText('有新版本');await expect(page.frameLocator('iframe').locator('h1')).toHaveText('报告自动更新成功');
  await page.locator('.entry').filter({hasText:'单位换算器'}).click();await page.frameLocator('iframe').locator('#tonnes').fill('8');const dist=path.join(temp,'company','tool','dist');await fs.rm(dist,{recursive:true});await expect(page.locator('.catalog')).toContainText('离线');await expect(page.frameLocator('iframe').locator('#tonnes')).toHaveValue('8');await fs.cp(path.resolve('examples/company/tool/dist'),dist,{recursive:true});await expect(page.locator('.entry').filter({hasText:'单位换算器'})).toBeVisible();await expect(page.getByRole('status')).toBeVisible();await expect(page.frameLocator('iframe').locator('#tonnes')).toHaveValue('8');await page.getByRole('button',{name:'加载更新'}).click();await expect(page.frameLocator('iframe').locator('#tonnes')).toHaveValue('2.5');
  await page.locator('.entry').filter({hasText:'notes.md'}).click();await expect(page.locator('.markdown h1')).toHaveText('AI 行业演示笔记');await expect(page.locator('.markdown table')).toBeVisible();await expect(page.getByRole('link',{name:'来源链接示例'})).toHaveAttribute('target','_blank');await page.getByRole('link',{name:'跳转到约定'}).click();await expect(page.locator('#约定')).toBeVisible();
  await page.locator('.entry').filter({hasText:'raw.json'}).click();await expect(page.locator('.reader pre')).toContainText('900719925474099312345');await page.getByRole('button',{name:'沉浸',exact:true}).click();await expect(page.locator('aside')).toBeHidden();await expect(page.locator('.catalog')).toBeHidden();
});

