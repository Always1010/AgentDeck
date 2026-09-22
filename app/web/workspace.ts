import { initialPages, pagesReducer, type PageAction, type Pages } from './pages.js';

export type PaneId = 0 | 1;
export type Layout = 'single' | 'columns' | 'rows';
export const isLayout = (value: unknown): value is Layout => value === 'single' || value === 'columns' || value === 'rows';
export type Workspace = { panes: [Pages, Pages]; active: PaneId };
export type WorkspaceAction = { type: 'activate'; pane: PaneId } | { type: 'page'; pane: PaneId; action: PageAction } | { type: 'aliases'; aliases: Record<string, string> };
export function initialWorkspace(id = ''): Workspace { return { panes: [initialPages(id), initialPages()], active: 0 }; }
export function workspaceReducer(state: Workspace, action: WorkspaceAction): Workspace {
  if (action.type === 'activate') return state.active === action.pane ? state : { ...state, active: action.pane };
  if (action.type === 'aliases') return { ...state, panes: state.panes.map(pane => pagesReducer(pane, action)) as [Pages, Pages] };
  const panes: [Pages, Pages] = [...state.panes];
  panes[action.pane] = pagesReducer(panes[action.pane], action.action);
  return { ...state, panes };
}
