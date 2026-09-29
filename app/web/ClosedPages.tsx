import { Dialog } from './Dialog.js';

export type ClosedPage = {
  key: number;
  id: string;
  pane: number;
  title: string;
  position?: { x: number; y: number };
};

export function ClosedPages({ items, open, close }: {
  items: ClosedPage[];
  open: (item: ClosedPage) => void;
  close: () => void;
}) {
  return <Dialog label="最近关闭的页面" close={close}>
    <header><h2>最近关闭的页面</h2><button aria-label="关闭最近关闭列表" onClick={close}>×</button></header>
    <p>保留本次会话最近 20 个关闭记录。重新读取当前文件并恢复阅读位置；工具的未保存输入无法恢复。</p>
    {!items.length ? <p>暂无关闭记录。</p> : <ul className="closed-pages-list">{items.map(item =>
      <li key={item.key}><button title={item.id} onClick={() => open(item)}>{item.title} · 原阅读区 {item.pane + 1}</button></li>
    )}</ul>}
  </Dialog>;
}
