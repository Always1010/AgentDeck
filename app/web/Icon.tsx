export type IconName = 'sidebar' | 'tool' | 'plus' | 'close' | 'refresh' | 'star' | 'external' | 'more' | 'expand' | 'collapse' | 'save' | 'edit' | 'pause' | 'play' | 'trash' | 'unmount' | 'filter' | 'split' | 'code' | 'book' | 'copy';
const paths: Record<IconName, string> = {
  sidebar: 'M3 4h18v16H3V4Zm6 0v16',
  tool: 'M14.7 6.3a5 5 0 0 0-6.4 6.4L3 18l3 3 5.3-5.3a5 5 0 0 0 6.4-6.4L14 13l-3-3 3.7-3.7Z',
  plus: 'M12 5v14M5 12h14',
  close: 'm6 6 12 12M18 6 6 18',
  refresh: 'M20 7v5h-5M4 17v-5h5M6.1 6.1A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.9 5.9',
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z',
  external: 'M14 3h7v7M21 3l-10 10M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  expand: 'M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5',
  collapse: 'M3 8h5V3M16 3v5h5M21 16h-5v5M8 21v-5H3',
  save: 'M5 3h12l4 4v14H3V3h2Zm2 0v6h10V3M7 21v-8h10v8',
  edit: 'm16 3 5 5-12 12-6 1 1-6L16 3Zm-3 3 5 5',
  pause: 'M8 5v14M16 5v14',
  play: 'm7 4 14 8-14 8V4Z',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  unmount: 'M10 5H4v14h6M14 7l5 5-5 5M8 12h11',
  filter: 'M3 5h18l-7 8v6l-4 2v-8L3 5Z',
  split: 'M3 4h18v16H3V4Zm9 0v16',
  code: 'm8 8-4 4 4 4m8-8 4 4-4 4m-3-11-2 18',
  book: 'M12 6C9 4 6 4 3 5v14c3-1 6-1 9 1m0-14c3-2 6-2 9-1v14c-3-1-6-1-9 1m0-14v14',
  copy: 'M8 7h12v14H8V7ZM4 17H3V3h13v2',
};
export function Icon({ name, filled = false }: { name: IconName; filled?: boolean }) {
  return <svg className="ui-icon" width="16" height="16" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={name === 'more' ? 3.5 : 1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}
