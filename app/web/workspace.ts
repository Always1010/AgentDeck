import { initialPages, pagesReducer, type PageAction, type Pages } from './pages.js';

export type PaneId = 0 | 1;
export type Layout = 'single' | 'columns' | 'rows';
export const isLayout = (value: unknown): value is Layout => value === 'single' || value === 'columns' || value === 'rows';
export type FileHistory = { entries: string[]; index: number };
export type Workspace = { panes: [Pages, Pages]; active: PaneId; histories: [FileHistory, FileHistory] };
export type WorkspaceAction = { type: 'activate'; pane: PaneId } | { type: 'page'; pane: PaneId; action: PageAction } | { type: 'aliases'; aliases: Record<string, string> } | { type: 'history'; pane: PaneId; direction: -1 | 1 };
export function initialWorkspace(id = ''): Workspace { return { panes: [initialPages(id), initialPages()], active: 0, histories: [{ entries: id ? [id] : [], index: id ? 0 : -1 }, { entries: [], index: -1 }] }; }
function visit(history: FileHistory, id: string): FileHistory {
  if (!id || history.entries[history.index] === id) return history;
  const entries = [...history.entries.slice(0, history.index + 1), id].slice(-100);
  return { entries, index: entries.length - 1 };
}
export function workspaceReducer(state: Workspace, action: WorkspaceAction): Workspace {
  if (action.type === 'activate') return state.active === action.pane ? state : { ...state, active: action.pane };
  if (action.type === 'aliases') return { ...state, panes: state.panes.map(pane => pagesReducer(pane, action)) as [Pages, Pages], histories: state.histories.map(history => ({ ...history, entries: history.entries.map(id => action.aliases[id] || id) })) as [FileHistory, FileHistory] };
  const panes: [Pages, Pages] = [...state.panes];
  const histories: [FileHistory, FileHistory] = [...state.histories];
  if (action.type === 'history') {
    const history = histories[action.pane];
    const index = history.index + action.direction;
    if (index < 0 || index >= history.entries.length) return state;
    histories[action.pane] = { ...history, index };
    panes[action.pane] = pagesReducer(panes[action.pane], { type: 'open', id: history.entries[index] });
    return { ...state, panes, histories };
  }
  panes[action.pane] = pagesReducer(panes[action.pane], action.action);
  if (action.action.type === 'open' || action.action.type === 'close') histories[action.pane] = visit(histories[action.pane], panes[action.pane].active);
  return { ...state, panes, histories };
}
