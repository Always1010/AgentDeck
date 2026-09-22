import { initialPages, pagesReducer, type PageAction, type Pages } from './pages.js';

export type PaneId = number;
export type SplitDirection = 'columns' | 'rows';
export type LayoutNode = { type: 'pane'; pane: PaneId } | { type: 'split'; id: string; direction: SplitDirection; ratio: number; first: LayoutNode; second: LayoutNode };
export type FileHistory = { entries: string[]; index: number };
export type Workspace = { panes: Record<PaneId, Pages>; active: PaneId; histories: Record<PaneId, FileHistory>; root: LayoutNode; maximized: PaneId | null; nextPane: number };
export type WorkspaceAction =
  | { type: 'activate'; pane: PaneId }
  | { type: 'close-pane'; pane: PaneId }
  | { type: 'page'; pane: PaneId; action: PageAction; closeEmpty?: boolean }
  | { type: 'aliases'; aliases: Record<string, string> }
  | { type: 'history'; pane: PaneId; direction: -1 | 1 }
  | { type: 'split'; pane: PaneId; direction: SplitDirection; file?: string }
  | { type: 'resize'; id: string; ratio: number }
  | { type: 'maximize'; pane: PaneId };

export function initialWorkspace(id = ''): Workspace {
  return { panes: { 0: initialPages(id) }, active: 0, histories: { 0: { entries: id ? [id] : [], index: id ? 0 : -1 } }, root: { type: 'pane', pane: 0 }, maximized: null, nextPane: 1 };
}
function visit(history: FileHistory, id: string): FileHistory {
  if (!id || history.entries[history.index] === id) return history;
  const entries = [...history.entries.slice(0, history.index + 1), id].slice(-100);
  return { entries, index: entries.length - 1 };
}
export function paneIds(node: LayoutNode): PaneId[] { return node.type === 'pane' ? [node.pane] : [...paneIds(node.first), ...paneIds(node.second)]; }
function mapLayout(node: LayoutNode, transform: (node: LayoutNode) => LayoutNode): LayoutNode {
  return transform(node.type === 'pane' ? node : { ...node, first: mapLayout(node.first, transform), second: mapLayout(node.second, transform) });
}
function removePane(node: LayoutNode, pane: PaneId): LayoutNode | null {
  if (node.type === 'pane') return node.pane === pane ? null : node;
  const first = removePane(node.first, pane), second = removePane(node.second, pane);
  return first && second ? { ...node, first, second } : first || second;
}
function closePane(state: Workspace, pane: PaneId): Workspace {
  const root = removePane(state.root, pane);
  if (!root) return { ...state, panes: { [pane]: initialPages() }, histories: { [pane]: { entries: [], index: -1 } }, active: pane, maximized: null };
  const panes = { ...state.panes }, histories = { ...state.histories };
  delete panes[pane]; delete histories[pane];
  const remaining = paneIds(root), oldOrder = paneIds(state.root);
  const active = state.active === pane ? remaining[Math.min(oldOrder.indexOf(pane), remaining.length - 1)] : state.active;
  return { ...state, panes, histories, root, active, maximized: state.maximized === pane || remaining.length === 1 ? null : state.maximized };
}
export function workspaceReducer(state: Workspace, action: WorkspaceAction): Workspace {
  if (action.type === 'aliases') return { ...state, panes: Object.fromEntries(Object.entries(state.panes).map(([id, pane]) => [id, pagesReducer(pane, action)])), histories: Object.fromEntries(Object.entries(state.histories).map(([id, history]) => [id, { ...history, entries: history.entries.map(id => action.aliases[id] || id) }])) };
  if (action.type === 'resize') return Number.isFinite(action.ratio) ? { ...state, root: mapLayout(state.root, node => node.type === 'split' && node.id === action.id ? { ...node, ratio: Math.max(5, Math.min(95, action.ratio)) } : node) } : state;
  if (!state.panes[action.pane]) return state;
  if (action.type === 'activate') return state.active === action.pane ? state : { ...state, active: action.pane };
  if (action.type === 'close-pane') return closePane(state, action.pane);
  if (action.type === 'maximize') return { ...state, active: action.pane, maximized: state.maximized !== null || Object.keys(state.panes).length === 1 ? null : action.pane };
  if (action.type === 'split') {
    const id = state.nextPane, file = action.file ?? state.panes[action.pane].active;
    return { ...state, active: id, nextPane: id + 1, maximized: null,
      panes: { ...state.panes, [id]: initialPages(file) }, histories: { ...state.histories, [id]: { entries: file ? [file] : [], index: file ? 0 : -1 } },
      root: mapLayout(state.root, node => node.type === 'pane' && node.pane === action.pane ? { type: 'split', id: `split-${id}`, direction: action.direction, ratio: 50, first: node, second: { type: 'pane', pane: id } } : node) };
  }
  const panes = { ...state.panes }, histories = { ...state.histories };
  if (action.type === 'history') {
    const history = histories[action.pane], index = history.index + action.direction;
    if (index < 0 || index >= history.entries.length) return state;
    histories[action.pane] = { ...history, index };
    panes[action.pane] = pagesReducer(panes[action.pane], { type: 'open', id: history.entries[index] });
    return { ...state, panes, histories };
  }
  panes[action.pane] = pagesReducer(panes[action.pane], action.action);
  if (panes[action.pane] === state.panes[action.pane]) return state;
  if (action.action.type === 'open' || action.action.type === 'close') histories[action.pane] = visit(histories[action.pane], panes[action.pane].active);
  if (action.closeEmpty && action.action.type === 'close' && !panes[action.pane].items.length && Object.keys(panes).length > 1) {
    return closePane({ ...state, panes, histories }, action.pane);
  }
  return { ...state, panes, histories };
}

