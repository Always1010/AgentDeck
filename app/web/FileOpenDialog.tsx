import { useState } from 'react';
import type { FileSource } from '../shared/model.js';
import { api } from './api.js';
import { Dialog } from './Dialog.js';
import { FilePicker, parentDirectory } from './FilePicker.js';
import { Icon } from './Icon.js';
import { usePreference } from './preferences.js';

const cleanPath = (value: string) => value.trim().replace(/^"(.*)"$/s, '$1');

export function FileOpenDialog({ source, htmlOnly = false, close, opened }: {
  source?: FileSource; htmlOnly?: boolean; close: () => void; opened: (id: string) => Promise<void>;
}) {
  const [file, setFile] = useState(source?.absolutePath || '');
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lastDirectory, setLastDirectory] = usePreference('files.last-directory', '', (value): value is string => typeof value === 'string');
  const label = source ? '重新选择文件' : '打开本机文件';
  const cancel = () => { if (!busy) close(); };
  async function open() {
    if (busy || !cleanPath(file)) return;
    setBusy(true); setError('');
    try {
      const result = await api<{ id: string }>(source ? `/api/files/${encodeURIComponent(source.id)}` : '/api/files/open', source ? 'PATCH' : 'POST', { absolutePath: cleanPath(file) });
      setLastDirectory(parentDirectory(cleanPath(file)));
      await opened(result.id); close();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <Dialog label={label} close={cancel} className="tool-path-dialog">
    <header><h2>{label}</h2><button aria-label={`关闭${label}`} title={`关闭${label}`} disabled={busy} onClick={cancel}><Icon name="close"/></button></header>
    <p className="muted">选择或粘贴本机文件路径。直接打开，无需挂载目录；原文件保持原地只读。</p>
    <label htmlFor="local-file-path">文件路径</label>
    <div className="tool-path-field"><input id="local-file-path" data-autofocus placeholder="例如 D:\Reports\分析报告.html" value={file} disabled={busy} onChange={event => { setFile(event.target.value); setError(''); }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void open(); } }}/><button aria-label="浏览本机文件" title="浏览本机文件" disabled={busy} onClick={() => setPicker(true)}><Icon name="folder"/></button></div>
    <p className="muted">HTML、Markdown、图片、数据和代码沿用现有预览，其他文件提供下载。不会自动加入项目、收藏或工具。</p>
    {source && <p className="muted">保存后，已打开的该文件会加载新位置。名称、收藏和阅读引用保留；请先保存 HTML 页面中的输入。</p>}
    {error && <p role="alert">{error}</p>}
    <footer><button disabled={busy} onClick={cancel}>取消</button><button className="primary" disabled={busy || !cleanPath(file)} onClick={() => void open()}>{busy ? '正在打开…' : source ? '保存路径' : '打开'}</button></footer>
    {picker && <FilePicker htmlOnly={htmlOnly} initial={cleanPath(file) ? parentDirectory(cleanPath(file)) : lastDirectory} close={() => setPicker(false)} choose={value => { setFile(value); setError(''); setLastDirectory(parentDirectory(value)); setPicker(false); }}/>}
  </Dialog>;
}
