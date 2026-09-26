import { test,expect,type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
let root:string;
async function json(page:Page,url:string,method='GET',body?:unknown){return page.evaluate(async({url,method,body})=>{const response=await fetch(url,{method,headers:method==='GET'?{}:{'Content-Type':'application/json','X-Workbench':'1'},body:method==='GET'?undefined:JSON.stringify(body||{})});if(!response.ok)throw new Error(await response.text());return response.json();},{url,method,body});}
const region=(page:Page)=>page.getByRole('region',{name:'更新未读文件'});
test.beforeEach(async({page})=>{
  root=await fs.mkdtemp(path.join(os.tmpdir(),'agentdeck-unread-ui-'));await fs.mkdir(path.join(root,'deep'));
  await fs.writeFile(path.join(root,'deep','old.md'),'# 初始版本');
  await fs.writeFile(path.join(root,'page.html'),'<h1>初始网页</h1><input id="draft">');
  await page.goto('/');const state=await json(page,'/api/projects');for(const project of state.projects)await json(page,`/api/projects/${project.id}`,'DELETE');
  await json(page,'/api/file-updates/filter','PUT',{filter:{mode:'allow',extensions:['.md','.html','.pdf'],custom:[]}});
  await json(page,'/api/projects','POST',{name:'更新测试',mount:{label:'资料',absolutePath:root}});
  await expect.poll(async()=>(await json(page,'/api/file-updates')).busy).toBe(false);
  await expect(region(page)).toContainText('暂无符合筛选的未读更新');
});
test.afterEach(async({page})=>{const state=await json(page,'/api/projects');for(const project of state.projects)await json(page,`/api/projects/${project.id}`,'DELETE');await json(page,'/api/file-updates/filter','PUT',{filter:{mode:'all',extensions:[],custom:[]}});await fs.rm(root,{recursive:true,force:true});});
test('unopened files appear, reading confirms the loaded version, unsupported files remain unread, mobile list fits',async({page})=>{
  await fs.writeFile(path.join(root,'deep','new.md'),'# 新报告');await fs.writeFile(path.join(root,'deep','old.md'),'# 更新报告');await fs.writeFile(path.join(root,'ignored.txt'),'ignored');
  await expect(region(page).getByRole('listitem')).toHaveCount(2,{timeout:10000});
  await expect(page.getByRole('treeitem',{name:'更新测试',exact:true})).toHaveAttribute('aria-expanded','false');
  await region(page).getByRole('button',{name:/新增 new.md/}).click();await expect(page.locator('.markdown h1')).toHaveText('新报告');
  await expect(region(page).getByRole('listitem')).toHaveCount(1);
  await fs.writeFile(path.join(root,'download.pdf'),'%PDF test');await expect(region(page).getByRole('listitem')).toHaveCount(2);
  await region(page).getByRole('button',{name:/新增 download.pdf/}).click();await expect(page.locator('.viewer').filter({visible:true})).toContainText('暂不支持文本预览');await expect(region(page).getByRole('listitem')).toHaveCount(2);
  await page.setViewportSize({width:500,height:900});if(!await region(page).isVisible())await page.getByRole('button',{name:'展开文件侧栏',exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/unread-mobile.png'});
  await region(page).getByRole('button',{name:'全部标为已读'}).click();await expect(region(page).getByRole('listitem')).toHaveCount(0);
});
test('updates preserve live HTML input until explicit open; latest HTML is acknowledged after load',async({page})=>{
  await page.getByRole('treeitem',{name:'更新测试',exact:true}).click();await page.getByRole('treeitem',{name:'page.html',exact:true}).click();
  await page.frameLocator('iframe').locator('#draft').fill('保留输入');
  await fs.writeFile(path.join(root,'page.html'),'<h1>新版网页</h1><input id="draft">');
  await expect(region(page).getByRole('listitem')).toHaveCount(1,{timeout:10000});await expect(page.frameLocator('iframe').locator('#draft')).toHaveValue('保留输入');
  await page.screenshot({path:'test-results/unread-desktop.png'});
  await region(page).getByRole('button',{name:/更新 page.html/}).click();await expect(page.frameLocator('iframe').locator('h1')).toHaveText('新版网页');
  await expect(region(page).getByRole('listitem')).toHaveCount(0);
});
test('shared filter and unread acknowledgements synchronize across pages and reload',async({page,context})=>{
  const other=await context.newPage();await other.goto('/');await expect(region(other)).toBeVisible();
  await fs.writeFile(path.join(root,'deep','new.md'),'# 新报告');await expect(region(page).getByRole('listitem')).toHaveCount(1,{timeout:10000});await expect(region(other).getByRole('listitem')).toHaveCount(1);
  await page.reload();await expect(region(page).getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button',{name:'文件类型筛选'}).click();await page.getByRole('group',{name:'文件类型筛选'}).getByRole('checkbox',{name:'.md · Markdown',exact:true}).uncheck();
  await expect(region(page).getByRole('listitem')).toHaveCount(0);await expect(region(other).getByRole('listitem')).toHaveCount(0);
  await page.getByRole('group',{name:'文件类型筛选'}).getByRole('checkbox',{name:'.md · Markdown',exact:true}).check();await expect(region(other).getByRole('listitem')).toHaveCount(1);
  await region(other).getByRole('button',{name:'标为已读：new.md'}).click();await expect(region(page).getByRole('listitem')).toHaveCount(0);await other.close();
});