export type Rect = { x: number; y: number; width: number; height: number };
export const dividerSize = 6;
export const minimumPane = { width: 180, height: 150 };
export function minimumSize(node: LayoutNode): { width: number; height: number } {
  if (node.type === 'pane') return minimumPane;
  const a = minimumSize(node.first), b = minimumSize(node.second);
  return node.direction === 'columns' ? { width: a.width + b.width + dividerSize, height: Math.max(a.height, b.height) } : { width: Math.max(a.width, b.width), height: a.height + b.height + dividerSize };
}
export function ratioBounds(node: Extract<LayoutNode, { type: 'split' }>, rect: Rect): [number, number] {
  const dimension = node.direction === 'columns' ? 'width' : 'height';
  const available = Math.max(1, rect[dimension] - dividerSize), a = minimumSize(node.first)[dimension], b = minimumSize(node.second)[dimension];
  if (a + b > available) { const ratio = a / (a + b) * 100; return [ratio, ratio]; }
  return [Math.max(5, a / available * 100), Math.min(95, 100 - b / available * 100)];
}
export function layoutRects(root: LayoutNode, rect: Rect) {
  const panes: Record<PaneId, Rect> = {};
  const dividers: { node: Extract<LayoutNode, { type: 'split' }>; rect: Rect; parent: Rect }[] = [];
  function walk(node: LayoutNode, box: Rect) {
    if (node.type === 'pane') { panes[node.pane] = box; return; }
    const column = node.direction === 'columns', total = Math.max(0, (column ? box.width : box.height) - dividerSize);
    const [min, max] = ratioBounds(node, box), first = total * Math.max(min, Math.min(max, node.ratio)) / 100;
    const second = total - first;
    dividers.push({ node, parent: box, rect: column ? { x: box.x + first, y: box.y, width: dividerSize, height: box.height } : { x: box.x, y: box.y + first, width: box.width, height: dividerSize } });
    walk(node.first, column ? { ...box, width: first } : { ...box, height: first });
    walk(node.second, column ? { ...box, x: box.x + first + dividerSize, width: second } : { ...box, y: box.y + first + dividerSize, height: second });
  }
  walk(root, rect); return { panes, dividers };
}
