import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { dividerSize, layoutRects, ratioBounds, type PaneId, type Workspace } from './workspace.js';

export function ReadingLayout({ workspace, resize, children }: { workspace: Workspace; resize: (id: string, ratio: number) => void; children: (id: PaneId, visible: boolean, style: CSSProperties) => ReactNode }) {
  const area = useRef<HTMLElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const node = area.current!;
    const measure = () => setSize({ width: node.clientWidth, height: node.clientHeight });
    measure(); const observer = new ResizeObserver(measure); observer.observe(node); return () => observer.disconnect();
  }, []);
  const boxes = layoutRects(workspace.root, { x: 0, y: 0, ...size });
  return <main ref={area} className={`workspace-pages multi-layout ${Object.keys(workspace.panes).length > 1 ? 'has-splits' : ''}`}>
    {Object.keys(workspace.panes).map(Number).map(id => {
      const visible = workspace.maximized === null || workspace.maximized === id;
      const box = workspace.maximized === id ? { x: 0, y: 0, ...size } : boxes.panes[id];
      return children(id, visible, { left: box.x, top: box.y, width: box.width, height: box.height });
    })}
    {boxes.dividers.map(({ node, rect, parent }) => <div key={node.id} className={`reading-resizer divider-${node.direction}`} hidden={workspace.maximized !== null} role="separator" aria-label="调整阅读区比例" aria-orientation={node.direction === 'columns' ? 'vertical' : 'horizontal'} aria-valuemin={5} aria-valuemax={95} aria-valuenow={Math.round(node.ratio)} style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} onPointerDown={event => { if (event.button === 0) { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); } }} onPointerMove={event => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      const bounds = area.current!.getBoundingClientRect(), columns = node.direction === 'columns';
      const offset = columns ? event.clientX - bounds.left - parent.x : event.clientY - bounds.top - parent.y;
      const ratio = (offset - dividerSize / 2) / Math.max(1, (columns ? parent.width : parent.height) - dividerSize) * 100;
      const [min, max] = ratioBounds(node, parent); resize(node.id, Math.max(min, Math.min(max, ratio)));
    }} onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onDoubleClick={() => resize(node.id, 50)}/>)}
  </main>;
}
