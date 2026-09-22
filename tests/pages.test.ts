import { expect, test } from 'vitest';
import { initialPages, pagesReducer } from '../app/web/pages.js';

test('browsing replaces only the temporary page; keeping and revisiting never duplicate it', () => {
  let state = initialPages();
  state = pagesReducer(state, { type: 'open', id: 'report-a' });
  state = pagesReducer(state, { type: 'keep', id: 'report-a' });
  state = pagesReducer(state, { type: 'open', id: 'report-b' });
  state = pagesReducer(state, { type: 'open', id: 'report-c' });
  expect(state.items).toEqual([{ id: 'report-a', kept: true }, { id: 'report-c', kept: false }]);
  state = pagesReducer(state, { type: 'open', id: 'report-a' });
  expect(state.items).toHaveLength(2);
  expect(state.active).toBe('report-a');
  state = pagesReducer(state, { type: 'open', id: 'report-c', keep: true });
  expect(state.items.every(p => p.kept)).toBe(true);
});

test('closing active returns to the last used remaining page, closing background preserves active', () => {
  let state = initialPages('a');
  state = pagesReducer(state, { type: 'open', id: 'b', keep: true });
  state = pagesReducer(state, { type: 'open', id: 'c', keep: true });
  state = pagesReducer(state, { type: 'open', id: 'a' });
  state = pagesReducer(state, { type: 'close', id: 'b' });
  expect(state.active).toBe('a');
  state = pagesReducer(state, { type: 'close', id: 'a' });
  expect(state.active).toBe('c');
  expect(pagesReducer(state, { type: 'close', id: 'c' })).toEqual(initialPages());
});

test('legacy aliases merge duplicate tabs and preserve kept status and selection', () => {
  let state = initialPages('legacy');
  state = pagesReducer(state, { type: 'open', id: 'file:mount:report.html' });
  state = pagesReducer(state, { type: 'aliases', aliases: { legacy: 'file:mount:report.html' } });
  expect(state).toEqual(initialPages('file:mount:report.html'));
});
