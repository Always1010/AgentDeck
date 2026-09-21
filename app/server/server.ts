import Fastify from 'fastify';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { Registry } from './registry.js';
import { PathPolicy, inside, relative, mime } from './path-policy.js';
import { AppError } from './errors.js';
import { projectInput, mountInput, type Mount, type RegistryData } from '../shared/model.js';

export async function createWorkbench(options: { stateDir: string; port: number; previewPort: number; webDir?: string; dev?: boolean }) {
  const registry = new Registry(path.resolve(options.stateDir)); await registry.load();
  const policy = new PathPolicy(registry.directory);
  const mainOrigin = `http://127.0.0.1:${options.port}`;
  const previewOrigin = `http://127.0.0.1:${options.previewPort}`;
  const main = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  const preview = Fastify({ logger: false });
  let onRegistryChange = async () => {};
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
        reply.header('Content-Security-Policy', `default-src 'self'; script-src 'self'${options.dev ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' ${previewOrigin} data:; frame-src ${previewOrigin}; connect-src 'self'${options.dev ? ' ws://127.0.0.1:*' : ''}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`);
        if (req.url.startsWith('/api/')) {
          const originHeader = req.headers.origin;
          const site = req.headers['sec-fetch-site'];
          if ((originHeader && originHeader !== mainOrigin) || site !== 'same-origin') throw new AppError('UNTRUSTED_ORIGIN', '仅允许主平台管理界面的同来源请求', 403);
          if (!['GET','HEAD'].includes(req.method) && (originHeader !== mainOrigin || req.headers['x-workbench'] !== '1' || !req.headers['content-type']?.startsWith('application/json'))) throw new AppError('CSRF_REJECTED', '管理变更需要同来源 JSON 请求', 403);
        }
      } else {
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
  async function changed<T>(fn: (draft: RegistryData) => T | Promise<T>) { const result = await registry.mutate(fn); await onRegistryChange(); return result; }
  main.get('/api/status', async () => ({ previewOrigin, revision: registry.data.revision, schemaVersion: 1 }));
  main.get('/api/projects', async () => ({ projects: [...registry.data.projects].sort((a,b) => a.order-b.order), mounts: registry.data.mounts, revision: registry.data.revision }));
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
    const patch = mountInput.partial().parse(req.body); const m = { ...current, ...patch };
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
  preview.route<{ Params: { id: string; '*': string } }>({ method: ['GET', 'HEAD'], url: '/m/:id/*', handler: async (req, reply) => {
    const m = mount(req.params.id); let rel = req.params['*']; let file = await policy.resolve(m, rel);
    if (file.stat.isDirectory()) {
      if (!req.url.split('?')[0].endsWith('/')) return reply.redirect(req.url.split('?')[0] + '/', 302);
      rel = rel ? `${rel.replace(/\/$/,'')}/index.html` : 'index.html'; file = await policy.resolve(m, rel);
    }
    reply.type(mime[path.extname(file.real).toLowerCase()]).header('Content-Length', file.stat.size);
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
  return { main, preview, registry, policy, mount, changed, mainOrigin, previewOrigin,
    setRegistryHandler(fn: () => Promise<void>) { onRegistryChange = fn; },
    async listen() { try { await preview.listen({ port: options.previewPort, host: '127.0.0.1' }); await main.listen({ port: options.port, host: '127.0.0.1' }); } catch (e) { await preview.close(); await main.close(); throw e; } },
    async close() { await vite?.close(); await Promise.all([main.close(), preview.close()]); }
  };
}
export type Workbench = Awaited<ReturnType<typeof createWorkbench>>;
