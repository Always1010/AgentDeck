import { useMemo, useState } from 'react';
import { formatJson, parseCsv, parseJson, type JsonNode } from './data.js';

function attempt<T>(fn: () => T): { value: T; error?: undefined } | { value?: undefined; error: string } {
  try { return { value: fn() }; } catch (error) { return { error: (error as Error).message }; }
}

export function CsvViewer({ text }: { text: string }) {
  const result = useMemo(() => attempt(() => parseCsv(text)), [text]);
  const [header, setHeader] = useState(true);
  if (result.error) return <p className="data-viewer-message" role="status">{result.error} 顶部“查看源码”和“复制原文”保留原始内容。</p>;
  const rows = result.value!;
  if (!rows.length) return <p className="data-viewer-message">CSV 文件为空。</p>;
  const columns = Math.max(...rows.map(row => row.length));
  return <div className="csv-viewer">
    <div className="data-viewer-controls">
      <label><input type="checkbox" checked={header} onChange={event => setHeader(event.target.checked)} />首行作为表头</label>
      <span>{rows.length} 行 · 最多 {columns} 列 · 只读</span>
    </div>
    <div className="csv-table-scroll"><table aria-label="CSV 数据"><tbody>{rows.map((row, index) => <tr key={index}>
      <th scope="row" className="csv-row-number">{index + 1}</th>
      {row.map((value, column) => header && index === 0
        ? <th scope="col" key={column}>{value}</th>
        : <td key={column}>{value}</td>)}
    </tr>)}</tbody></table></div>
  </div>;
}

function JsonBranch({ node, label, depth = 0, expanded }: { node: JsonNode; label?: string; depth?: number; expanded?: boolean }) {
  const [open, setOpen] = useState(expanded ?? depth === 0);
  if (node.kind === 'value') return <div className="json-value">{label && <span className="json-label">{label}: </span>}<span title={node.raw.length > 500 ? node.raw : undefined}>{node.raw.length > 500 ? `${node.raw.slice(0, 500)}…（完整值请查看原文）` : node.raw}</span></div>;
  const count = node.kind === 'array' ? node.items.length : node.members.length;
  return <div className="json-branch">
    <button className="json-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span aria-hidden="true">{open ? '▾' : '▸'}</span> {label && <span className="json-label">{label}: </span>}{node.kind === 'array' ? `[${count} 项]` : `{${count} 项}`}
    </button>
    {open && <div className="json-children">{node.kind === 'array'
      ? node.items.map((value, index) => <JsonBranch key={index} node={value} label={String(index)} depth={depth + 1} expanded={expanded} />)
      : node.members.map((member, index) => <JsonBranch key={index} node={member.value} label={member.rawKey} depth={depth + 1} expanded={expanded} />)}</div>}
  </div>;
}

export function JsonViewer({ text }: { text: string }) {
  const result = useMemo(() => attempt(() => parseJson(text)), [text]);
  const [mode, setMode] = useState<'tree' | 'formatted'>('tree');
  const [expansion, setExpansion] = useState<{ key: number; expanded?: boolean }>({ key: 0 });
  const formatted = useMemo(() => result.value && mode === 'formatted' ? formatJson(result.value) : '', [result, mode]);
  if (result.error) return <p className="data-viewer-message" role="status">{result.error} 顶部“查看源码”和“复制原文”保留原始内容。</p>;
  return <div className="json-viewer">
    <div className="data-viewer-controls">
      <button aria-pressed={mode === 'tree'} onClick={() => setMode('tree')}>结构</button>
      <button aria-pressed={mode === 'formatted'} onClick={() => setMode('formatted')}>格式化</button>
      {mode === 'tree' && <><button onClick={() => setExpansion(value => ({ key: value.key + 1, expanded: true }))}>展开全部</button><button onClick={() => setExpansion(value => ({ key: value.key + 1, expanded: false }))}>收起全部</button></>}
      <span className="muted">只读 · 数字保留原始写法</span>
    </div>
    {mode === 'tree' ? <div className="json-tree"><JsonBranch key={expansion.key} node={result.value!} expanded={expansion.expanded} /></div> : <pre className="json-formatted">{formatted}</pre>}
  </div>;
}
