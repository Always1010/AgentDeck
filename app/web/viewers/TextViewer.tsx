import type { Entry } from '../../shared/model.js';
import { Markdown } from '../Markdown.js';
import { CsvViewer, JsonViewer } from './DataViewer.js';

export function TextViewer({ text, entry, source, navigate, keyboardActive, shortcutsEnabled }: {
  text: string; entry: Entry; source: boolean; navigate: (path: string) => void; keyboardActive: boolean; shortcutsEnabled: boolean;
}) {
  if (!source && entry.format === 'csv') return <CsvViewer text={text} />;
  if (!source && entry.format === 'json') return <JsonViewer text={text} />;
  return !source && /^(md|markdown)$/.test(entry.format)
    ? <Markdown text={text} entry={entry} previewOrigin={new URL(entry.previewUrl!).origin} navigate={navigate} keyboardActive={keyboardActive} shortcutsEnabled={shortcutsEnabled} />
    : <pre>{text}</pre>;
}
