import { expect, test } from 'vitest';
import { fileTypeVisible, isFileTypeFilter, NO_EXTENSION, normalizeExtension, type FileTypeFilter } from '../app/web/fileExtensions.js';

test('normalizes custom suffixes and rejects paths or malformed values', () => {
  expect(normalizeExtension('*.LOG')).toBe('.log');
  expect(normalizeExtension('tar.gz')).toBe('.tar.gz');
  for (const input of ['', '.', '../log', 'a/b', 'a\\b', 'foo bar']) expect(normalizeExtension(input)).toBeNull();
  expect(isFileTypeFilter({ mode: 'allow', extensions: ['.html'], custom: ['.log'] })).toBe(true);
  expect(isFileTypeFilter({ mode: 'allow', extensions: ['../log'], custom: [] })).toBe(false);
});

test('allow and deny rules match case-insensitive suffixes and extensionless files', () => {
  const filter: FileTypeFilter = { mode: 'allow', extensions: ['.html', '.tar.gz', NO_EXTENSION], custom: ['.tar.gz'] };
  expect(fileTypeVisible('Report.HTML', filter)).toBe(true);
  expect(fileTypeVisible('backup.TAR.GZ', filter)).toBe(true);
  expect(fileTypeVisible('LICENSE', filter)).toBe(true);
  expect(fileTypeVisible('notes.md', filter)).toBe(false);
  expect(fileTypeVisible('readme.html.bak', filter)).toBe(false);
  expect(fileTypeVisible('notes.md', { ...filter, mode: 'deny' })).toBe(true);
  expect(fileTypeVisible('Report.HTML', { ...filter, mode: 'deny' })).toBe(false);
  expect(fileTypeVisible('anything.md', { ...filter, mode: 'all' })).toBe(true);
  expect(fileTypeVisible('anything.md', { ...filter, extensions: [] })).toBe(false);
});
