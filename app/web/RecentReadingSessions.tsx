import { useEffect, useState } from 'react';
import { deleteReadingSession, listReadingSessions, saveReadingCollection, updateReadingSession, type ReadingSessionSummary } from './readingSessions.js';
import './readingSessions.css';

export function RecentReadingSessions({ current, flush }: { current?: string; flush?: () => Promise<void> }) {
  const [items, setItems] = useState<ReadingSessionSummary[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState('');
  const [name, setName] = useState('');
  const [collectionName, setCollectionName] = useState('');
  useEffect(() => {
    let live = true;
    void listReadingSessions().then(items => { if (live) setItems(items); }).catch(error => { if (live) setError((error as Error).message); });
    return () => { live = false; };
  }, []);
  async function act(action: () => Promise<unknown>, message: string) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); setItems(await listReadingSessions()); setNotice(message); setEditing(''); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="recent-reading"><h2>最近阅读现场</h2><p>恢复文件标签、分屏和阅读位置。正在其他浏览器标签使用的现场会自动复制，之后各自保存。删除只移除本机保存的现场，不影响报告文件。</p>
    <form className="reading-collection-form" onSubmit={event => { event.preventDefault(); if (current) void act(async () => { await flush?.(); await saveReadingCollection(current, collectionName); setCollectionName(''); }, '已另存常用组合。'); }}>
      <label>常用组合名称<input aria-label="常用组合名称" maxLength={120} value={collectionName} onChange={event => setCollectionName(event.target.value)} placeholder="例如：报告与换算工具"/></label>
      <button disabled={busy || !current || !collectionName.trim()}>将当前现场另存为组合</button>
    </form><p className="muted">组合保留这一刻的文件与布局，每次打开建立独立现场，后续操作不会改写组合。不保存网页工具未导出的输入。</p>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!items.length && !error && <p>尚无保存的阅读现场。</p>}
    {items.map(item => <div className="reading-session-row managed-reading-session" key={item.id}>
      <div className="reading-session-info"><strong>{item.name || item.titles.join('、') || '空工作台'}</strong><small>{item.pinned ? '已固定 · ' : ''}{item.collection ? '常用组合' : '阅读现场'} · {item.paneCount} 个阅读区 · {new Date(item.activeAt || item.updatedAt).toLocaleString()}</small>{item.name && <small>{item.titles.join('、') || '空工作台'}</small>}</div>
      <div className="reading-session-actions">
        {item.id === current ? <span>当前现场</span> : <a href={`/?ws=${encodeURIComponent(item.id)}`} target="_blank" rel="noopener noreferrer">{item.collection ? '打开组合' : '恢复现场'}</a>}
        <button disabled={busy} onClick={() => { setEditing(item.id); setName(item.name || ''); }}>命名</button>
        <button disabled={busy} onClick={() => void act(() => updateReadingSession(item.id, { pinned: !item.pinned }), item.pinned ? '已取消固定。' : '已固定到列表前面。')}>{item.pinned ? '取消固定' : '固定'}</button>
        <button disabled={busy || item.id === current || item.inUse} title={item.inUse ? '现场正在使用或无法检查占用，不能删除' : '仅删除保存的现场'} onClick={() => { if (confirm(`删除“${item.name || item.titles.join('、') || '空工作台'}”的保存记录？原文件不会删除。`)) void act(() => deleteReadingSession(item.id), '已删除保存记录。'); }}>删除</button>
      </div>
      {editing === item.id && <form className="reading-session-rename" onSubmit={event => { event.preventDefault(); void act(() => updateReadingSession(item.id, { name }), '已保存名称。'); }}><label>现场名称<input aria-label="现场名称" value={name} maxLength={120} onChange={event => setName(event.target.value)}/></label><button disabled={busy}>保存名称</button><button type="button" onClick={() => setEditing('')}>取消</button></form>}
    </div>)}
  </section>;
}
