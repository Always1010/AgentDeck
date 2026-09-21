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
test.beforeAll(async()=>{temp=await fs.mkdtemp(path.join(os.tmpdir(),'agentdeck-browser-'));otherDisk=await fs.mkdtemp(path.join(process.cwd(),'test-fixtures-'));await fs.cp(path.resolve('examples'),temp,{recursive:true});await fs.cp(path.resolve('examples/company/tool/dist'),path.join(otherDisk,'built'),{recursive:true});});
test.afterAll(async()=>{await fs.rm(temp,{recursive:true,force:true});await fs.rm(otherDisk,{recursive:true,force:true});});
test('production: add real projects and run native and built tools',async({page})=>{
  await page.goto('/');const snapshot=await json(page,'/api/projects');for(const p of snapshot.data.projects)await json(page,`/api/projects/${p.id}`,'DELETE');await page.reload();
  await add(page,'大宗商品',path.join(temp,'commodities'));await add(page,'AI 行业',path.join(temp,'ai'),'content','工具');await add(page,'公司研究',path.join(otherDisk,'built'),'single-tool');
  await page.locator('.entry').filter({hasText:'文本清理器'}).click();let frame=page.frameLocator('iframe');await frame.locator('#input').fill('  hello    world  ');await frame.getByRole('button',{name:'整理空白'}).click();await expect(frame.locator('#output')).toHaveText('hello world');
  await page.locator('.entry').filter({hasText:'单位换算器'}).click();frame=page.frameLocator('iframe');await frame.locator('#tonnes').fill('3.4');await frame.getByRole('button',{name:'换算',exact:true}).click();await expect(frame.locator('#result')).toHaveText('3400 千克');
  await page.locator('.entry').filter({hasText:'铜市场 · 多文件演示'}).click();frame=page.frameLocator('iframe');await expect(frame.locator('#data')).toContainText('108');await expect(frame.locator('#data')).toContainText('CSV 已读取');await expect(frame.locator('img')).toBeVisible();
  expect((await json(page,'/api/projects')).data.projects).toHaveLength(3);
  const markdownBadge=page.locator('.entry').filter({hasText:'notes.md'}).locator('.badge');
  expect(await markdownBadge.evaluate(el=>el.getBoundingClientRect().height)).toBeLessThan(28);
  await page.screenshot({path:'test-results/workbench.png',fullPage:true});
  await page.setViewportSize({width:1080,height:1920});
  expect(await markdownBadge.evaluate(el=>el.getBoundingClientRect().height)).toBeLessThan(28);
  await expect(frame.locator('#data')).toContainText('CSV 已读取');
  await page.screenshot({path:'test-results/workbench-portrait.png',fullPage:true});
  await page.getByRole('button',{name:'沉浸',exact:true}).click();
  await page.screenshot({path:'test-results/workbench-immersive.png',fullPage:true});
});

