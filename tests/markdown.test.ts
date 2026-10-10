import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { extractMarkdownHeadings, Markdown } from '../app/web/Markdown.js';
import type { Entry } from '../app/shared/model.js';

describe('Markdown document outline', () => {
  it('extracts three heading levels, setext headings and stable duplicate anchors', () => {
    expect(extractMarkdownHeadings(`# Guide

## Start
### **Details**
## Start
Appendix
--------
#### Hidden`)).toEqual([
      { level: 1, label: 'Guide', id: 'guide' },
      { level: 2, label: 'Start', id: 'start' },
      { level: 3, label: 'Details', id: 'details' },
      { level: 2, label: 'Start', id: 'start-2' },
      { level: 2, label: 'Appendix', id: 'appendix' },
    ]);
  });

  it('ignores headings inside fenced code and preserves linked heading labels', () => {
    expect(extractMarkdownHeadings(`## [Overview](./guide.md)

~~~md
# Example only
~~~

### Real`)).toEqual([
      { level: 2, label: 'Overview', id: 'overview' },
      { level: 3, label: 'Real', id: 'real' },
    ]);
  });

  it('uses parsed inline text and counts every rendered level before filtering the outline', () => {
    const text = `#### Same
## Same
## Same-2
## foo_bar &amp; **bold**
## ![Alt_label](./image.svg) &copy;
> ### Nested \\*literal\\*

    # Code only

~~~
## Fenced only
~~~`;
    const headings = extractMarkdownHeadings(text);
    expect(headings).toEqual([
      { level: 2, label: 'Same', id: 'same-2' },
      { level: 2, label: 'Same-2', id: 'same-2-2' },
      { level: 2, label: 'foo_bar & bold', id: 'foo_bar-bold' },
      { level: 2, label: 'Alt_label ©', id: 'alt_label' },
      { level: 3, label: 'Nested *literal*', id: 'nested-literal' },
    ]);
    const entry: Entry = { id: 'file:mount:guide.md', projectId: 'project', mountId: 'mount', title: 'guide', kind: 'markdown', format: 'md', relativePath: 'guide.md', resourceRoot: '', updatedAt: 0, refreshMode: 'prompt', status: 'ready', previewUrl: 'http://127.0.0.1:4411/m/mount/guide.md' };
    const html = renderToStaticMarkup(createElement(Markdown, { text, entry, previewOrigin: 'http://127.0.0.1:4411', navigate: () => undefined }));
    const renderedIds = [...html.matchAll(/<h([1-6]) id="([^"]+)"/g)].map(match => ({ level: Number(match[1]), id: match[2] }));
    const prefix = renderedIds[0].id.slice(0, -'same'.length);
    expect(renderedIds).toEqual([
      { level: 4, id: prefix + 'same' },
      ...headings.map(heading => ({ level: heading.level, id: prefix + heading.id })),
    ]);
    expect(new Set(renderedIds.map(heading => heading.id)).size).toBe(renderedIds.length);
    expect(html).toContain('markdown-section');
  });

  it('keeps GFM tables, task lists and strikethrough while deriving heading anchors', () => {
    const text = '## ~~Before~~ After\n\n| Key | Value |\n| --- | --- |\n| one | two |\n\n- [x] Done';
    expect(extractMarkdownHeadings(text)).toEqual([{ level: 2, label: 'Before After', id: 'before-after' }]);
    const entry = { id: 'entry', mountId: 'mount', relativePath: 'guide.md', previewUrl: 'http://127.0.0.1:4411/m/mount/guide.md' } as Entry;
    const html = renderToStaticMarkup(createElement(Markdown, { text, entry, previewOrigin: 'http://127.0.0.1:4411', navigate: () => undefined }));
    expect(html).toContain('<table>');
    expect(html).toContain('<del>Before</del>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked=""');
  });
});
