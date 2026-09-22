import { useEffect, useState } from 'react';
import { listReadingSessions, type ReadingSessionSummary } from './readingSessions.js';

export function RecentReadingSessions({ current }: { current?: string }) {
  const [items, setItems] = useState<ReadingSessionSummary[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void listReadingSessions().then(items => { if (live) setItems(items); }).catch(error => { if (live) setError((error as Error).message); });
    return () => { live = false; };
  }, []);
  return <section className="recent-reading"><h2>最近阅读现场</h2><p>恢复文件标签、分屏和阅读位置。正在其他浏览器标签使用的现场会自动复制，之后各自保存。</p>
    {error && <p role="alert">{error}</p>}
    {!items.length && !error && <p>尚无保存的阅读现场。</p>}
    {items.map(item => <div className="reading-session-row" key={item.id}><div><strong>{item.titles.join('、') || '空工作台'}</strong><small>{item.paneCount} 个阅读区 · {new Date(item.activeAt || item.updatedAt).toLocaleString()}</small></div>{item.id === current ? <span>当前现场</span> : <a href={`/?ws=${encodeURIComponent(item.id)}`} target="_blank" rel="noopener noreferrer">恢复现场</a>}</div>)}
  </section>;
}
