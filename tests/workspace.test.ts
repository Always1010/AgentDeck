import { expect, test } from 'vitest';
import { initialWorkspace, workspaceReducer, layoutRects, paneIds } from '../app/web/workspace.js';

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
  state = workspaceReducer(state, { type: 'split', pane: 0, direction: 'columns', file: '' });
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
  state = workspaceReducer(state,{type:'split',pane:0,direction:'columns'});
  state = workspaceReducer(state,{type:'page',pane:1,action:{type:'open',id:'x'}});
  state = workspaceReducer(state,{type:'page',pane:0,action:{type:'open',id:'d'}});
  expect(state.histories[0]).toEqual({entries:['a','b','d'],index:2});
  expect(state.histories[1]).toEqual({entries:['b','x'],index:1});
  expect(workspaceReducer(state,{type:'history',pane:0,direction:1})).toBe(state);
  state = workspaceReducer(state,{type:'page',pane:0,action:{type:'open',id:'d',keep:true}});
  expect(state.histories[0].entries).toEqual(['a','b','d']);
});

test('nested splits preserve pages and ratios through maximize and empty-pane removal', () => {
  let state = initialWorkspace('a');
  state = workspaceReducer(state, { type: 'split', pane: 0, direction: 'columns', file: 'b' });
  state = workspaceReducer(state, { type: 'split', pane: 1, direction: 'rows', file: 'c' });
  state = workspaceReducer(state, { type: 'resize', id: 'split-1', ratio: 40 });
  expect(paneIds(state.root)).toEqual([0, 1, 2]);
  const root = state.root, panes = state.panes;
  state = workspaceReducer(state, { type: 'maximize', pane: 1 });
  expect(state.maximized).toBe(1);
  state = workspaceReducer(state, { type: 'maximize', pane: 1 });
  expect(state.root).toBe(root); expect(state.panes).toBe(panes);
  state = workspaceReducer(state, { type: 'page', pane: 2, action: { type: 'close', id: 'c' }, closeEmpty: true });
  expect(paneIds(state.root)).toEqual([0, 1]);
  expect(state.panes[2]).toBeUndefined();
  expect(state.root).toMatchObject({ ratio: 40, second: { type: 'pane', pane: 1 } });
  state = workspaceReducer(state, { type: 'page', pane: 1, action: { type: 'close', id: 'b' }, closeEmpty: true });
  state = workspaceReducer(state, { type: 'page', pane: 0, action: { type: 'close', id: 'a' }, closeEmpty: true });
  expect(paneIds(state.root)).toEqual([0]); expect(state.active).toBe(0);
});

test('keeping an empty pane preserves layout, and split after maximize restores all panes', () => {
  let state = initialWorkspace('a');
  state = workspaceReducer(state, { type: 'split', pane: 0, direction: 'rows', file: 'b' });
  const root = state.root;
  state = workspaceReducer(state, { type: 'page', pane: 1, action: { type: 'close', id: 'b' } });
  expect(state.root).toBe(root); expect(state.panes[1].items).toEqual([]);
  state = workspaceReducer(state, { type: 'maximize', pane: 0 });
  state = workspaceReducer(state, { type: 'split', pane: 0, direction: 'columns' });
  expect(state.maximized).toBeNull(); expect(state.active).toBe(2);
});

test('mixed layout geometry preserves the other half and does not create negative panes in a narrow window', () => {
  let state = initialWorkspace();
  state = workspaceReducer(state, { type: 'split', pane: 0, direction: 'columns' });
  state = workspaceReducer(state, { type: 'split', pane: 1, direction: 'rows' });
  const { panes, dividers } = layoutRects(state.root, { x: 0, y: 0, width: 1000, height: 800 });
  expect(panes[0]).toEqual({ x: 0, y: 0, width: 497, height: 800 });
  expect(panes[1]).toEqual({ x: 503, y: 0, width: 497, height: 397 });
  expect(panes[2]).toEqual({ x: 503, y: 403, width: 497, height: 397 });
  expect(dividers).toHaveLength(2);
  const small = layoutRects(state.root, { x: 0, y: 0, width: 100, height: 100 });
  expect(Object.values(small.panes).every(p => p.width >= 0 && p.height >= 0)).toBe(true);
});


test('splits copy only the active document into an independent pane and accept explicit targets', () => {
  let state = initialWorkspace('background');
  state = workspaceReducer(state, { type: 'page', pane: 0, action: { type: 'open', id: 'active' } });
  for (const direction of ['rows', 'columns'] as const) {
    const next = workspaceReducer(state, { type: 'split', pane: 0, direction });
    expect(next.panes[1].items).toEqual([{ id: 'active', kept: true }]);
    expect(next.panes[1]).not.toBe(state.panes[0]);
    expect(next.panes[0]).toBe(state.panes[0]);
    expect(next.histories[1]).toEqual({ entries: ['active'], index: 0 });
  }
  expect(workspaceReducer(state, { type: 'split', pane: 0, direction: 'rows', file: 'other' }).panes[1].active).toBe('other');
  expect(workspaceReducer(initialWorkspace(), { type: 'split', pane: 0, direction: 'rows' }).panes[1].items).toEqual([]);
});
