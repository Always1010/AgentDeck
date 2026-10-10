import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import type { Entry } from '../shared/model.js';
import { previewPath } from '../shared/model.js';
import { isEditing } from './shortcuts.js';

export type MarkdownHeading = { level: number; label: string; id: string };
type MarkdownNode = { type: string; depth?: number; value?: string; alt?: string; children?: MarkdownNode[]; data?: { hName?: string; hProperties?: Record<string, unknown> } };

function sectionNode(heading: MarkdownNode, body: MarkdownNode[], level: number): MarkdownNode {
  return {
    type: 'blockquote',
    data: { hName: 'details', hProperties: { className: ['markdown-section', `markdown-section-level-${level}`], open: true } },
    children: [{ type: 'blockquote', data: { hName: 'summary' }, children: [heading] }, ...body],
  };
}

function groupSections(nodes: MarkdownNode[], levels: number[], position = 0): MarkdownNode[] {
  const level = levels[position];
  if (!level) return nodes;
  const result: MarkdownNode[] = [];
  for (let index = 0; index < nodes.length;) {
    const node = nodes[index];
    if (node.type !== 'heading' || node.depth !== level) {
      result.push(node); index++; continue;
    }
    let end = index + 1;
    while (end < nodes.length && !(nodes[end].type === 'heading' && (nodes[end].depth || 7) <= level)) end++;
    const body = groupSections(nodes.slice(index + 1, end), levels, position + 1);
    result.push(sectionNode(node, body, level));
    index = end;
  }
  return result;
}

export function remarkCollapsibleSections() {
  return (tree: MarkdownNode) => {
    if (!tree.children) return;
    const firstLevelCount = tree.children.filter(node => node.type === 'heading' && node.depth === 1).length;
    tree.children = groupSections(tree.children, firstLevelCount > 1 ? [1, 2] : [2]);
  };
}

function headingLabel(node: MarkdownNode): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value || '';
  if (node.type === 'image' || node.type === 'imageReference') return node.alt || '';
  if (node.type === 'break') return '\n';
  return node.children?.map(headingLabel).join('') || '';
}

function headingSlug(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '-') || 'section';
}

const markdownParser = unified().use(remarkParse).use(remarkGfm).freeze();

function parseMarkdown(text: string, prefix = '', maximumLevel = 3) {
  const tree = markdownParser.parse(text) as MarkdownNode;
  const headings: MarkdownHeading[] = [];
  const used = new Set<string>();
  function visit(node: MarkdownNode) {
    if (node.type === 'heading') {
      const label = headingLabel(node).trim();
      const base = headingSlug(label);
      let id = base, count = 1;
      while (used.has(id)) id = `${base}-${++count}`;
      used.add(id);
      node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id: prefix + id } };
      // Every rendered heading consumes its anchor, including levels omitted from the TOC.
      if ((node.depth || 7) <= maximumLevel) headings.push({ level: node.depth!, label, id });
    }
    node.children?.forEach(visit);
  }
  visit(tree);
  return { tree, headings };
}

export function extractMarkdownHeadings(text: string, maximumLevel = 3): MarkdownHeading[] {
  return parseMarkdown(text, '', maximumLevel).headings;
}

function MarkdownToc({ headings, prefix, open, setOpen, sections, setSections }: { headings: MarkdownHeading[]; prefix: string; open: boolean; setOpen: (open: boolean) => void; sections: boolean; setSections: (open: boolean) => void }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const trigger = useRef<HTMLButtonElement>(null);
  const hasChildren = (index: number) => Boolean(headings[index + 1] && headings[index + 1].level > headings[index].level);
  const hidden = (index: number) => {
    let level = headings[index].level;
    for (let cursor = index - 1; cursor >= 0; cursor--) {
      if (headings[cursor].level >= level) continue;
      if (collapsed.has(headings[cursor].id)) return true;
      level = headings[cursor].level;
    }
    return false;
  };
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  };
  const navigate = (id: string) => {
    const target = document.getElementById(prefix + id);
    for (let parent = target?.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true;
    target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    const reader = target?.closest('.reader');
    if (reader && reader.clientWidth < 720) setOpen(false);
  };
  const branches = headings.filter((_, index) => hasChildren(index)).map(heading => heading.id);
  return <div className="markdown-toc-region">
    <button ref={trigger} className="markdown-toc-trigger" type="button" aria-label="展开文档目录" aria-keyshortcuts="T" hidden={open} onClick={() => setOpen(true)}><span aria-hidden="true">☰</span><span>目录</span><kbd aria-hidden="true">T</kbd></button>
    <div className={`markdown-toc-frame${open ? ' is-open' : ''}`} aria-hidden={!open}>
      <aside className="markdown-toc" aria-label="文档目录">
        <header><strong>内容目录</strong><button type="button" aria-label="收起文档目录" onClick={close}>×</button></header>
        {(branches.length > 0 || sections) && <div className="markdown-toc-tools">
          {branches.length > 0 && <><button type="button" onClick={() => setCollapsed(new Set(branches))}>收起目录</button><button type="button" onClick={() => setCollapsed(new Set())}>展开目录</button></>}
          {sections && <><button type="button" onClick={() => setSections(false)}>收起正文</button><button type="button" onClick={() => setSections(true)}>展开正文</button></>}
        </div>}
        <nav aria-label="标题目录">{headings.map((heading, index) => {
          const branch = hasChildren(index), branchOpen = !collapsed.has(heading.id);
          return <div className="markdown-toc-row" data-level={heading.level} hidden={hidden(index)} key={heading.id}>
            <button className="markdown-toc-link" type="button" title={heading.label} onClick={() => navigate(heading.id)}>{heading.label}</button>
            {branch && <button className="markdown-toc-branch" type="button" aria-label={branchOpen ? `收起 ${heading.label} 的子目录` : `展开 ${heading.label} 的子目录`} aria-expanded={branchOpen} onClick={() => setCollapsed(current => {
              const next = new Set(current);
              if (next.has(heading.id)) next.delete(heading.id); else next.add(heading.id);
              return next;
            })}><span aria-hidden="true">⌄</span></button>}
          </div>;
        })}</nav>
      </aside>
    </div>
  </div>;
}

