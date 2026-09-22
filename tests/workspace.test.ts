import { expect, test } from 'vitest';
import { initialWorkspace, workspaceReducer } from '../app/web/workspace.js';

test('history preserves pinned pages and opens missing targets without replacing background tabs', () => {
  let state = initialWorkspace('a');
  for (const id of ['b', 'c']) state = workspaceReducer(state, { type: 'page', pane: 0, action: { type: 'open', id } });
  state = workspaceReducer(state, { type: 'page', pane: 0, action: { type: 'keep', id: 'c' } });
  state = workspaceReducer(state, { type: 'history', pane: 0, direction: -1 });
  expect(state.panes[0].items.map(p => p.id)).toEqual(['a', 'c', 'b']);
  expect(state.histories[0]).toEqual({ entries: ['a', 'b', 'c'], index: 1 });
  state = workspaceReducer(state, { type: 'history', pane: 0, direction: -1 });
  expect(state.panes[0].active).toBe('a');
  expect(state.panes[0].items).toHaveLength(3);
});

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

test('history survives replaced previews, branches on new visits and is pane-local', () => {
  let state = initialWorkspace();
  for (const id of ['a','b','c']) state = workspaceReducer(state,{type:'page',pane:0,action:{type:'open',id}});
  expect(state.panes[0].items).toHaveLength(1);
  state = workspaceReducer(state,{type:'history',pane:0,direction:-1});
  expect(state.panes[0].active).toBe('b');
  state = workspaceReducer(state,{type:'history',pane:0,direction:-1});
  expect(state.panes[0].active).toBe('a');
  expect(workspaceReducer(state,{type:'history',pane:0,direction:-1})).toBe(state);
  state = workspaceReducer(state,{type:'history',pane:0,direction:1});
  state = workspaceReducer(state,{type:'page',pane:1,action:{type:'open',id:'x'}});
  state = workspaceReducer(state,{type:'page',pane:0,action:{type:'open',id:'d'}});
  expect(state.histories[0]).toEqual({entries:['a','b','d'],index:2});
  expect(state.histories[1]).toEqual({entries:['x'],index:0});
  expect(workspaceReducer(state,{type:'history',pane:0,direction:1})).toBe(state);
  state = workspaceReducer(state,{type:'page',pane:0,action:{type:'open',id:'d',keep:true}});
  expect(state.histories[0].entries).toEqual(['a','b','d']);
});
