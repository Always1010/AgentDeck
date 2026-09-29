import type { Entry } from '../../shared/model.js';
import { Markdown } from '../Markdown.js';

export function TextViewer({ text, entry, source, navigate, keyboardActive, shortcutsEnabled }: {
  text: string; entry: Entry; source: boolean; navigate: (path: string) => void; keyboardActive: boolean; shortcutsEnabled: boolean;
}) {
  return !source && /^(md|markdown)$/.test(entry.format)
    ? <Markdown text={text} entry={entry} previewOrigin={new URL(entry.previewUrl!).origin} navigate={navigate} keyboardActive={keyboardActive} shortcutsEnabled={shortcutsEnabled} />
    : <pre>{text}</pre>;
}
