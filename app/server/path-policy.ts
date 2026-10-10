import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AppError } from './errors.js';
import type { Mount } from '../shared/model.js';

export const mime: Record<string, string> = { '.html':'text/html; charset=utf-8', '.htm':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.csv':'text/plain; charset=utf-8', '.txt':'text/plain; charset=utf-8', '.md':'text/plain; charset=utf-8', '.markdown':'text/plain; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.webp':'image/webp', '.ico':'image/x-icon', '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf', '.otf':'font/otf', '.wasm':'application/wasm', '.pdf':'application/pdf', '.mp4':'video/mp4', '.mp3':'audio/mpeg' };
export const inside = (root: string, target: string) => { const rel = path.relative(root, target); return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel)); };
/** Validate the original spelling before normalization can hide a remote/device path or ADS. */
export function localAbsolute(value: string) {
  const normalized = typeof value === 'string' ? value.replace(/\\/g, '/') : '';
  if (!normalized || normalized.startsWith('//') || normalized.includes('\0') || !path.isAbsolute(value) ||
    (process.platform === 'win32' && (!/^[a-z]:\//i.test(normalized) || normalized.slice(2).includes(':')))) {
    throw new AppError('INVALID_PATH', '请填写本机磁盘绝对路径，不支持 UNC、设备路径或备用数据流');
  }
  return path.resolve(value);
}
export function relative(value: string, allowEmpty = true) {
  if (typeof value !== 'string' || (!value && !allowEmpty) || value.includes('\\') || value.includes(':') || value.includes('\0') || value.startsWith('/') || value.split('/').some(s => s === '..' || s === '.' || /[. ]$/.test(s))) throw new AppError('INVALID_PATH', '需要安全的相对路径，不能越界');
  return value.replace(/\/$/, '');
}
export function hidden(rel: string, excludes: string[] = [], internalPackage = false) {
  const key=process.platform==='win32'?rel.toLowerCase():rel;
  return rel.split('/').some(s => s.startsWith('.') || /^(node_modules|__pycache__|coverage|credentials|secrets)$/i.test(s) || /(?:\.lock|\.pem|\.key|\.pfx|\.p12|\.tmp|\.bak|~)$/i.test(s) || /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|id_rsa|id_ed25519)$/i.test(s) || (!internalPackage && s.toLowerCase() === 'package.json')) || excludes.some(value => {const x=process.platform==='win32'?value.toLowerCase():value;return !x || key === x || key.startsWith(`${x}/`);});
}
export class PathPolicy {
  constructor(public stateDir: string) {}
  private excludes(mount: Mount, rel: string) {
    const selected = mount.fileSource && (process.platform === 'win32' ? rel.toLowerCase() === mount.entry.toLowerCase() : rel === mount.entry);
    return selected ? [] : mount.excludes;
  }
  async noLinks(target: string) {
    target = localAbsolute(target);
    const parsed = path.parse(target); let cursor = parsed.root;
    for (const part of target.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, part);
      if ((await fs.lstat(cursor)).isSymbolicLink()) throw new AppError('FORBIDDEN_PATH', '默认不跟随符号链接或 junction', 403);
    }
  }
  /** A selected file is allowed in home/root directories without publishing them as mounts. */
  async fileLocation(value: string, directory = false) {
    const target = localAbsolute(value);
    await this.noLinks(target);
    const real = localAbsolute(await fs.realpath(target));
    const sensitive = process.platform === 'win32' ? [process.env.SystemRoot || 'C:\\Windows', process.env.ProgramFiles || 'C:\\Program Files', process.env.ProgramData || 'C:\\ProgramData'] : ['/etc','/proc','/sys','/dev','/boot'];
    const segments = real.slice(path.parse(real).root.length).split(path.sep).join('/');
    if (sensitive.some(p => inside(p, real)) || inside(this.stateDir, real) || hidden(segments)) throw new AppError('FORBIDDEN_PATH', '系统、隐藏敏感目录及平台状态文件不能打开', 403);
    const stat = await fs.stat(real);
    if (directory ? !stat.isDirectory() : !stat.isFile()) throw new AppError('INVALID_PATH', directory ? '请选择目录' : '请选择普通文件');
    await fs.access(real, fs.constants.R_OK);
    return real;
  }
  async toolLocation(value: string, directory = false) {
    const real = await this.fileLocation(value, directory);
    if (!directory && !/\.html?$/i.test(real)) throw new AppError('INVALID_TOOL', '请选择 HTML 网页作为工具', 400);
    return real;
  }
  private sourceRoot(mount: Mount) { return mount.fileSource ? this.fileLocation(mount.absolutePath, true) : this.root(mount.absolutePath); }
  async root(value: string) {
    const target = localAbsolute(value);
    await this.noLinks(target);
    const real = localAbsolute(await fs.realpath(target));
    if (!(await fs.stat(real)).isDirectory()) throw new AppError('INVALID_PATH', '所选路径不是目录');
    const sensitive = process.platform === 'win32' ? [process.env.SystemRoot || 'C:\\Windows', process.env.ProgramFiles || 'C:\\Program Files', process.env.ProgramData || 'C:\\ProgramData'] : ['/etc','/proc','/sys','/dev','/boot'];
    const segments=real.slice(path.parse(real).root.length).split(path.sep).join('/');
    if (real === path.parse(real).root || path.relative(os.homedir(), real) === '' || sensitive.some(p => inside(p, real)) || inside(this.stateDir, real) || inside(real,this.stateDir) || hidden(segments)) throw new AppError('FORBIDDEN_PATH', '请选择具体项目目录；系统、隐藏敏感目录、用户主目录以及包含平台状态的目录不能发布', 403);
    await fs.access(real, fs.constants.R_OK);
    return real;
  }
  async resolve(mount: Mount, rel: string, internalPackage = false, access: 'preview' | 'file' = 'preview') {
    if (!mount.enabled) throw new AppError('MOUNT_DISABLED', '挂载已停用', 410);
    relative(rel);
    if (hidden(rel, this.excludes(mount, rel), internalPackage)) throw new AppError('FORBIDDEN_FILE', '该文件在排除范围内', 403);
    let root: string;
    try { root = await this.sourceRoot(mount); } catch (e) { if (e instanceof AppError) throw e; throw new AppError('MOUNT_OFFLINE', '目录离线或不可访问', 503); }
    return this.resolveAtRoot(mount, rel, root, internalPackage, access);
  }
  /** Reuse root validation within one listing; every child still checks its complete path. */
  async directory(mount: Mount, rel: string) {
    if (!mount.enabled) throw new AppError('MOUNT_DISABLED', '挂载已停用', 410);
    relative(rel);
    if (hidden(rel, mount.excludes)) throw new AppError('FORBIDDEN_FILE', '该文件在排除范围内', 403);
    let root: string;
    try { root = await this.sourceRoot(mount); } catch (e) { if (e instanceof AppError) throw e; throw new AppError('MOUNT_OFFLINE', '目录离线或不可访问', 503); }
    const directory = await this.resolveAtRoot(mount, rel, root, false, 'file');
    if (!directory.stat.isDirectory()) throw new AppError('INVALID_PATH', '请选择目录', 400);
    return { ...directory, resolveChild: async (name: string) => {
      relative(name, false);
      if (name.includes('/')) throw new AppError('INVALID_PATH', '需要直接子项名称');
      return this.resolveAtRoot(mount, [rel, name].filter(Boolean).join('/'), root, false, 'file');
    } };
  }
  private async resolveAtRoot(mount: Mount, rel: string, root: string, internalPackage: boolean, access: 'preview' | 'file') {
    if (!mount.enabled) throw new AppError('MOUNT_DISABLED', '挂载已停用', 410);
    relative(rel);
    if (hidden(rel, this.excludes(mount, rel), internalPackage)) throw new AppError('FORBIDDEN_FILE', '该文件在排除范围内', 403);
    const target = path.resolve(root, rel);
    if (!inside(root, target) || inside(this.stateDir, target)) throw new AppError('FORBIDDEN_PATH', '文件超出可访问范围', 403);
    await this.noLinks(target);
    const real = localAbsolute(await fs.realpath(target));
    if (!inside(root, real) || inside(this.stateDir, real)) throw new AppError('FORBIDDEN_PATH', '真实路径超出可访问范围', 403);
    const realRelative = path.relative(root,real).split(path.sep).join('/');
    if(hidden(realRelative,this.excludes(mount,realRelative),internalPackage))throw new AppError('FORBIDDEN_FILE','真实路径在排除范围内',403);
    if (mount.fileSource) {
      const segments = real.slice(path.parse(real).root.length).split(path.sep).join('/');
      const sensitive = process.platform === 'win32' ? [process.env.SystemRoot || 'C:\\Windows', process.env.ProgramFiles || 'C:\\Program Files', process.env.ProgramData || 'C:\\ProgramData'] : ['/etc','/proc','/sys','/dev','/boot'];
      if (hidden(segments) || sensitive.some(p => inside(p, real))) throw new AppError('FORBIDDEN_PATH', '资源位于受限制的目录', 403);
      const selected = process.platform === 'win32' ? rel.toLowerCase() === mount.entry.toLowerCase() : rel === mount.entry;
      const html = /\.html?$/i.test(mount.entry);
      const markdown = /\.(md|markdown)$/i.test(mount.entry);
      // Plain files expose only themselves. Markdown exposes images and readable links.
      if (!selected && !html && !(markdown && /\.(html?|md|markdown|txt|csv|json|svg|png|jpe?g|gif|webp|ico)$/i.test(rel))) throw new AppError('FORBIDDEN_FILE', '此独立文件只提供所选文件及允许的文档资源', 403);
      // A selected file at a broad root cannot publish unrelated documents.
      const broadRoot = root === path.parse(root).root || path.relative(os.homedir(), root) === '';
      if (broadRoot && rel && !selected && !/\.(css|[cm]?js|json|csv|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|otf|wasm|mp4|mp3)$/i.test(rel)) throw new AppError('UNSUPPORTED_FILE', '盘符根目录或用户主目录仅提供所选文件与静态资源', 403);
    }
    const stat = await fs.stat(real);
    if (!stat.isDirectory() && !stat.isFile()) throw new AppError('UNSUPPORTED_FILE', '仅支持普通文件和目录', 403);
    if (access === 'preview' && !stat.isDirectory() && !(internalPackage && path.basename(real) === 'package.json') && !mime[path.extname(real).toLowerCase()]) throw new AppError('UNSUPPORTED_FILE', '不提供此文件类型', 403);
    return { real, stat };
  }
}
