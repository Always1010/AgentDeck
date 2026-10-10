import { useState } from 'react';
import type { FileSource } from '../shared/model.js';
import { api } from './api.js';
import { Dialog } from './Dialog.js';
import { FilePicker, parentDirectory } from './FilePicker.js';
import { Icon } from './Icon.js';
import { usePreference } from './preferences.js';

const cleanPath = (value: string) => value.trim().replace(/^"(.*)"$/s, '$1');
function suggestedName(file: string) {
  if (!/\.html?$/i.test(file)) return '';
  const parts = file.split(/[\\/]/).filter(Boolean);
  const filename = parts.at(-1) || '';
  return /^index\.html?$/i.test(filename) ? parts.at(-2) || '工具' : filename.replace(/\.html?$/i, '');
}

export function ToolPicker({ source, title, close, saved }: { source?: FileSource; title?: string; close: () => void; saved: (id: string, duplicate: boolean) => void }) {
  const [file, setFile] = useState(source?.absolutePath || '');
  const [name, setName] = useState(title || '');
  const [nameEdited, setNameEdited] = useState(!!source);
  const [error, setError] = useState('');
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastDirectory, setLastDirectory] = usePreference('tools.last-directory', '', (value): value is string => typeof value === 'string');
  const label = source ? '重新选择工具文件' : '添加工具';
  function choose(value: string) {
    setFile(value); setError('');
    if (!nameEdited) setName(suggestedName(cleanPath(value)));
  }
  async function save() {
    setBusy(true); setError('');
    try {
      const result = await api<{ id: string; alreadyRegistered?: boolean }>(source ? `/api/tools/${encodeURIComponent(source.id)}` : '/api/tools', source ? 'PATCH' : 'PUT', { absolutePath: cleanPath(file), ...(nameEdited && name.trim() ? { title: name.trim() } : {}) });
      setLastDirectory(parentDirectory(cleanPath(file))); saved(result.id, !!result.alreadyRegistered); close();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Dialog label={label} close={close} className="tool-path-dialog">
    <header><h2>{label}</h2><button aria-label={`关闭${label}`} title={`关闭${label}`} disabled={busy} onClick={close}><Icon name="close"/></button></header>
    <p className="muted">选择本机 HTML 文件，添加到常用工具。无需添加项目或挂载目录。</p>
    <label htmlFor="tool-html-path">HTML 文件</label>
    <div className="tool-path-field"><input id="tool-html-path" data-autofocus placeholder="例如 D:\Tools\报表合并\index.html" value={file} disabled={busy} onChange={e => choose(e.target.value)} /><button aria-label="选择 HTML 文件" title="选择 HTML 文件" disabled={busy} onClick={() => setPicker(true)}><Icon name="folder"/></button></div>
    <label>工具名称<input placeholder="根据文件名自动填写，可修改" maxLength={200} value={name} disabled={busy} onChange={e => { setName(e.target.value); setNameEdited(true); }} /></label>
    {source && <p className="muted">重新选择后，已打开的该工具会加载新文件。请先保存页面中的输入。</p>}
    {error && <p role="alert">{error}</p>}
    <footer><button disabled={busy} onClick={close}>取消</button><button className="primary" disabled={busy || !/\.html?$/i.test(cleanPath(file))} onClick={() => void save()}>{busy ? '保存中…' : source ? '保存路径' : '添加工具'}</button></footer>
    {picker && <FilePicker htmlOnly initial={cleanPath(file) ? parentDirectory(cleanPath(file)) : lastDirectory} close={() => setPicker(false)} choose={value => { choose(value); setLastDirectory(parentDirectory(value)); setPicker(false); }}/>}
  </Dialog>;
}
