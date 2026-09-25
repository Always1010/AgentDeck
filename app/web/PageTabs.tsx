import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
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

type Props = { scope?: string; pages: OpenPage[]; active: string; snapshot: Snapshot; open: (id: string) => void; keep: (id: string) => void; close: (id: string) => void };
export const pageTabId = (id: string, scope = '') => `page-tab-${scope}-${encodeURIComponent(id)}`;
export const pagePanelId = (id: string, scope = '') => `page-panel-${scope}-${encodeURIComponent(id)}`;

export function PageTabs({ scope, pages, active, snapshot, open, keep, close }: Props) {
  const bar = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{id: string; x: number; y: number}>();
  useEffect(() => {
    if (!menu) return;
    function close(event: Event) { if (!(event.target instanceof Element) || !event.target.closest('.tab-context-menu')) setMenu(undefined); }
    function escape(event: globalThis.KeyboardEvent) { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); setMenu(undefined); } }
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape, true); };
  }, [menu]);
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
    document.getElementById(pageTabId(pages[next].id,scope))?.focus();
  }
  return <><div className="page-tabs" ref={bar} role="tablist" aria-label="已打开页面标签">
    {pages.map((page, index) => {
      const label = pageLabel(page, pages, snapshot);
      return <div className={`page-tab ${page.id === active ? 'active' : ''} ${page.kept ? '' : 'temporary'}`} key={page.id}>
        <button id={pageTabId(page.id,scope)} role="tab" aria-selected={page.id === active} aria-controls={pagePanelId(page.id,scope)} tabIndex={page.id === active ? 0 : -1} title={`${label.path}${page.kept ? '' : '\n临时预览 · 按 P 或双击保留页面'}`} onClick={() => open(page.id)} onDoubleClick={() => keep(page.id)} onContextMenu={e => { e.preventDefault(); setMenu({id:page.id,x:Math.min(e.clientX,window.innerWidth-190),y:Math.min(e.clientY,window.innerHeight-90)}); }} onKeyDown={e => { if(e.key==='F10'&&e.shiftKey){e.preventDefault();const r=e.currentTarget.getBoundingClientRect();setMenu({id:page.id,x:Math.min(r.left,window.innerWidth-190),y:r.bottom});}else keys(e,index); }}><span>{label.display}</span></button>
        <button className="tab-action" aria-label={`关闭页面：${label.display}`} title="关闭页面" onClick={() => close(page.id)}><Icon name="close"/></button>
      </div>;
    })}
  </div>{menu&&<div className="tab-context-menu" role="menu" aria-label="标签操作" style={{left:menu.x,top:menu.y}}>
    <button role="menuitem" autoFocus onClick={()=>{keep(menu.id);setMenu(undefined);}}>保留标签页</button>
    <button role="menuitem" onClick={()=>{close(menu.id);setMenu(undefined);}}>关闭标签页</button>
  </div>}</>;
}

export function OpenPages({ pages, active, snapshot, open, keep, close, expanded, toggle }: Props & { expanded: boolean; toggle: () => void }) {
  return <section className="open-pages" aria-label="已打开页面">
    <button className="open-pages-heading" aria-expanded={expanded} onClick={toggle}><span aria-hidden="true">{expanded ? '▾' : '▸'}</span> 已打开页面 <span>{pages.length}</span></button>
    {expanded && <div className="open-pages-list">{pages.length ? pages.map(page => {
      const label = pageLabel(page, pages, snapshot);
      return <div key={page.id} className={`open-page-row ${page.id === active ? 'active' : ''} ${page.kept ? '' : 'temporary'}`}>
        <button className="open-page-link" aria-current={page.id === active ? 'page' : undefined} title={`${label.path}${page.kept ? '' : '\n临时预览 · 按 P 或双击保留页面'}`} onClick={() => open(page.id)} onDoubleClick={() => keep(page.id)}>{label.display}</button>
        <button className="tab-action" aria-label={`关闭页面：${label.display}`} title="关闭页面" onClick={() => close(page.id)}><Icon name="close"/></button>
      </div>;
    }) : <p>打开报告后会显示在这里</p>}</div>}
  </section>;
}
