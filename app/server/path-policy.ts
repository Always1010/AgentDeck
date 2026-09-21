import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AppError } from './errors.js';
import type { Mount } from '../shared/model.js';

export const mime: Record<string, string> = { '.html':'text/html; charset=utf-8', '.htm':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.csv':'text/plain; charset=utf-8', '.txt':'text/plain; charset=utf-8', '.md':'text/plain; charset=utf-8', '.markdown':'text/plain; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.webp':'image/webp', '.ico':'image/x-icon', '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf', '.otf':'font/otf', '.wasm':'application/wasm', '.pdf':'application/pdf', '.mp4':'video/mp4', '.mp3':'audio/mpeg' };
export const inside = (root: string, target: string) => { const rel = path.relative(root, target); return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel)); };
export function relative(value: string, allowEmpty = true) {
  if (typeof value !== 'string' || (!value && !allowEmpty) || value.includes('\\') || value.includes(':') || value.includes('\0') || value.startsWith('/') || value.split('/').some(s => s === '..' || s === '.' || /[. ]$/.test(s))) throw new AppError('INVALID_PATH', '需要安全的相对路径，不能越界');
  return value.replace(/\/$/, '');
}
export function hidden(rel: string, excludes: string[] = [], internalPackage = false) {
  return rel.split('/').some(s => s.startsWith('.') || /^(node_modules|__pycache__|coverage|credentials|secrets)$/i.test(s) || /(?:\.lock|\.pem|\.key|\.pfx|\.p12|\.tmp|\.bak|~)$/i.test(s) || /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|id_rsa|id_ed25519)$/i.test(s) || (!internalPackage && s.toLowerCase() === 'package.json')) || excludes.some(x => rel === x || rel.startsWith(`${x}/`));
}
export class PathPolicy {
  constructor(public stateDir: string) {}
  async noLinks(target: string) {
    const parsed = path.parse(target); let cursor = parsed.root;
    for (const part of target.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, part);
      if ((await fs.lstat(cursor)).isSymbolicLink()) throw new AppError('FORBIDDEN_PATH', '默认不跟随符号链接或 junction', 403);
    }
  }
  async root(value: string) {
    if (!path.isAbsolute(value) || value.startsWith('\\\\')) throw new AppError('INVALID_PATH', '请填写本机磁盘绝对目录，暂不支持 UNC');
    const target = path.resolve(value);
    await this.noLinks(target);
    const real = await fs.realpath(target);
    if (!(await fs.stat(real)).isDirectory()) throw new AppError('INVALID_PATH', '所选路径不是目录');
    const sensitive = process.platform === 'win32' ? [process.env.SystemRoot || 'C:\\Windows', process.env.ProgramFiles || 'C:\\Program Files', process.env.ProgramData || 'C:\\ProgramData'] : ['/etc','/proc','/sys','/dev','/boot'];
    const segments=real.slice(path.parse(real).root.length).split(path.sep).join('/');
    if (real === path.parse(real).root || path.relative(os.homedir(), real) === '' || sensitive.some(p => inside(p, real)) || inside(this.stateDir, real) || inside(real,this.stateDir) || hidden(segments)) throw new AppError('FORBIDDEN_PATH', '请选择具体项目目录；系统、隐藏敏感目录、用户主目录以及包含平台状态的目录不能发布', 403);
    await fs.access(real, fs.constants.R_OK);
    return real;
  }
  async resolve(mount: Mount, rel: string, internalPackage = false) {
    if (!mount.enabled) throw new AppError('MOUNT_DISABLED', '挂载已停用', 410);
    relative(rel);
    if (hidden(rel, mount.excludes, internalPackage)) throw new AppError('FORBIDDEN_FILE', '该文件在排除范围内', 403);
    let root: string;
    try { root = await this.root(mount.absolutePath); } catch (e) { if (e instanceof AppError) throw e; throw new AppError('MOUNT_OFFLINE', '目录离线或不可访问', 503); }
    const target = path.resolve(root, rel);
    if (!inside(root, target) || inside(this.stateDir, target)) throw new AppError('FORBIDDEN_PATH', '文件超出可访问范围', 403);
    await this.noLinks(target);
    const real = await fs.realpath(target);
    if (!inside(root, real) || inside(this.stateDir, real)) throw new AppError('FORBIDDEN_PATH', '真实路径超出可访问范围', 403);
    const stat = await fs.stat(real);
    if (!stat.isDirectory() && !(internalPackage && path.basename(real) === 'package.json') && !mime[path.extname(real).toLowerCase()]) throw new AppError('UNSUPPORTED_FILE', '不提供此文件类型', 403);
    return { real, stat };
  }
}