test('production: append mount in UI, tree/search and overlapping tools registration',async({page})=>{
  await page.goto('/');const snap=await json(page,'/api/projects');for(const p of snap.data.projects)await json(page,`/api/projects/${p.id}`,'DELETE');await page.reload();
  const primary=path.join(temp,'manage-primary');const extra=path.join(temp,'manage-extra');await fs.mkdir(path.join(primary,'小应用'),{recursive:true});await fs.mkdir(extra,{recursive:true});await fs.writeFile(path.join(primary,'index.html'),'<title>第一个报告</title>');await fs.writeFile(path.join(primary,'小应用','native.html'),'<title>管理测试工具</title><input>');await fs.writeFile(path.join(extra,'index.html'),'<title>第二个报告</title>');
  await add(page,'多目录项目',primary);await page.locator('aside button').filter({hasText:'多目录项目'}).click();await page.getByRole('button',{name:'管理项目',exact:true}).click();await page.getByLabel('目录别名',{exact:true}).fill('附加目录');await page.getByLabel('真实绝对路径').fill(extra);await page.getByRole('button',{name:'确认范围并保存'}).click();await expect(page.locator('.overlay')).toHaveCount(0);await expect(page.locator('.entry').filter({hasText:'第二个报告'})).toContainText('附加目录');
  await page.getByLabel('搜索',{exact:true}).fill('第二个');await expect(page.locator('.entry')).toHaveCount(1);await page.getByLabel('搜索',{exact:true}).fill('');await page.locator('.directory-section > summary').click();const tree=page.locator('.mount-tree').nth(1);await tree.locator('summary').click();await tree.getByRole('button',{name:'展开目录'}).click();await expect(tree.getByRole('button',{name:'index.html',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'管理项目',exact:true}).click();await page.getByLabel('真实绝对路径').fill(path.join(primary,'小应用'));await page.getByRole('button',{name:'确认范围并保存'}).click();await expect(page.locator('.dialog [role=alert]')).toContainText('已包含');await page.getByRole('button',{name:'标记为已有挂载的工具目录'}).click();await expect(page.locator('.overlay')).toHaveCount(0);await page.getByLabel('类型筛选').selectOption('tool');await expect(page.locator('.entry')).toHaveCount(1);await expect(page.locator('.entry')).toContainText('管理测试工具');expect((await json(page,'/api/projects')).data.mounts).toHaveLength(2);
});

test('production: project management entry removes registration but keeps source files',async({page})=>{
  await page.setViewportSize({width:1440,height:900});await page.goto('/');
  const snap=await json(page,'/api/projects');for(const p of snap.data.projects)await json(page,`/api/projects/${p.id}`,'DELETE');await page.reload();
  const removeDir=path.join(temp,'remove-project');const keepDir=path.join(temp,'keep-project');await fs.mkdir(removeDir,{recursive:true});await fs.mkdir(keepDir,{recursive:true});
  await fs.writeFile(path.join(removeDir,'report.html'),'<title>待移除报告</title>');await fs.writeFile(path.join(keepDir,'report.html'),'<title>保留报告</title>');
  await add(page,'待移除',removeDir);await add(page,'保留',keepDir);
  await page.setViewportSize({width:800,height:900});
  await page.getByRole('combobox',{name:'切换项目'}).selectOption({label:'待移除'});
  await page.getByRole('button',{name:'管理项目',exact:true}).click();
  await expect(page.getByLabel('项目名称',{exact:true})).toHaveValue('待移除');
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.setViewportSize({width:1440,height:900});
  await page.locator('.entry').filter({hasText:'待移除报告'}).click();
  await page.getByRole('button',{name:'管理项目：待移除'}).click();
  await expect(page.getByRole('dialog',{name:'管理项目与挂载'})).toBeVisible();
  page.once('dialog',dialog=>void dialog.dismiss());await page.getByRole('button',{name:'移除项目',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'管理项目与挂载'})).toBeVisible();
  page.once('dialog',dialog=>void dialog.accept());await page.getByRole('button',{name:'移除项目',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'管理项目与挂载'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'管理项目：待移除'})).toHaveCount(0);
  await expect(page.locator('.entry').filter({hasText:'保留报告'})).toBeVisible();
  await expect(page.locator('.entry').filter({hasText:'待移除报告'})).toHaveCount(0);
  await expect(page.locator('.viewer iframe')).toHaveCount(0);
  const after=(await json(page,'/api/projects')).data;
  expect(after.projects.map((p:{name:string})=>p.name)).toEqual(['保留']);
  expect(after.mounts).toHaveLength(1);
  expect(await fs.readFile(path.join(removeDir,'report.html'),'utf8')).toContain('待移除报告');
});

