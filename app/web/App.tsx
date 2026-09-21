import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Entry, Snapshot } from '../shared/model.js';
import { api } from './api.js';
import { Management } from './Management.js';
import { Tree } from './Tree.js';
import { Viewer, type Signal } from './Viewer.js';
import { isBoolean, usePreference } from './preferences.js';
import { ShortcutHelp } from './ShortcutHelp.js';
import { isEditing, restoreFocus, shortcutFor } from './shortcuts.js';
import './style.css';

const empty: Snapshot = { projects: [], mounts: [], revision: 0 };
const labels: Record<string, string> = { ready: '可访问', 'pending-build': '待构建', 'choose-entry': '待选择', online: '在线', offline: '离线', disabled: '已停用', scanning: '扫描中' };
const views = [['all', '全部内容'], ['recent', '最近更新'], ['tools', '全部工具'], ['favorites', '收藏']];
const dateFormat = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
type Sort = 'recent' | 'name';

export function App() {
  const standalone = location.pathname === '/preview';
  const [data, setData] = useState<Snapshot>(empty);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [project, setProject] = useState('');
  const [view, setView] = useState('all');
  const [manage, setManage] = useState<'new' | 'edit'>();
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [selected, setSelected] = useState(new URLSearchParams(location.search).get('entry') || '');
  const [kind, setKind] = useState('');
  const [query, setQuery] = useState('');
  const [favorites, setFavorites] = usePreference<string[]>('favorites', [], (v): v is string[] => Array.isArray(v) && v.every(id => typeof id === 'string'));
  const [immersive, setImmersive] = useState(standalone);
  const [shortcutsEnabled, setShortcutsEnabled] = usePreference('shortcuts.enabled', true, isBoolean);
  const [help, setHelp] = useState(false);
  const [searchActive, setSearchActive] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const immersionRef = useRef<HTMLButtonElement>(null);
  const searchRestore = useRef<{ query: string; focus: HTMLElement | null } | null>(null);
  const immersionRestore = useRef<HTMLElement | null>(null);
  const [navCollapsed, setNavCollapsed] = usePreference('layout.navCollapsed', false, isBoolean);
  const [catalogCollapsed, setCatalogCollapsed] = usePreference('layout.catalogCollapsed', false, isBoolean);
  const [catalogWidth, setCatalogWidth] = usePreference('layout.catalogWidth', 290, (v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 230 && v <= 420);
  const [sort, setSort] = usePreference<Sort>('catalog.sort', 'recent', (v): v is Sort => v === 'recent' || v === 'name');
  const [connection, setConnection] = useState('连接中');
  const [signal, setSignal] = useState<Signal>();
  const serial = useRef(0);
  const reloadVersion = useRef(0);
  const [treeRevision, setTreeRevision] = useState(0);
  const drag = useRef<{ x: number; width: number } | null>(null);

  async function reload() {
    const version = ++reloadVersion.current;
    try {
      const [s, e] = await Promise.all([api<Snapshot>('/api/projects'), api<Entry[]>('/api/entries')]);
      if (version !== reloadVersion.current) return;
      setData(s); setEntries(e); setError('');
    } catch (e) { setError((e as Error).message); }
  }
  useEffect(() => {
    void reload();
    const source = new EventSource('/api/events');
    source.onopen = () => setConnection('实时连接');
    source.onerror = () => setConnection('连接中断，正在重连');
    for (const type of ['registry-changed', 'mount-state', 'entries-changed', 'resync']) source.addEventListener(type, event => {
      void reload();
      if (type !== 'mount-state') {
        setSignal({ type, data: JSON.parse((event as MessageEvent).data), sequence: ++serial.current });
        setTreeRevision(v => v + 1);
      }
    });
    return () => source.close();
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  function finishSearch(cancel = true) {
    if (cancel && searchRestore.current) setQuery(searchRestore.current.query);
    setSearchActive(false);
    restoreFocus(cancel ? searchRestore.current?.focus || null : immersionRef.current, immersionRef.current);
    searchRestore.current = null;
  }
  function toggleImmersion() {
    if (!selected && !immersive) return;
    if (searchActive) finishSearch();
    if (!immersive) immersionRestore.current = document.activeElement as HTMLElement | null;
    setImmersive(!immersive);
    restoreFocus(immersive ? immersionRestore.current : immersionRef.current, immersionRef.current);
  }
  function openEntry(id: string) {
    setSelected(id);
    if (searchActive) finishSearch(false);
  }
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (document.querySelector('[data-workbench-dialog]')) return;
      const action = shortcutFor(event, isEditing(event.target), shortcutsEnabled);
      if (action === 'escape') {
        // Viewer owns the first Escape while its settings panel is open.
        if (document.querySelector('.viewer-settings')) return;
        if (searchActive) { event.preventDefault(); finishSearch(); }
        else if (immersive) { event.preventDefault(); toggleImmersion(); }
      } else if (action === 'immersive' && !searchActive && (selected || immersive)) {
        event.preventDefault(); toggleImmersion();
      } else if (action === 'search') {
        event.preventDefault();
        if (!searchActive) searchRestore.current = { query, focus: document.activeElement as HTMLElement | null };
        setSearchActive(true);
        requestAnimationFrame(() => { searchRef.current?.focus(); searchRef.current?.select(); });
      } else if (action === 'help') { event.preventDefault(); setHelp(true); }
    }
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [shortcutsEnabled, selected, immersive, searchActive, query]);

  function favorite() {
    if (selected) setFavorites(favorites.includes(selected) ? favorites.filter(id => id !== selected) : [...favorites, selected]);
  }
  function navigate(mountId: string, relativePath: string) {
    const entry = entries.find(e => e.mountId === mountId && e.relativePath === relativePath);
    if (entry) openEntry(entry.id);
    else window.open(`/api/mounts/${mountId}/download?path=${encodeURIComponent(relativePath)}`, '_blank', 'noopener');
  }
  function chooseProject(id: string) { setProject(id); setView('all'); setKind(''); }
  function resize(width: number) { setCatalogWidth(Math.max(230, Math.min(420, width))); }

  const visible = entries.filter(e => (!project || e.projectId === project) && (!kind || (kind === 'other' ? ['text', 'data'].includes(e.kind) : e.kind === kind)) && (view !== 'tools' || e.kind === 'tool') && (view !== 'favorites' || favorites.includes(e.id)) && `${e.title} ${e.relativePath} ${data.projects.find(p => p.id === e.projectId)?.name}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => (view === 'recent' || sort === 'recent' ? b.updatedAt - a.updatedAt : 0) || a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id));
  const currentProject = data.projects.find(p => p.id === project);
  const mounts = data.mounts.filter(m => !project || m.projectId === project);
  const scope = currentProject?.name || views.find(([id]) => id === view)?.[1];
  const filtered = Boolean(query || kind);
  const offline = mounts.some(m => m.status === 'offline' || m.status === 'disabled');
  const focusedLayout = immersive && !searchActive;

  return <div className={`shell ${focusedLayout ? 'immersive' : ''} ${navCollapsed ? 'nav-collapsed' : ''} ${catalogCollapsed && !searchActive ? 'catalog-collapsed' : ''}`} style={{ '--catalog-width': `${catalogWidth}px` } as CSSProperties}>
    <header className="workspace-header">
      <strong className="brand">AgentDeck</strong><span className="workspace-context">{searchActive ? '搜索内容 · Esc 返回' : immersive ? '沉浸阅读' : scope}</span>
      <div className="workspace-actions">
        {!focusedLayout && <><button aria-controls="project-navigation" aria-expanded={!navCollapsed} onClick={() => setNavCollapsed(!navCollapsed)}>项目导航</button><button disabled={searchActive} aria-controls="content-catalog" aria-expanded={searchActive || !catalogCollapsed} onClick={() => setCatalogCollapsed(!catalogCollapsed)}>内容列表</button></>}
        {searchActive && <button onClick={() => finishSearch()}>结束搜索 <kbd>Esc</kbd></button>}
        <button ref={immersionRef} className="immersion-toggle" disabled={!selected && !immersive} aria-label={immersive ? '退出沉浸' : '沉浸'} aria-keyshortcuts={shortcutsEnabled ? 'f' : undefined} title={shortcutsEnabled ? 'F 切换沉浸；Esc 退出（工作台获得焦点时）' : '切换沉浸'} aria-pressed={immersive} onClick={toggleImmersion}>{immersive ? '退出沉浸' : '沉浸'}{shortcutsEnabled && <kbd>F</kbd>}</button>
        <button aria-label="快捷键" aria-keyshortcuts={shortcutsEnabled ? '?' : undefined} onClick={() => setHelp(true)}>快捷键{shortcutsEnabled && <kbd>?</kbd>}</button>
      </div>
    </header>
    <aside id="project-navigation">
      <button className="add-project" onClick={() => setManage('new')}>＋ 添加项目</button>
      <nav aria-label="内容范围">{views.map(([id, name]) => <button key={id} className={!project && view === id ? 'active' : ''} aria-current={!project && view === id ? 'page' : undefined} onClick={() => { setProject(''); setView(id); setKind(''); }}>{name}</button>)}</nav>
      <div className="project-list"><p className="nav-label">我的项目</p>{data.projects.map(p => <button className={p.id === project ? 'active' : ''} key={p.id} aria-current={p.id === project ? 'page' : undefined} onClick={() => chooseProject(p.id)}>{p.name}<small>{data.mounts.filter(m => m.projectId === p.id).length} 个目录</small></button>)}</div>
      <select className="project-picker" aria-label="切换项目" value={project} onChange={e => chooseProject(e.target.value)}><option value="">所有项目</option>{data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <div className="connection">● {connection}<small>本机运行 · 原文件只读</small></div>
    </aside>
    <section className="catalog" id="content-catalog" aria-label="内容列表">
      <div className="catalog-header">
        <header><h2>{scope}</h2>{project && <button aria-label="管理挂载" onClick={() => setManage('edit')}>管理挂载</button>}</header>
        <div className="catalog-filters"><input ref={searchRef} aria-label="搜索" aria-keyshortcuts={shortcutsEnabled ? '/' : undefined} type="search" placeholder={`搜索项目、名称或路径${shortcutsEnabled ? '  /' : ''}`} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => {
          if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229 || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.repeat) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); document.querySelector<HTMLButtonElement>('.entry-list .entry')?.focus(); }
          else if (e.key === 'Enter' && visible[0]) { e.preventDefault(); openEntry(visible[0].id); }
        }} />
          <select aria-label="类型筛选" value={kind} onChange={e => setKind(e.target.value)}><option value="">全部类型</option><option value="html">HTML 报告 / 页面</option><option value="tool">工具</option><option value="markdown">Markdown</option><option value="other">其他 / 原文</option></select>
          <select aria-label="排序" value={view === 'recent' ? 'recent' : sort} disabled={view === 'recent'} onChange={e => setSort(e.target.value as Sort)}><option value="recent">最近更新优先</option><option value="name">名称排序</option></select></div>
        <div className="list-meta"><span>{visible.length} 个内容</span><button onClick={() => void reload()}>刷新列表</button></div>
      </div>
      <div className="catalog-scroll">
        <div className="entry-list" aria-label="可读内容" onKeyDown={e => {
          if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229 || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
          const rows = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('.entry'));
          const index = rows.indexOf(document.activeElement as HTMLButtonElement);
          if (index < 0) return;
          e.preventDefault(); rows[Math.max(0, Math.min(rows.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
        }}>{visible.map(e => <button className={`entry ${selected === e.id ? 'selected' : ''}`} aria-current={selected === e.id ? 'true' : undefined} key={e.id} onClick={() => openEntry(e.id)} title={`${e.title}\n${e.relativePath || e.toolRoot || '根目录'}`}>
          <span className="entry-heading"><strong>{e.title}</strong><span className={`badge ${e.kind}`}>{e.kind === 'tool' ? '工具' : e.format.toUpperCase() || 'HTML'}</span></span>
          <small>{data.projects.find(p => p.id === e.projectId)?.name} / {data.mounts.find(m => m.id === e.mountId)?.label}{favorites.includes(e.id) ? ' ★' : ''}</small>
          <small className="entry-path">{e.relativePath || e.toolRoot || '根目录'}</small>
          <span className="entry-meta"><time dateTime={new Date(e.updatedAt).toISOString()} title={new Date(e.updatedAt).toLocaleString('zh-CN')}>{dateFormat.format(e.updatedAt)}</time>{e.status !== 'ready' && <span className="entry-status">{labels[e.status]}</span>}</span>
        </button>)}</div>
        {!visible.length && <div className="catalog-empty">
          <strong>{!data.projects.length ? '还没有项目' : filtered ? '没有匹配的内容' : view === 'favorites' ? '还没有收藏' : offline ? '目录暂不可用' : '暂无可读内容'}</strong>
          <p>{!data.projects.length ? '添加项目，原文件保留在原位置。' : filtered ? '试试其他关键词，或清除搜索与类型筛选。' : view === 'favorites' ? '打开内容后，点击工具栏中的收藏。' : offline ? '展开下方目录状态，或在管理挂载中重新定位。' : '可展开目录检查文件；工具需有静态 HTML 入口。'}</p>
          {filtered && <button onClick={() => { setQuery(''); setKind(''); }}>清除筛选</button>}
          {!data.projects.length && <button onClick={() => setManage('new')}>添加项目</button>}
        </div>}
        <details className="directory-section"><summary>目录与文件 <span className={offline ? 'offline' : 'muted'}>· {offline ? '有目录不可用' : `${mounts.length} 个目录`}</span></summary>
          {mounts.map(m => <details className="mount-tree" key={m.id}><summary>{m.label} <span className={m.status === 'offline' ? 'offline' : ''}>· {labels[m.status] || m.status}</span></summary><small>{m.absolutePath}</small>{m.error && <small role="alert">{m.error}</small>}<button onClick={() => void api(`/api/mounts/${m.id}/rescan`, 'POST').then(reload).catch(e => setError(e.message))}>重新扫描</button>{m.enabled && <Tree key={`${m.id}:${treeRevision}`} mount={m} open={p => navigate(m.id, p)} />}</details>)}
          {project && <button className="output-note" onClick={() => void navigator.clipboard.writeText(`本项目：${currentProject?.name}\n${mounts.map(m => `${m.label}：${m.absolutePath}（${m.mode}）\n工具子目录：${m.toolDirectories.join('、') || '未指定'}`).join('\n')}\n请原地输出 HTML/Markdown；工具保留完整静态输出，使用相对资源与 hash 路由。来源写入正文。无需 manifest，不修改工作台源码。`).then(() => setToast('已复制当前项目输出约定。')).catch(e => setError(e.message))}>复制输出路径说明</button>}
        </details>
      </div>
    </section>
    <div className="catalog-resizer" role="separator" tabIndex={0} aria-label="调整内容列表宽度" aria-orientation="vertical" aria-valuemin={230} aria-valuemax={420} aria-valuenow={catalogWidth} aria-controls="content-catalog"
      onPointerDown={e => { if (e.button !== 0) return; drag.current = { x: e.clientX, width: catalogWidth }; e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={e => { if (drag.current) resize(drag.current.width + e.clientX - drag.current.x); }}
      onPointerUp={e => { drag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }} onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); resize(catalogWidth + (e.key === 'ArrowLeft' ? -10 : 10)); } else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); resize(e.key === 'Home' ? 230 : 420); } }} />
    {selected ? <Viewer key={selected} id={selected} signal={signal} favorite={favorites.includes(selected)} toggleFavorite={favorite} back={() => { if (standalone) location.href = '/'; else { setSelected(''); setImmersive(false); } }} navigate={navigate} /> : <section className="viewer"><div className="empty"><span className="eyebrow">YOUR FILES. IN PLACE.</span><h2>{data.projects.length ? '选择一个报告，或启动工具。' : '让每个项目拥有自己的工作台。'}</h2><p>直接阅读 HTML，运行纯前端工具。将已有目录加入项目，文件留在原位置。</p>{!data.projects.length && <button className="primary" onClick={() => setManage('new')}>添加第一个项目</button>}<p className="muted">支持多文件网页与完整构建输出。Markdown、CSV、JSON 可直接阅读。</p></div></section>}
    {toast && <div className="toast success" role="status">{toast}<button aria-label="关闭提示" onClick={() => setToast('')}>×</button></div>}
    {error && <div className="toast" role="alert">{error}<button aria-label="关闭错误提示" onClick={() => setError('')}>×</button></div>}
    {manage && <Management snapshot={data} project={manage === 'edit' ? currentProject : undefined} close={() => setManage(undefined)} saved={() => void reload()} />}
    {help && <ShortcutHelp close={() => setHelp(false)} enabled={shortcutsEnabled} setEnabled={setShortcutsEnabled} />}
  </div>;
}
