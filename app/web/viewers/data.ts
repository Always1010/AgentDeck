export const dataLimits = { characters: 1_000_000, rows: 1000, columns: 200, cells: 20_000, jsonNodes: 5000, jsonDepth: 64 } as const;

function checkSize(text: string) {
  if (text.length > dataLimits.characters) throw new Error('内容超过 100 万字符，请使用原文或下载。');
}

/** CSV fields are always strings: no numeric conversion or formula evaluation. */
export function parseCsv(text: string): string[][] {
  checkSize(text);
  const value = text.startsWith('\uFEFF') ? text.slice(1) : text;
  if (!value) return [];
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false, closedQuote = false, cells = 0;
  function pushField() {
    if (row.length >= dataLimits.columns || ++cells > dataLimits.cells) throw new Error('表格预览最多支持 200 列、2 万个单元格，请使用原文或下载。');
    row.push(field); field = ''; closedQuote = false;
  }
  function pushRow() {
    pushField();
    if (rows.length >= dataLimits.rows) throw new Error('表格预览最多支持 1000 行，请使用原文或下载。');
    rows.push(row); row = [];
  }
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (quoted) {
      if (char === '"') {
        if (value[index + 1] === '"') { field += '"'; index++; }
        else { quoted = false; closedQuote = true; }
      } else field += char;
      continue;
    }
    if (char === ',') { pushField(); continue; }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && value[index + 1] === '\n') index++;
      pushRow(); continue;
    }
    if (closedQuote) throw new Error('CSV 引号结束后只能跟逗号或换行，请查看原文。');
    if (char === '"') {
      if (field) throw new Error('CSV 未加引号的字段中出现引号，请查看原文。');
      quoted = true;
    } else field += char;
  }
  if (quoted) throw new Error('CSV 引号未闭合，请查看原文。');
  if (row.length || field || closedQuote || value.endsWith(',')) pushRow();
  return rows;
}

export type JsonNode =
  | { kind: 'value'; raw: string }
  | { kind: 'array'; items: JsonNode[] }
  | { kind: 'object'; members: { key: string; rawKey: string; value: JsonNode }[] };

/** Parse structure while retaining every primitive token, including unsafe JS integers. */
export function parseJson(text: string): JsonNode {
  checkSize(text);
  let index = 0, nodes = 0;
  const fail = (): never => { throw new Error(`JSON 格式错误（字符 ${index + 1}），请查看原文。`); };
  function space() { while (/[\t\n\r ]/.test(text[index] || '\0')) index++; }
  function string() {
    const start = index;
    if (text[index++] !== '"') return fail();
    while (index < text.length) {
      const char = text[index++];
      if (char === '\\') { index++; continue; }
      if (char === '"') {
        const raw = text.slice(start, index);
        try { return { raw, value: JSON.parse(raw) as string }; } catch { return fail(); }
      }
    }
    return fail();
  }
  function parse(depth: number): JsonNode {
    space();
    if (depth > dataLimits.jsonDepth || ++nodes > dataLimits.jsonNodes) throw new Error('JSON 结构超过 64 层或 5000 个节点，请使用原文或下载。');
    const char = text[index];
    if (char === '"') return { kind: 'value', raw: string().raw };
    if (char === '{') {
      index++; space();
      const members: Extract<JsonNode, { kind: 'object' }>['members'] = [];
      if (text[index] === '}') { index++; return { kind: 'object', members }; }
      while (index < text.length) {
        space(); const key = string(); space();
        if (text[index++] !== ':') return fail();
        members.push({ key: key.value, rawKey: key.raw, value: parse(depth + 1) }); space();
        if (text[index] === '}') { index++; return { kind: 'object', members }; }
        if (text[index++] !== ',') return fail();
      }
      return fail();
    }
    if (char === '[') {
      index++; space(); const items: JsonNode[] = [];
      if (text[index] === ']') { index++; return { kind: 'array', items }; }
      while (index < text.length) {
        items.push(parse(depth + 1)); space();
        if (text[index] === ']') { index++; return { kind: 'array', items }; }
        if (text[index++] !== ',') return fail();
      }
      return fail();
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(index));
    if (!token) return fail();
    index += token[0].length;
    return { kind: 'value', raw: token[0] };
  }
  const result = parse(0); space();
  if (index !== text.length) fail();
  return result;
}

export function formatJson(node: JsonNode, depth = 0): string {
  if (node.kind === 'value') return node.raw;
  const values = node.kind === 'array' ? node.items.map(value => formatJson(value, depth + 1)) : node.members.map(member => `${member.rawKey}: ${formatJson(member.value, depth + 1)}`);
  const [open, close] = node.kind === 'array' ? ['[', ']'] : ['{', '}'];
  return values.length ? `${open}\n${values.map(value => '  '.repeat(depth + 1) + value).join(',\n')}\n${'  '.repeat(depth)}${close}` : open + close;
}
