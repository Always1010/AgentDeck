export type FileTypeFilter = { mode: 'all' | 'allow' | 'deny'; extensions: string[]; custom: string[] };

export const defaultFileTypeFilter: FileTypeFilter = { mode: 'all', extensions: [], custom: [] };
export const NO_EXTENSION = '(无后缀)';

export const commonFileTypes = [
  ['.html', 'HTML'], ['.htm', 'HTM'], ['.md', 'Markdown'], ['.markdown', 'Markdown'],
  ['.txt', '文本'], ['.pdf', 'PDF'], ['.csv', 'CSV'], ['.tsv', 'TSV'],
  ['.json', 'JSON'], ['.js', 'JavaScript'], ['.ts', 'TypeScript'], ['.css', 'CSS'],
  ['.py', 'Python'], ['.ipynb', 'Notebook'], ['.docx', 'Word'], ['.xlsx', 'Excel'],
  ['.pptx', 'PowerPoint'], ['.svg', 'SVG'], ['.png', 'PNG'], ['.jpg', 'JPG'],
  ['.jpeg', 'JPEG'], ['.webp', 'WebP'], [NO_EXTENSION, '无后缀'],
] as const;

const extensionPattern = /^\.[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*$/u;
export function normalizeExtension(input: string): string | null {
  const value = input.trim().toLocaleLowerCase().replace(/^\*\./, '.');
  const extension = value.startsWith('.') ? value : `.${value}`;
  return extension.length <= 33 && extensionPattern.test(extension) ? extension : null;
}

export function isFileTypeFilter(value: unknown): value is FileTypeFilter {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<FileTypeFilter>;
  const validList = (list: unknown): list is string[] => Array.isArray(list) && list.length <= 100 && list.every(extension => typeof extension === 'string' && (extension === NO_EXTENSION || normalizeExtension(extension) === extension));
  return (item.mode === 'all' || item.mode === 'allow' || item.mode === 'deny') && validList(item.extensions) && validList(item.custom);
}

export function fileTypeVisible(name: string, filter: FileTypeFilter): boolean {
  if (filter.mode === 'all') return true;
  const lower = name.toLocaleLowerCase();
  const selected = filter.extensions.some(extension => extension === NO_EXTENSION ? !lower.includes('.') : lower.length > extension.length && lower.endsWith(extension));
  return filter.mode === 'allow' ? selected : !selected;
}
