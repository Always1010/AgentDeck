import Fastify from 'fastify';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { z, ZodError } from 'zod';
import { Registry } from './registry.js';
import { FileUpdates, filterSchema } from './updates.js';
import { fileVersion } from '../shared/updates.js';
import { PathPolicy, inside, relative, mime } from './path-policy.js';
import { AppError } from './errors.js';
import { describeFile, isTextFile, legacyIds } from './files.js';
import { parseFileReference } from '../shared/model.js';
import { readLegacyReferences } from './legacy-references.js';
import { listTools } from './tools.js';
import { bridgeScriptPath, htmlBridgeScript, prepareHtmlBridge } from './html-bridge.js';
import type { ServerResponse } from 'node:http';
import { projectInput, mountInput, mountPatch, preferenceSchema, overrideSchema, previewPath, type Mount, type RegistryData, type TreeItem } from '../shared/model.js';

export async function createWorkbench(options: { stateDir: string; port: number; previewPort: number; webDir?: string; dev?: boolean }) {
  const registry = new Registry(path.resolve(options.stateDir)); await registry.load();
  const policy = new PathPolicy(registry.directory);
  const mainOrigin = `http://127.0.0.1:${options.port}`;
  const previewOrigin = `http://127.0.0.1:${options.previewPort}`;
  const main = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  const preview = Fastify({ logger: false });
  const clients=new Set<ServerResponse>();
  const emit=(type:string,data:unknown)=>{for(const client of clients){if(client.writableLength>1024*1024){client.end();clients.delete(client);}else client.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);}};
  const updates=new FileUpdates(registry.directory,policy,()=>registry.data.mounts,()=>emit('file-updates',{}));
  await updates.load();
  const aliases = new Map<string, {mountId:string;relativePath:string}>();
  const legacyReferences = await readLegacyReferences(registry.directory);
  for (const [id, target] of Object.entries(legacyReferences)) aliases.set(id, parseFileReference(target)!);
  const mount = (id: string) => { const m = registry.data.mounts.find(m => m.id === id); if (!m) throw new AppError('MOUNT_NOT_FOUND', '挂载不存在', 404); return m; };
  for (const [app, origin] of [[main, mainOrigin], [preview, previewOrigin]] as const) {
    app.setErrorHandler((err, _req, reply) => {
      const e = err as AppError & NodeJS.ErrnoException;
      const code = e instanceof ZodError ? 'INVALID_INPUT' : e.code === 'ENOENT' ? 'ENTRY_MISSING' : e.code === 'EACCES' || e.code === 'EPERM' ? 'PERMISSION_DENIED' : e.code || 'INTERNAL_ERROR';
      const status = e instanceof ZodError ? 400 : e.statusCode || (e.code === 'ENOENT' ? 404 : code === 'PERMISSION_DENIED' ? 403 : 500);
      reply.code(status).send({ error: { code, message: e instanceof ZodError ? '输入格式不正确' : code === 'ENTRY_MISSING' ? '文件或目录不存在' : code === 'PERMISSION_DENIED' ? '目录权限不足' : status === 500 && !(e instanceof AppError) ? '服务内部错误' : e.message, ...e.details } });
    });
    app.addHook('onRequest', async (req, reply) => {
      if (req.headers.host !== new URL(origin).host) throw new AppError('INVALID_HOST', 'Host 不受信任，请通过 127.0.0.1 访问', 403);
      reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer').header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), usb=(), payment=()');
      if (app === main) {
        reply.header('Content-Security-Policy', `default-src 'self'; script-src 'self'${options.dev ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' ${previewOrigin} data:; frame-src ${previewOrigin}; connect-src 'self' ${previewOrigin}${options.dev ? ' ws://127.0.0.1:*' : ''}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`);
        if (req.url.startsWith('/api/')) {
          const originHeader = req.headers.origin;
          const site = req.headers['sec-fetch-site'];
          if ((originHeader && originHeader !== mainOrigin) || site !== 'same-origin') throw new AppError('UNTRUSTED_ORIGIN', '仅允许主平台管理界面的同来源请求', 403);
          if (!['GET','HEAD'].includes(req.method) && (originHeader !== mainOrigin || req.headers['x-workbench'] !== '1' || !req.headers['content-type']?.startsWith('application/json'))) throw new AppError('CSRF_REJECTED', '管理变更需要同来源 JSON 请求', 403);
        }
      } else {
        if(req.headers.origin===mainOrigin) reply.header('Access-Control-Allow-Origin',mainOrigin).header('Vary','Origin');
        reply.header('Content-Security-Policy', `default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; object-src 'none'; base-uri 'self'; frame-ancestors ${mainOrigin}; form-action 'none'; worker-src 'none'; sandbox allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads`);
      }
    });
  }
  async function validateMount(input: Mount, draft: RegistryData) {
    input.absolutePath = await policy.root(input.absolutePath);
    for (const r of [...input.toolDirectories, ...input.excludes]) relative(r, false);
    relative(input.entry, false);
    if (!/\.html?$/i.test(input.entry)) throw new AppError('INVALID_ENTRY', '工具入口必须是 HTML');
    if (input.toolDirectories.some((a, i) => input.toolDirectories.some((b, j) => i !== j && (a === b || a.startsWith(`${b}/`))))) throw new AppError('OVERLAPPING_TOOLS', '工具子目录不能重叠');
    const overlap = draft.mounts.find(m => m.projectId === input.projectId && m.id !== input.id && (inside(m.absolutePath, input.absolutePath) || inside(input.absolutePath, m.absolutePath)));
    if (overlap) throw new AppError('OVERLAPPING_MOUNT', '该目录已包含在项目中；可在已有挂载中标记为工具目录', 409, { mountId: overlap.id, toolDirectory: path.relative(overlap.absolutePath, input.absolutePath).split(path.sep).join('/') });
  }
  async function changed<T>(fn: (draft: RegistryData) => T | Promise<T>) { const before=JSON.stringify(registry.data.mounts);const result = await registry.mutate(fn); if(before!==JSON.stringify(registry.data.mounts))updates.scheduleSync();emit('registry-changed',{revision:registry.data.revision}); return result; }
  main.get('/api/file-updates',async()=>updates.snapshot());
  main.put('/api/file-updates/filter',async req=>{
    const input=z.object({filter:filterSchema,initializeOnly:z.boolean().optional()}).parse(req.body);
    return updates.configure(input.filter,input.initializeOnly);
  });
  main.post('/api/file-updates/read',async req=>{
    const input=z.union([z.object({id:z.string().min(1),version:z.string().min(1)}).strict(),z.object({through:z.number().int().nonnegative()}).strict()]).parse(req.body);
    return updates.acknowledge(input);
  });
  main.get('/api/status', async () => ({ previewOrigin, revision: registry.data.revision, schemaVersion: 1, navigation: 'files' }));
  main.get('/api/legacy-files', async () => legacyReferences);
  main.get('/api/events',async(req,reply)=>{
    reply.hijack();reply.raw.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Connection':'keep-alive'});
    clients.add(reply.raw);reply.raw.write(`retry: 1000\nevent: resync\ndata: ${JSON.stringify({revision:registry.data.revision})}\n\n`);
    const heartbeat=setInterval(()=>reply.raw.write(': heartbeat\n\n'),15000);
    req.raw.on('close',()=>{clients.delete(reply.raw);clearInterval(heartbeat);});
  });
  main.get('/api/projects', async () => ({ projects: [...registry.data.projects].sort((a,b) => a.order-b.order), mounts: await Promise.all(registry.data.mounts.map(async m=>{if(!m.enabled)return {...m,status:'disabled'};try{await policy.root(m.absolutePath);return {...m,status:'online'};}catch(e){return {...m,status:'offline',error:(e as Error).message};}})), revision: registry.data.revision }));
  main.post('/api/projects', async req => {
    const body = req.body as Record<string, unknown>; const data = projectInput.parse(body);
    return changed(async d => {
      const p = { ...data, id: randomUUID(), order: data.order ?? d.projects.length };
      if (body.mount) { const m = { ...mountInput.parse(body.mount), id: randomUUID(), projectId: p.id }; await validateMount(m, d); d.mounts.push(m); }
      d.projects.push(p); return p;
    });
  });
  main.patch<{ Params: { id: string } }>('/api/projects/:id', async req => changed(d => { const p = d.projects.find(p => p.id === req.params.id); if (!p) throw new AppError('PROJECT_MISSING', '项目不存在', 404); Object.assign(p, projectInput.partial().parse(req.body)); return p; }));
  main.delete<{ Params: { id: string } }>('/api/projects/:id', async req => changed(d => { const ids = d.mounts.filter(m => m.projectId === req.params.id).map(m => m.id); d.projects = d.projects.filter(p => p.id !== req.params.id); d.mounts = d.mounts.filter(m => !ids.includes(m.id)); d.toolOverrides = d.toolOverrides.filter(o => !ids.includes(o.mountId)); return { ok: true }; }));
  main.post<{ Params: { id: string } }>('/api/projects/:id/mounts', async req => changed(async d => {
    if (!d.projects.some(p => p.id === req.params.id)) throw new AppError('PROJECT_MISSING', '项目不存在', 404);
    const m = { ...mountInput.parse(req.body), id: randomUUID(), projectId: req.params.id }; await validateMount(m, d); d.mounts.push(m); return m;
  }));
  main.patch<{ Params: { id: string } }>('/api/mounts/:id', async req => changed(async d => {
    const current = d.mounts.find(m => m.id === req.params.id); if (!current) throw new AppError('MOUNT_NOT_FOUND','挂载不存在',404);
    const patch = mountPatch.parse(req.body); const m = { ...current, ...patch };
    if (m.enabled || patch.absolutePath) await validateMount(m, d);
    Object.assign(current, m); return current;
  }));
  main.delete<{ Params: { id: string } }>('/api/mounts/:id', async req => changed(d => { d.mounts = d.mounts.filter(m => m.id !== req.params.id); d.toolOverrides = d.toolOverrides.filter(o => o.mountId !== req.params.id); return { ok: true }; }));
  main.get('/api/fs/locations', async () => {
    const candidates = process.platform === 'win32' ? Array.from({length:26},(_,i) => `${String.fromCharCode(65+i)}:\\`) : ['/'];
    const roots = (await Promise.all(candidates.map(async p => { try { await fs.access(p); return p; } catch { return null; } }))).filter(Boolean);
    return { locations: [...new Set([os.homedir(), process.cwd(), ...roots])] };
  });
  main.get<{ Querystring: { absolutePath: string } }>('/api/fs/directories', async req => {
    const value = req.query.absolutePath;
    if (!value || !path.isAbsolute(value) || value.startsWith('\\\\')) throw new AppError('INVALID_PATH','需要本机绝对路径');
    const current = await fs.realpath(value); const dirs = await fs.readdir(current, { withFileTypes: true });
    return { current, parent: path.dirname(current), directories: dirs.filter(d => d.isDirectory() && !d.isSymbolicLink() && !d.name.startsWith('.')).map(d => ({ name: d.name, path: path.join(current,d.name) })) };
  });
  async function entry(id:string) {
    const ref=parseFileReference(id)||aliases.get(id);
    if(!ref)throw new AppError('ENTRY_MISSING','旧链接尚未关联文件，请展开原目录后重试',404);
    const e=await describeFile(policy,registry.data,mount(ref.mountId),ref.relativePath);
    return {...e,previewUrl:previewOrigin+previewPath(e.mountId,e.relativePath)};
  }
  main.get<{Params:{id:string}}>('/api/entries/:id',async req=>entry(req.params.id));
  main.get('/api/tools', async () => listTools(registry.data, aliases));
  main.put('/api/tools', async req => {
    const input = z.object({ id: z.string().min(1), title: z.string().trim().min(1).max(200).optional() }).parse(req.body);
    const file = await entry(input.id);
    if (!/^html?$/.test(file.format)) throw new AppError('INVALID_TOOL', '请选择 HTML 网页作为工具', 400);
    return changed(d => {
      d.entryPreferences[file.id] = { ...d.entryPreferences[file.id], kind: 'tool', ...(input.title ? { title: input.title } : {}) };
      return { id: file.id };
    });
  });
  main.delete<{Params:{id:string}}>('/api/tools/:id', async req => {
    const ref = parseFileReference(req.params.id);
    if (!ref) throw new AppError('INVALID_TOOL', '无效的工具位置', 400);
    relative(ref.relativePath, false);
    return changed(d => { d.entryPreferences[req.params.id] = { ...d.entryPreferences[req.params.id], kind: 'html' }; return { ok: true }; });
  });
  main.patch<{Params:{id:string}}>('/api/entries/:id/preferences',async req=>{
    const prefs=preferenceSchema.parse(req.body);const e=await entry(req.params.id);
    return changed(d=>{d.entryPreferences[e.id]={...d.entryPreferences[e.id],...prefs};return {ok:true};});
  });
  main.put<{Params:{id:string}}>('/api/mounts/:id/tool-override',async req=>{
    const value=overrideSchema.parse({...req.body as object,mountId:req.params.id}); const m=mount(value.mountId);
    relative(value.toolRoot);relative(value.entry,false);
    if(!/\.html?$/i.test(value.entry)) throw new AppError('INVALID_ENTRY','请选择 HTML 入口');
    await policy.resolve(m,[value.toolRoot,value.entry].filter(Boolean).join('/'));
    return changed(d=>{d.toolOverrides=d.toolOverrides.filter(o=>!(o.mountId===value.mountId&&o.toolRoot===value.toolRoot));d.toolOverrides.push(value);return {ok:true};});
  });
  main.get<{Params:{id:string};Querystring:{path?:string}}>('/api/mounts/:id/tree',async req=>{
    const m=mount(req.params.id);const root=req.query.path||'';const dir=await policy.resolve(m,root,false,'file');if(!dir.stat.isDirectory())throw new AppError('INVALID_PATH','请选择目录',400);const result:TreeItem[]=[];
    for(const d of await fs.readdir(dir.real,{withFileTypes:true})){ const rel=[root,d.name].filter(Boolean).join('/'); try{const item=await policy.resolve(m,rel,false,'file');const oldIds=item.stat.isDirectory()?[]:legacyIds(m,rel,registry.data);for(const id of oldIds)aliases.set(id,{mountId:m.id,relativePath:rel});result.push({name:d.name,relativePath:rel,directory:item.stat.isDirectory(),...(!item.stat.isDirectory()?{legacyIds:oldIds}:{})});}catch{/* identical boundary for tree and serving */} }
    const rank=(name:string)=>/\.(html?|csv|md|markdown)$/i.test(name)?0:1;
    return result.sort((a,b)=>Number(b.directory)-Number(a.directory)||(!a.directory&&!b.directory?rank(a.name)-rank(b.name):0)||a.name.localeCompare(b.name,'zh-CN',{numeric:true}));
  });
  main.get<{Params:{id:string};Querystring:{path:string}}>('/api/mounts/:id/file',async req=>{
    const file=await policy.resolve(mount(req.params.id),req.query.path,false,'file');
    if(file.stat.isDirectory()) throw new AppError('INVALID_PATH','不能把目录作为文本读取');
    if(file.stat.size>10*1024*1024) throw new AppError('FILE_TOO_LARGE','文本超过 10 MiB，请使用下载入口',413);
    if(!isTextFile(file.real)) throw new AppError('NOT_TEXT','此文件不是支持的文本类型',415);
    const text=await fs.readFile(file.real,'utf8');const after=await fs.stat(file.real);
    return {text,size:file.stat.size,updatedAt:file.stat.mtimeMs,...(fileVersion(file.stat)===fileVersion(after)?{fileVersion:fileVersion(after)}:{})};
  });
  main.get<{Params:{id:string};Querystring:{path:string}}>('/api/mounts/:id/download',async(req,reply)=>{
    const file=await policy.resolve(mount(req.params.id),req.query.path,false,'file');
    if(file.stat.isDirectory()) throw new AppError('INVALID_PATH','不能下载目录');
    return reply.header('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file.real))}`).type('application/octet-stream').send(createReadStream(file.real));
  });
  preview.get(bridgeScriptPath, async (_req, reply) => reply.type('application/javascript; charset=utf-8').send(htmlBridgeScript(mainOrigin)));
  preview.route<{ Params: { id: string; '*': string } }>({ method: ['GET', 'HEAD'], url: '/m/:id/*', handler: async (req, reply) => {
    const m = mount(req.params.id); let rel = req.params['*']; let file = await policy.resolve(m, rel);
    if (file.stat.isDirectory()) {
      if (!req.url.split('?')[0].endsWith('/')) return reply.redirect(req.url.split('?')[0] + '/', 302);
      rel = rel ? `${rel.replace(/\/$/,'')}/index.html` : 'index.html'; file = await policy.resolve(m, rel);
    }
    const extension = path.extname(file.real).toLowerCase();
    const requestedVersion=new URL(req.url,previewOrigin).searchParams.get('fileVersion');
    if(requestedVersion&&requestedVersion!==fileVersion(file.stat))throw new AppError('FILE_CHANGED','文件已再次更新，请重新加载',409);
    if (extension === '.html' || extension === '.htm') {
      const html = await prepareHtmlBridge(file.real, file.stat.size);
      reply.type(html.contentType).header('Content-Length', html.contentLength);
      return req.method === 'HEAD' ? reply.send() : reply.send(html.stream());
    }
    reply.type(mime[extension]).header('Content-Length', file.stat.size);
    if(req.method==='HEAD')return reply.send();
    return reply.send(createReadStream(file.real));
  } });
  const webDir = options.webDir || path.resolve('dist/web');
  let vite: { close(): Promise<void> } | undefined;
  if (options.dev) {
    const { createServer } = await import('vite');
    const v = await createServer({ server: { middlewareMode: true, hmr: { port: options.port + 2, host: '127.0.0.1' } } }); vite = v;
    main.setNotFoundHandler((req, reply) => { if (req.url.startsWith('/api/')) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '接口不存在' } }); reply.hijack(); v.middlewares(req.raw, reply.raw); });
  } else {
    main.setNotFoundHandler(async (req, reply) => {
      if (req.method !== 'GET' || req.url.startsWith('/api/')) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '接口不存在' } });
      const pathname = new URL(req.url, mainOrigin).pathname;
      const candidate = pathname === '/' || pathname === '/preview' ? path.join(webDir,'index.html') : path.resolve(webDir, '.' + pathname);
      if (!inside(webDir, candidate)) return reply.code(404).send();
      try { const stat = await fs.stat(candidate); if (!stat.isFile()) return reply.code(404).send(); } catch { return reply.code(404).send(); }
      return reply.type(mime[path.extname(candidate)] || 'application/octet-stream').send(createReadStream(candidate));
    });
  }
  return { main, preview, registry, policy, mount, changed, updates, mainOrigin, previewOrigin,
    async listen() { try { await preview.listen({ port: options.previewPort, host: '127.0.0.1' }); await main.listen({ port: options.port, host: '127.0.0.1' }); } catch (e) { await updates.close();await vite?.close();await preview.close(); await main.close(); throw e; } },
    async close() { for(const c of clients)c.end();clients.clear();await updates.close();await vite?.close(); await Promise.all([main.close(), preview.close()]); }
  };
}
export type Workbench = Awaited<ReturnType<typeof createWorkbench>>;
