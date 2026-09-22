import { useEffect, useRef, type KeyboardEvent } from 'react';
import { parseFileReference, type Snapshot } from '../shared/model.js';
import { Icon } from './Icon.js';
import type { OpenPage } from './pages.js';

export function pageLabel(page: OpenPage, pages: OpenPage[], snapshot: Snapshot) {
  const ref = parseFileReference(page.id);
  const name = page.title || ref?.relativePath.split('/').pop() || '旧文件';
  const mount = snapshot.mounts.find(m => m.id === ref?.mountId);
  const project = snapshot.projects.find(p => p.id === mount?.projectId);
  const directory = ref?.relativePath.split('/').slice(0, -1).join('/');
  const duplicate = pages.some(p => p.id !== page.id && (p.title || parseFileReference(p.id)?.relativePath.split('/').pop() || '旧文件') === name);
  const context = [project?.name, mount?.label, directory].filter(Boolean).join(' / ');
  const path = mount && ref ? `${mount.absolutePath.replace(/[\\/]$/, '')}/${ref.relativePath}` : ref?.relativePath || page.id;
  return { name, display: duplicate ? `${name} · ${context || ref?.mountId || page.id}` : name, path };
}

type Props = { pages: OpenPage[]; active: string; snapshot: Snapshot; open: (id: string) => void; keep: (id: string) => void; close: (id: string) => void };
export const pageTabId = (id: string) => `page-tab-${encodeURIComponent(id)}`;
export const pagePanelId = (id: string) => `page-panel-${encodeURIComponent(id)}`;

export function PageTabs({ pages, active, snapshot, open, keep, close }: Props) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => { bar.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [active, pages.length]);
  function keys(e: KeyboardEvent, index: number) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.nativeEvent.isComposing) return;
    let next = index;
    if (e.key === 'ArrowRight') next = (index + 1) % pages.length;
    else if (e.key === 'ArrowLeft') next = (index + pages.length - 1) % pages.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = pages.length - 1;
    else return;
    e.preventDefault(); open(pages[next].id);
    document.getElementById(pageTabId(pages[next].id))?.focus();
  }
  return <div className="page-tabs" ref={bar} role="tablist" aria-label="已打开页面标签">
    {pages.map((page, index) => {
      const label = pageLabel(page, pages, snapshot);
      return <div className={`page-tab ${page.id === active ? 'active' : ''} ${page.kept ? '' : 'temporary'}`} key={page.id}>
        <button id={pageTabId(page.id)} role="tab" aria-selected={page.id === active} aria-controls={pagePanelId(page.id)} tabIndex={page.id === active ? 0 : -1} title={`${label.path}${page.kept ? '' : '\n临时预览 · 双击保留页面'}`} onClick={() => open(page.id)} onDoubleClick={() => keep(page.id)} onKeyDown={e => keys(e, index)}><span>{label.display}</span>{!page.kept && <small>临时</small>}</button>
        {!page.kept && <button className="tab-action" aria-label={`保留页面：${label.display}`} title="保留页面，不被后续打开的文件替换" onClick={() => keep(page.id)}>保留</button>}
        <button className="tab-action" aria-label={`关闭页面：${label.display}`} title="关闭页面" onClick={() => close(page.id)}><Icon name="close"/></button>
      </div>;
    })}
  </div>;
}

export function OpenPages({ pages, active, snapshot, open, keep, close, expanded, toggle }: Props & { expanded: boolean; toggle: () => void }) {
  return <section className="open-pages" aria-label="已打开页面">
    <button className="open-pages-heading" aria-expanded={expanded} onClick={toggle}><span aria-hidden="true">{expanded ? '▾' : '▸'}</span> 已打开页面 <span>{pages.length}</span></button>
    {expanded && <div className="open-pages-list">{pages.length ? pages.map(page => {
      const label = pageLabel(page, pages, snapshot);
      return <div key={page.id} className={`open-page-row ${page.id === active ? 'active' : ''} ${page.kept ? '' : 'temporary'}`}>
        <button className="open-page-link" aria-current={page.id === active ? 'page' : undefined} title={`${label.path}${page.kept ? '' : '\n临时预览 · 双击保留页面'}`} onClick={() => open(page.id)} onDoubleClick={() => keep(page.id)}>{label.display}{!page.kept && <small>临时</small>}</button>
        <button className="tab-action" aria-label={`关闭页面：${label.display}`} title="关闭页面" onClick={() => close(page.id)}><Icon name="close"/></button>
      </div>;
    }) : <p>打开报告后会显示在这里</p>}</div>}
  </section>;
}