export function Markdown({ text, entry, previewOrigin, navigate, keyboardActive = false, shortcutsEnabled = true }: { text: string; entry: Entry; previewOrigin: string; navigate: (path: string) => void; keyboardActive?: boolean; shortcutsEnabled?: boolean }) {
  const article = useRef<HTMLElement>(null);
  const prefixId = useId();
  const parsed = useMemo(() => parseMarkdown(text, prefixId), [text, prefixId]);
  const headings = parsed.headings;
  // The directory and the body consume the same parsed nodes and assigned anchors.
  const preparedMarkdown = useMemo(() => () => (tree: MarkdownNode) => { tree.children = parsed.tree.children; }, [parsed]);
  const hasSections = headings.some(heading => heading.level === 2) || headings.filter(heading => heading.level === 1).length > 1;
  const [tocOpen, setTocOpen] = useState(true);
  const beforePrint = useRef<boolean[] | undefined>(undefined);
  const base = entry.previewUrl || previewOrigin + previewPath(entry.mountId, entry.relativePath);
  const prefix = entry.sourceKey ? `/t/${entry.sourceKey}/` : previewPath(entry.mountId, '');

  useLayoutEffect(() => {
    const reader = article.current?.closest<HTMLElement>('.reader');
    const shell = article.current?.parentElement;
    if (!reader || !shell) return;
    setTocOpen(reader.clientWidth >= 720);
    const measure = () => shell.style.setProperty('--markdown-reader-height', `${reader.clientHeight}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(reader);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!keyboardActive || !headings.length) return;
    function keydown(event: KeyboardEvent) {
      if (document.querySelector('[data-workbench-dialog]') || event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key === 'Escape' && tocOpen) {
        event.preventDefault(); event.stopImmediatePropagation(); setTocOpen(false); return;
      }
      if (shortcutsEnabled && !event.shiftKey && event.key.toLowerCase() === 't' && !isEditing(event.target, event.composedPath())) {
        event.preventDefault(); event.stopImmediatePropagation(); setTocOpen(value => !value);
      }
    }
    document.addEventListener('keydown', keydown, true);
    return () => document.removeEventListener('keydown', keydown, true);
  }, [keyboardActive, headings.length, shortcutsEnabled, tocOpen]);
  useEffect(() => {
    const details = () => [...(article.current?.querySelectorAll<HTMLDetailsElement>('details.markdown-section') || [])];
    const expand = () => details().forEach(section => { section.open = true; });
    function find(event: KeyboardEvent) { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') expand(); }
    function before() { if (!beforePrint.current) beforePrint.current = details().map(section => section.open); expand(); }
    function after() {
      const state = beforePrint.current;
      if (!state) return;
      details().forEach((section, index) => { section.open = state[index] ?? true; });
      beforePrint.current = undefined;
    }
    document.addEventListener('keydown', find, true);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => { document.removeEventListener('keydown', find, true); window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after); };
  }, [text]);

  const setSections = (open: boolean) => article.current?.querySelectorAll<HTMLDetailsElement>('details.markdown-section').forEach(section => { section.open = open; });

  function url(value: string) {
    if (value.startsWith('#')) return value;
    if (/^https?:\/\//i.test(value)) return value;
    if (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//') || value.includes('\\')) return '';
    try {
      const result = new URL(value, base);
      if (result.origin !== previewOrigin || !result.pathname.startsWith(prefix)) return '';
      const decoded = decodeURIComponent(result.pathname.slice(prefix.length));
      if (decoded.split('/').some(part => part === '..' || part === '.') || decoded.includes('\\')) return '';
      return result.href;
    } catch { return ''; }
  }
  return <div className="markdown-shell">
    {headings.length > 0 && <MarkdownToc headings={headings} prefix={prefixId} open={tocOpen} setOpen={setTocOpen} sections={hasSections} setSections={setSections} />}
    <article ref={article} className="markdown"><ReactMarkdown remarkPlugins={[preparedMarkdown, remarkCollapsibleSections]} skipHtml urlTransform={url} components={{
      a: ({ href, children }) => {
        if (href?.startsWith('#')) return <a href={href} onClick={event => {
          event.preventDefault();
          try {
            const target = article.current?.querySelector(`#${CSS.escape(prefixId + decodeURIComponent(href.slice(1)))}`);
            for (let parent = target?.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true;
            target?.scrollIntoView();
          } catch { /* Invalid fragment does not interrupt reading. */ }
        }}>{children}</a>;
        const local = href?.startsWith(previewOrigin + prefix);
        return <a href={href || undefined} target="_blank" rel="noopener noreferrer" onClick={event => {
          if (local && href && /\.(html?|md|markdown|txt|csv|json)(?:[?#]|$)/i.test(href)) {
            event.preventDefault(); navigate(decodeURIComponent(new URL(href).pathname.slice(prefix.length)));
          }
        }}>{children}</a>;
      }
    }}>{text}</ReactMarkdown></article>
  </div>;
}
