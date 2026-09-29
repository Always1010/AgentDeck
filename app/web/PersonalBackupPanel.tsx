import { useState } from 'react';
import { parsePersonalBackup, PERSONAL_BACKUP_LIMIT, type PersonalBackup } from './personalBackup.js';
import { exportPersonalBackup, importPersonalBackup } from './personalBackupBrowser.js';

export function PersonalBackupPanel() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [candidate, setCandidate] = useState<{ text: string; backup: PersonalBackup }>();
  const [imported, setImported] = useState(false);
  async function exportFile() {
    setBusy(true); setError(''); setNotice('');
    try {
      const text = await exportPersonalBackup();
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `agentdeck-personal-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('个人备份已生成。');
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  async function choose(file?: File) {
    setCandidate(undefined); setError(''); setNotice('');
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > PERSONAL_BACKUP_LIMIT) throw new Error('备份文件超过 5 MiB，未导入任何内容。');
      const text = await file.text();
      setCandidate({ text, backup: parsePersonalBackup(text) });
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  async function importFile() {
    if (!candidate) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await importPersonalBackup(candidate.text);
      setCandidate(undefined); setImported(true);
      setNotice(`已导入 ${result.collections} 个常用组合；${result.favorites} 条收藏和个人设置将在刷新后应用。`);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="personal-backup"><h2>备份与恢复</h2>
    <p>备份当前浏览器的收藏、常用组合和全局阅读设置。报告文件、挂载目录、工具登记及网页工具输入不包含在内。</p>
    <button disabled={busy} onClick={() => void exportFile()}>导出个人备份</button>
    <label className="backup-file">选择个人备份文件<input type="file" accept=".json,application/json" aria-label="选择个人备份文件" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void choose(file); }}/></label>
    <p className="muted">支持 AgentDeck 版本 1 的 JSON 备份，最大 5 MiB。导入组合会生成独立副本，不覆盖已有或正在使用的现场。文件引用依赖原服务的挂载标识，适合同一服务更换浏览器或恢复本机设置；不自动迁移到新电脑。</p>
    {candidate && <div className="backup-preview"><p>将新增 {candidate.backup.collections.length} 个常用组合，恢复 {candidate.backup.favorites.length} 条收藏和 {Object.keys(candidate.backup.preferences).length} 项设置。</p><p>收藏列表将在刷新后替换为备份中的列表；备份未包含的设置保留现值。</p><button disabled={busy} onClick={() => void importFile()}>导入备份</button><button disabled={busy} onClick={() => setCandidate(undefined)}>取消导入</button></div>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {imported && <div><p>刷新会重新加载页面，网页工具中的输入请先自行保存。</p><button onClick={() => location.reload()}>刷新并应用设置</button></div>}
  </section>;
}
