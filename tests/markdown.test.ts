import { describe, expect, it } from 'vitest';
import { extractMarkdownHeadings } from '../app/web/Markdown.js';

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
});
