import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
let root:string;
async function json(page:Page,url:string,method='GET',body?:unknown){return page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:method==='GET'?{}:{'Content-Type':'application/json','X-Workbench':'1'},body:method==='GET'?undefined:JSON.stringify(body||{})});if(!r.ok)throw new Error(await r.text());return r.json();},{url,method,body});}
test.beforeAll(async()=>{root=await fs.mkdtemp(path.join(os.tmpdir(),'agentdeck-tools-ui-'));await fs.writeFile(path.join(root,'merge.html'),'<input id="draft"><p>报表合并</p>');await fs.writeFile(path.join(root,'notes.md'),'# 说明');});
test.afterAll(async()=>{await fs.rm(root,{recursive:true,force:true});});
test.beforeEach(async({page})=>{await page.goto('/');for(const tool of await json(page,'/api/tools'))await json(page,`/api/tools/${encodeURIComponent(tool.id)}`,'DELETE');const s=await json(page,'/api/projects');for(const p of s.projects)await json(page,`/api/projects/${p.id}`,'DELETE');await json(page,'/api/projects','POST',{name:'工具项目',mount:{label:'工具目录',absolutePath:root}});});
test('add an HTML tool from preview; favorites remain independent and iframe input survives classification',async({page})=>{
 await page.getByRole('treeitem',{name:'工具项目',exact:true}).click();await page.getByRole('treeitem',{name:'merge.html',exact:true}).click();const input=page.frameLocator('iframe').locator('#draft');await input.fill('保留输入');await page.getByRole('button',{name:'收藏：merge.html',exact:true}).click();
 await page.getByRole('button',{name:'更多设置'}).click();await page.getByRole('button',{name:'添加到工具',exact:true}).click();await page.getByRole('button',{name:'更多设置'}).click();await expect(page.getByRole('button',{name:'从工具移除',exact:true})).toBeVisible();await expect(input).toHaveValue('保留输入');
 await page.getByRole('button',{name:'工具',exact:true}).click();await expect(page.getByRole('treeitem',{name:'merge.html',exact:true})).toBeVisible();await expect(page.locator('.file-row:visible').filter({hasText:'merge.html'})).toHaveCount(1);
 await page.reload();await page.getByRole('button',{name:'工具',exact:true}).click();await page.getByRole('treeitem',{name:'merge.html',exact:true}).click();await expect(page.frameLocator('iframe').locator('p')).toHaveText('报表合并');await page.getByRole('button',{name:'移除工具：merge.html'}).click();await expect(page.getByRole('treeitem',{name:'merge.html',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'收藏',exact:true}).click();await expect(page.getByRole('treeitem',{name:'merge.html',exact:true})).toBeVisible();expect(await fs.readFile(path.join(root,'merge.html'),'utf8')).toContain('报表合并');
});
test('tool list plus selects only HTML and persists a custom name',async({page})=>{
 const snapshot=await json(page,'/api/projects');for(const project of snapshot.projects)await json(page,`/api/projects/${project.id}`,'DELETE');
 await page.getByRole('button',{name:'工具',exact:true}).click();await page.getByRole('button',{name:'添加工具',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'添加工具',exact:true});await expect(dialog.locator('select')).toHaveCount(0);
 await page.emulateMedia({colorScheme:'dark'});await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await page.screenshot({path:'test-results/tools-add.png'});
 await dialog.getByRole('button',{name:'选择 HTML 文件',exact:true}).click();const picker=page.getByRole('dialog',{name:'选择本机 HTML 文件'});
 await picker.getByLabel('当前位置').fill(root);await picker.getByRole('button',{name:'前往此路径'}).click();
 await expect(picker.getByText('notes.md',{exact:true})).toHaveCount(0);await picker.getByRole('button',{name:'选择文件：merge.html',exact:true}).click();await page.screenshot({path:'test-results/tools-picker.png'});await picker.getByRole('button',{name:'选择文件',exact:true}).click();
 await expect(dialog.getByLabel('HTML 文件',{exact:true})).toHaveValue(await fs.realpath(path.join(root,'merge.html')));await expect(dialog.getByLabel('工具名称')).toHaveValue('merge');
 await dialog.getByLabel('工具名称').fill('报表合并');await dialog.getByRole('button',{name:'添加工具',exact:true}).click();await expect(dialog).toHaveCount(0);
 await page.getByRole('treeitem',{name:'报表合并',exact:true}).click();await expect(page.frameLocator('iframe').locator('p')).toHaveText('报表合并');
 await page.reload();await page.getByRole('button',{name:'工具',exact:true}).click();await expect(page.getByRole('treeitem',{name:'报表合并',exact:true})).toBeVisible();
 expect((await json(page,'/api/projects')).mounts).toEqual([]);await page.screenshot({path:'test-results/tools-list.png'});
});

test('pasted paths deduplicate without replacing a custom title and moved files can be selected again',async({page})=>{
 const standalone=path.join(root,'独立 工具');await fs.mkdir(standalone,{recursive:true});
 const file=path.join(standalone,'index.htm'),moved=path.join(standalone,'moved.htm');await fs.writeFile(file,'<input id="draft"><p>独立页面</p>');
 await page.getByRole('button',{name:'工具',exact:true}).click();await page.getByRole('button',{name:'添加工具',exact:true}).click();
 let dialog=page.getByRole('dialog',{name:'添加工具',exact:true});await dialog.getByLabel('HTML 文件',{exact:true}).fill(file);await expect(dialog.getByLabel('工具名称')).toHaveValue('独立 工具');await dialog.getByLabel('工具名称').fill('自定义工具');await dialog.getByRole('button',{name:'添加工具',exact:true}).click();await expect(dialog).toHaveCount(0);
 const registered=(await json(page,'/api/tools')).find((tool:{title:string})=>tool.title==='自定义工具');
 await page.getByRole('button',{name:'添加工具',exact:true}).click();dialog=page.getByRole('dialog',{name:'添加工具',exact:true});await dialog.getByLabel('HTML 文件',{exact:true}).fill(`"${file}"`);await dialog.getByRole('button',{name:'添加工具',exact:true}).click();await expect(dialog).toHaveCount(0);
 await expect(page.getByRole('treeitem',{name:'自定义工具',exact:true})).toHaveCount(1);await expect(page.frameLocator('iframe').locator('p')).toHaveText('独立页面');
 await fs.rename(file,moved);await page.reload();await page.getByRole('button',{name:'工具',exact:true}).click();
 await expect(page.getByRole('treeitem',{name:/^自定义工具/}).getByText('不可用',{exact:true})).toBeVisible();await page.getByRole('button',{name:'重新选择文件：自定义工具',exact:true}).click();
 const repair=page.getByRole('dialog',{name:'重新选择工具文件',exact:true});await repair.getByLabel('HTML 文件',{exact:true}).fill(moved);await repair.getByRole('button',{name:'保存路径'}).click();await expect(repair).toHaveCount(0);
 await page.getByRole('treeitem',{name:'自定义工具',exact:true}).click();await expect(page.frameLocator('iframe').locator('p')).toHaveText('独立页面');
 expect((await json(page,'/api/tools')).find((tool:{title:string})=>tool.title==='自定义工具').id).toBe(registered.id);
});
