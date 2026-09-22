import { expect, test } from 'vitest';
import { initialWorkspace, workspaceReducer } from '../app/web/workspace.js';

test('pane previews and kept pages are independent, including the same file', () => {
  let state = initialWorkspace('same');
  state = workspaceReducer(state, { type: 'page', pane: 1, action: { type: 'open', id: 'same' } });
  state = workspaceReducer(state, { type: 'page', pane: 1, action: { type: 'open', id: 'other' } });
  expect(state.panes[0].active).toBe('same');
  expect(state.panes[0].items).toEqual([{ id: 'same', kept: true }]);
  expect(state.panes[1].items).toEqual([{ id: 'other', kept: false }]);
  state = workspaceReducer(state, { type: 'activate', pane: 1 });
  state = workspaceReducer(state, { type: 'page', pane: 1, action: { type: 'close', id: 'other' } });
  expect(state.active).toBe(1);
  expect(state.panes[0].items).toHaveLength(1);
});
