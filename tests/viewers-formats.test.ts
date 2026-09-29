import { describe, expect, it } from 'vitest';
import { hasTextSource, isImageFormat, versionedImageUrl } from '../app/web/viewers/formats.js';

describe('image capabilities', () => {
  it('keeps SVG readable as text and raster files out of text actions', () => {
    for (const format of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico']) {
      expect(isImageFormat(format)).toBe(true);
      expect(hasTextSource(format)).toBe(false);
    }
    expect(isImageFormat('svg')).toBe(true);
    expect(hasTextSource('svg')).toBe(true);
    expect(isImageFormat('html')).toBe(false);
  });
  it('loads the exact image version without replacing other URL information', () => {
    const url = new URL(versionedImageUrl('http://127.0.0.1:4311/m/id/a%20b.svg?x=1', '12:34:56'));
    expect(url.pathname).toBe('/m/id/a%20b.svg');
    expect(url.searchParams.get('fileVersion')).toBe('12:34:56');
    expect(url.searchParams.get('x')).toBe('1');
  });
});