test('production: real browser isolation, hostile Markdown, text limits, picker and cross-drive',async({page,context})=>{
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto('/');const snap=await json(page,'/api/projects');for(const p of snap.data.projects)await json(page,`/api/projects/${p.id}`,'DELETE');
  const root=path.join(otherDisk,'cross-drive');await fs.mkdir(root,{recursive:true});
  if(process.platform==='win32')await fs.copyFile(path.join(process.env.SystemRoot||'C:\\Windows','Fonts','arial.ttf'),path.join(root,'font.ttf'));
  await fs.writeFile(path.join(root,'probe.html'),`<title>隔离验证</title><style>@font-face{font-family:Fixture;src:url('./font.ttf')}body{font-family:Fixture,serif}</style><output id="result">running</output><script>Promise.all(['/api/projects','/api/fs/locations','/api/events'].map(p=>fetch('http://127.0.0.1:4410'+p).then(()=> 'unexpected').catch(()=> 'blocked'))).then(v=>document.querySelector('#result').textContent=v.join(','));try{top.location.href='http://127.0.0.1:4410/?hijacked=1'}catch(e){document.body.dataset.top='blocked'}</script>`);
  await fs.writeFile(path.join(root,'bad.md'),'# 安全笔记\n\n<script>window.pwned=1</script>\n\n[危险](javascript:alert(1))\n\n[越界](../../outside.txt)\n\n[正常子页](./second.md)\n\n![本地图片](./image.svg)\n');
  await fs.writeFile(path.join(root,'second.md'),'# 子页');await fs.writeFile(path.join(root,'image.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>');await fs.writeFile(path.join(root,'large.md'),'a'.repeat(10*1024*1024+1));
  await page.getByRole('button',{name:'＋ 添加项目',exact:true}).click();await page.getByLabel('项目名称',{exact:true}).fill('跨盘验证');await page.getByRole('button',{name:'选择本机文件夹'}).click();await page.getByLabel('当前位置',{exact:true}).fill(root);await page.getByRole('button',{name:'前往',exact:true}).click();await expect(page.getByLabel('当前位置',{exact:true})).toHaveValue(root);await page.getByRole('button',{name:'选择此目录'}).click();await page.getByRole('button',{name:'确认范围并保存'}).click();await expect(page.locator('.overlay')).toHaveCount(0);
  const statuses:number[]=[];page.on('requestfailed',r=>{if(['/api/projects','/api/fs/locations','/api/events'].some(p=>r.url().endsWith(p)))statuses.push(1);});
  await page.locator('.entry').filter({hasText:'隔离验证'}).click();await expect(page.frameLocator('iframe').locator('#result')).toHaveText('blocked,blocked,blocked');await expect.poll(()=>statuses.length).toBe(3);expect(page.url()).not.toContain('hijacked');await expect(page.frameLocator('iframe').locator('body')).toHaveAttribute('data-top','blocked');
  if(process.platform==='win32')expect(await page.frames().find(f=>f.url().includes('probe.html'))!.evaluate(async()=> (await document.fonts.load('16px Fixture')).length)).toBe(1);
  await page.locator('.entry').filter({hasText:'bad.md'}).click();await expect(page.locator('.markdown h1')).toHaveText('安全笔记');expect(await page.evaluate(()=>('pwned' in window))).toBe(false);await expect(page.getByText('危险',{exact:true})).not.toHaveAttribute('href',/javascript/);await expect(page.getByText('越界',{exact:true})).not.toHaveAttribute('href',/outside/);await expect.poll(()=>page.locator('.markdown img').evaluate((img:HTMLImageElement)=>img.naturalWidth)).toBe(20);await page.getByRole('link',{name:'正常子页'}).click();await expect(page.locator('.markdown h1')).toHaveText('子页');
  await page.locator('.entry').filter({hasText:'large.md'}).click();await expect(page.locator('.viewer [role=alert]')).toContainText('10 MiB');await expect(page.getByRole('link',{name:'下载原文件',exact:true})).toBeVisible();
  const cMount=await json(page,'/api/projects','POST',{name:'C 盘项目',mount:{label:'C 盘',absolutePath:path.join(temp,'ai'),toolDirectories:['工具']}});expect(cMount.status).toBe(200);
  const current=(await json(page,'/api/projects')).data;const crossDrive=path.parse(temp).root!==path.parse(otherDisk).root;if(crossDrive)expect(new Set(current.mounts.map((m:{absolutePath:string})=>path.parse(m.absolutePath).root)).size).toBe(2);else test.info().annotations.push({type:'untested',description:'本机未提供两个可写盘符，跨盘部分未执行'});
  await page.locator('.entry').filter({hasText:'文本清理器'}).click();await page.frameLocator('iframe').locator('#input').fill('离线资源验证');await page.frameLocator('iframe').getByRole('button',{name:'整理空白'}).click();await expect(page.frameLocator('iframe').locator('#output')).toHaveText('离线资源验证');
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
  await expect(page.locator('.entry').filter({hasText:'raw.json'})).toHaveCount(0);await page.getByRole('button',{name:'沉浸',exact:true}).click();await expect(page.locator('aside')).toBeHidden();await expect(page.locator('.catalog')).toBeHidden();
});
