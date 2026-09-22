export type OpenPage = { id: string; kept: boolean; title?: string };
export type Pages = { items: OpenPage[]; active: string; recent: string[] };
export type PageAction =
  | { type: 'open'; id: string; keep?: boolean }
  | { type: 'keep'; id: string }
  | { type: 'close'; id: string }
  | { type: 'title'; id: string; title: string }
  | { type: 'aliases'; aliases: Record<string, string> };

export function initialPages(id = ''): Pages {
  return { items: id ? [{ id, kept: true }] : [], active: id, recent: id ? [id] : [] };
}

export function pagesReducer(state: Pages, action: PageAction): Pages {
  if (action.type === 'open') {
    const existing = state.items.find(p => p.id === action.id);
    let items = state.items;
    if (existing) {
      if (action.keep && !existing.kept) items = items.map(p => p.id === action.id ? { ...p, kept: true } : p);
    } else {
      const page = { id: action.id, kept: !!action.keep };
      const temporary = items.findIndex(p => !p.kept);
      items = temporary >= 0 && !action.keep ? items.map((p, index) => index === temporary ? page : p) : [...items, page];
    }
    const ids = new Set(items.map(p => p.id));
    return { items, active: action.id, recent: [action.id, ...state.recent.filter(id => id !== action.id && ids.has(id))] };
  }
  if (action.type === 'keep') return { ...state, items: state.items.map(p => p.id === action.id ? { ...p, kept: true } : p) };
  if (action.type === 'title') {
    if (state.items.find(p => p.id === action.id)?.title === action.title) return state;
    return { ...state, items: state.items.map(p => p.id === action.id ? { ...p, title: action.title } : p) };
  }
  if (action.type === 'close') {
    const items = state.items.filter(p => p.id !== action.id);
    const recent = state.recent.filter(id => id !== action.id);
    return { items, recent, active: state.active === action.id ? recent[0] || items[0]?.id || '' : state.active };
  }
  const items: OpenPage[] = [];
  for (const page of state.items) {
    const id = action.aliases[page.id] || page.id;
    const existing = items.find(p => p.id === id);
    if (existing) existing.kept ||= page.kept;
    else items.push({ ...page, id });
  }
  return { items, active: action.aliases[state.active] || state.active, recent: [...new Set(state.recent.map(id => action.aliases[id] || id))] };
}
