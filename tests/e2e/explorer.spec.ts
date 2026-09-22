import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
let root:string;
async function json(page:Page,url:string,method='GET',body?:unknown){return page.evaluate(async({url,method,body})=>{const r=await fetch(url,{method,headers:method==='GET'?{}:{'Content-Type':'application/json','X-Workbench':'1'},body:method==='GET'?undefined:JSON.stringify(body||{})});if(!r.ok)throw new Error(await r.text());return r.json();},{url,method,body});}
test.beforeAll(async()=>{root=await fs.mkdtemp(path.join(os.tmpdir(),'agentdeck-explorer-'));await fs.mkdir(path.join(root,'templates','deep'),{recursive:true});await fs.writeFile(path.join(root,'templates','part.html'),'<title>{{Library}}</title>');await fs.writeFile(path.join(root,'templates','inside.md'),'# 内层文档');await fs.writeFile(path.join(root,'index.html'),'<title>工作区</title><input id="draft"><div style="height:5000px">长内容</div>');await fs.writeFile(path.join(root,'readme.md'),'# 项目说明\n\n文件浏览测试');await fs.writeFile(path.join(root,'data.csv'),'name,value\na,1');await fs.writeFile(path.join(root,'script.py'),'print("只读代码")');await fs.writeFile(path.join(root,'notes.LOG'),'保留日志');await fs.writeFile(path.join(root,'LICENSE'),'许可证');for(let n=0;n<40;n++)await fs.writeFile(path.join(root,`report-${n}.html`),'<h1>报告</h1>');});
test.afterAll(async()=>{await fs.rm(root,{recursive:true,force:true});});
test.beforeEach(async({page})=>{await page.setViewportSize({width:1440,height:900});await page.goto('/');const s=await json(page,'/api/projects');for(const p of s.projects)await json(page,`/api/projects/${p.id}`,'DELETE');await json(page,'/api/projects','POST',{name:'研究资料',mount:{label:'资料',absolutePath:root}});await expect(page.getByRole('treeitem',{name:'研究资料',exact:true})).toBeVisible();});
test('one click lists one level; filtering does not descend; code opens as text',async({page})=>{
 const reads:string[]=[];page.on('request',r=>{if(r.url().includes('/tree'))reads.push(r.url());});
 const project=page.getByRole('treeitem',{name:'研究资料',exact:true});await project.click();
 await expect(page.getByRole('treeitem',{name:'index.html',exact:true})).toBeVisible();await expect(page.getByText('展开目录',{exact:true})).toHaveCount(0);
 expect(reads.some(x=>x.includes('path=templates'))).toBe(false);
 await page.getByRole('treeitem',{name:'templates',exact:true}).click();await expect(page.getByRole('treeitem',{name:'part.html',exact:true})).toBeVisible();expect(reads.some(x=>x.includes('path=templates%2Fdeep'))).toBe(false);
 await page.getByLabel('筛选文件').fill('part');await expect(page.getByRole('treeitem',{name:'part.html',exact:true})).toBeVisible();await expect(page.getByRole('treeitem',{name:'index.html',exact:true})).toHaveCount(0);await page.getByLabel('筛选文件').fill('');
 await page.getByRole('treeitem',{name:'script.py',exact:true}).click();await expect(page.locator('.reader pre')).toContainText('只读代码');
 await page.getByRole('treeitem',{name:'readme.md',exact:true}).click();await expect(page.locator('.markdown h1')).toHaveText('项目说明');
});
test('type black and white lists hide only tree files, keep folders and persist',async({page})=>{
 const reads:string[]=[];page.on('request',request=>{if(request.url().includes('/tree?'))reads.push(request.url());});
 await page.getByRole('treeitem',{name:'研究资料',exact:true}).click();
 await page.getByRole('treeitem',{name:'index.html',exact:true}).click();
 await page.getByRole('button',{name:'收藏：index.html'}).click();
 const draft=page.frameLocator('iframe').locator('#draft');await draft.fill('筛选时保留');
 const loaded=reads.length;
 await page.getByRole('button',{name:'文件类型筛选'}).click();
 const panel=page.getByRole('group',{name:'文件类型筛选'});
 await panel.getByRole('radio',{name:'黑名单'}).check();
 await panel.getByRole('checkbox',{name:'.html · HTML'}).check();
 await expect(page.getByRole('treeitem',{name:'index.html',exact:true})).toHaveCount(0);
 await expect(page.getByRole('treeitem',{name:'readme.md',exact:true})).toBeVisible();
 await expect(page.getByRole('treeitem',{name:'templates',exact:true})).toBeVisible();
 await expect(draft).toHaveValue('筛选时保留');
 expect(reads).toHaveLength(loaded);
 await panel.getByRole('button',{name:'关闭文件类型筛选'}).click();
 await page.getByRole('treeitem',{name:'templates',exact:true}).click();
 await expect(page.getByRole('treeitem',{name:'part.html',exact:true})).toHaveCount(0);
 await expect(page.getByRole('treeitem',{name:'inside.md',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'文件类型筛选'}).click();
 await panel.getByRole('button',{name:'清空选择'}).click();
 await panel.getByRole('radio',{name:'白名单'}).check();
 await panel.getByRole('checkbox',{name:'.md · Markdown',exact:true}).check();
 await expect(page.getByRole('treeitem',{name:'readme.md',exact:true})).toBeVisible();
 await expect(page.getByRole('treeitem',{name:'script.py',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'关闭文件类型筛选'}).click();
 await page.reload();await expect(page.getByRole('treeitem',{name:'研究资料',exact:true})).toHaveAttribute('aria-expanded','true');
 await expect(page.getByRole('treeitem',{name:'readme.md',exact:true})).toBeVisible();
 await expect(page.getByRole('treeitem',{name:'index.html',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'收藏',exact:true}).click();
 await expect(page.getByRole('treeitem',{name:'index.html',exact:true})).toBeVisible();
});
test('custom suffixes, extensionless files and invalid entries are handled in the filter',async({page})=>{
 await page.getByRole('treeitem',{name:'研究资料',exact:true}).click();
 await page.getByRole('button',{name:'文件类型筛选'}).click();
 const panel=page.getByRole('group',{name:'文件类型筛选'});
 await panel.getByRole('radio',{name:'白名单'}).check();
 await expect(page.getByRole('treeitem',{name:'notes.LOG',exact:true})).toHaveCount(0);
 await panel.getByRole('textbox',{name:'自定义后缀',exact:true}).fill('*.LOG');
 await panel.getByRole('button',{name:'添加',exact:true}).click();
 await expect(page.getByRole('treeitem',{name:'notes.LOG',exact:true})).toBeVisible();
 await panel.getByRole('checkbox',{name:'无后缀'}).check();
 await expect(page.getByRole('treeitem',{name:'LICENSE',exact:true})).toBeVisible();
 await panel.getByRole('textbox',{name:'自定义后缀',exact:true}).fill('../log');
 await panel.getByRole('button',{name:'添加',exact:true}).click();
 await expect(panel.getByRole('alert')).toContainText('有效后缀');
 await panel.getByRole('button',{name:'移除自定义后缀 .log'}).click();
 await expect(page.getByRole('treeitem',{name:'notes.LOG',exact:true})).toHaveCount(0);
 await expect(page.getByRole('treeitem',{name:'LICENSE',exact:true})).toBeVisible();
 await page.setViewportSize({width:500,height:900});
 await expect(panel).toHaveCount(0);
 await page.getByRole('button',{name:'文件类型筛选'}).click();
 const box=await panel.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(500);
});
test('portrait stays left, rows are compact, immersion and layout preserve iframe input and scroll',async({page})=>{
 await page.getByRole('treeitem',{name:'研究资料',exact:true}).click();await page.getByRole('treeitem',{name:'index.html',exact:true}).click();const input=page.frameLocator('iframe').locator('#draft');await input.fill('保持输入');const frame=page.frames().find(f=>f.url().includes('/m/'))!;await frame.evaluate(()=>window.scrollTo(0,300));
 for(const [width,height] of [[1920,1080],[1080,1920],[900,1440]]){await page.setViewportSize({width,height});const sidebar=(await page.locator('.explorer').boundingBox())!;const viewer=(await page.locator('.workspace-pages').boundingBox())!;expect(viewer.x).toBeGreaterThan(sidebar.x+sidebar.width-1);expect(viewer.y).toBe(sidebar.y);expect((await page.locator('.file-row').first().boundingBox())!.height).toBe(28);await expect(input).toHaveValue('保持输入');expect(await frame.evaluate(()=>scrollY)).toBe(300);await page.screenshot({path:`test-results/explorer-${width}x${height}.png`});}
 await page.getByRole('button',{name:'沉浸',exact:true}).click();await expect(page.locator('.explorer')).toBeHidden();await page.getByRole('button',{name:'退出沉浸',exact:true}).click();await expect(input).toHaveValue('保持输入');await page.getByRole('button',{name:'刷新目录',exact:true}).click();await expect(input).toHaveValue('保持输入');
 await page.setViewportSize({width:500,height:900});await page.getByRole('treeitem',{name:'index.html',exact:true}).click();await expect(page.locator('.explorer')).toBeHidden();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('favorites survive reload without opening directories; old hashes migrate on directory read',async({page})=>{
 const s=await json(page,'/api/projects');const mount=s.mounts[0];const old=createHash('sha256').update(`${mount.id}\0readme.md`).digest('hex').slice(0,32);await page.evaluate(id=>localStorage.setItem('favorites',JSON.stringify([id])),old);await page.reload();await page.getByRole('treeitem',{name:'研究资料',exact:true}).click();await expect.poll(()=>page.evaluate(()=>localStorage.getItem('favorites'))).toContain('file:');
 await page.getByRole('button',{name:'收藏',exact:true}).click();await page.getByRole('treeitem',{name:'readme.md',exact:true}).click();await expect(page.locator('.markdown h1')).toHaveText('项目说明');await page.reload();await expect(page.locator('.markdown h1')).toHaveText('项目说明');await page.getByRole('button',{name:'文件',exact:true}).click();await expect(page.getByRole('treeitem',{name:'研究资料',exact:true})).toHaveAttribute('aria-expanded','true');
 await fs.rename(path.join(root,'readme.md'),path.join(root,'readme-away.md'));try{await page.getByRole('button',{name:'刷新',exact:true}).click();await expect(page.getByRole('alert')).toContainText('不存在');expect(await page.evaluate(()=>localStorage.getItem('favorites'))).toContain('readme.md');}finally{await fs.rename(path.join(root,'readme-away.md'),path.join(root,'readme.md'));}
});

test('upgrade snapshot migrates old favorites and links before expanding any directory',async({page})=>{
 const s=await json(page,'/api/projects');const mount=s.mounts[0];const old=createHash('sha256').update(`${mount.id}\0readme.md`).digest('hex').slice(0,32);const target=`file:${mount.id}:readme.md`;
 await page.route('**/api/legacy-files',route=>route.fulfill({json:{[old]:target}}));await page.evaluate(id=>localStorage.setItem('favorites',JSON.stringify([id])),old);let treeRequests=0;page.on('request',r=>{if(r.url().includes('/tree'))treeRequests++;});await page.goto('/?entry='+old);
 await expect(page.locator('.markdown h1')).toHaveText('项目说明');await expect.poll(()=>page.evaluate(()=>localStorage.getItem('favorites'))).toContain(target);expect(treeRequests).toBe(0);
 await page.getByRole('button',{name:'收藏',exact:true}).click();await fs.rename(path.join(root,'readme.md'),path.join(root,'readme-away.md'));try{await expect(page.locator('.file-row').filter({hasText:'readme.md'})).toContainText('不可用',{timeout:10000});}finally{await fs.rename(path.join(root,'readme-away.md'),path.join(root,'readme.md'));}
});
