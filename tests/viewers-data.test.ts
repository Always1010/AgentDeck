import { describe, expect, it } from 'vitest';
import { dataLimits, formatJson, parseCsv, parseJson } from '../app/web/viewers/data.js';

describe('CSV preview parsing', () => {
  it('retains leading zeros, formulas and empty cells as strings', () => {
    expect(parseCsv('\uFEFFid,value,last\r\n001,=SUM(A1),\r\n002,3.00,x')).toEqual([['id', 'value', 'last'], ['001', '=SUM(A1)', ''], ['002', '3.00', 'x']]);
  });
  it('handles escaped quotes, embedded commas, CRLF and quoted line breaks', () => {
    expect(parseCsv('"a,b","say ""hi"""\r\n"line\r\ntwo",end')).toEqual([['a,b', 'say "hi"'], ['line\r\ntwo', 'end']]);
    expect(parseCsv('""')).toEqual([['']]);
    expect(parseCsv('a,')).toEqual([['a', '']]);
    expect(parseCsv('')).toEqual([]);
  });
  it('rejects malformed quotes and stops at explicit preview bounds', () => {
    for (const value of ['"open', 'a"b', '"done"oops']) expect(() => parseCsv(value)).toThrow(/CSV/);
    expect(() => parseCsv('x\n'.repeat(dataLimits.rows + 1))).toThrow(/1000 行/);
    expect(() => parseCsv('x,'.repeat(dataLimits.columns))).toThrow(/200 列/);
    expect(() => parseCsv('x'.repeat(dataLimits.characters + 1))).toThrow(/100 万字符/);
  });
});

describe('lossless JSON preview', () => {
  it('preserves large integers, negative zero, exponents and duplicate object keys', () => {
    const result = formatJson(parseJson('{"n":900719925474099312345,"n":-0,"e":1.2300e+099,"a":[true,null,"x"]}'));
    expect(result).toContain('900719925474099312345');
    expect(result).toContain('"n": -0');
    expect(result).toContain('1.2300e+099');
    expect(result.match(/"n":/g)).toHaveLength(2);
  });
  it('retains string escapes and property order without interpreting markup', () => {
    expect(formatJson(parseJson('{"x":"\\u4e2d","<script>":"<img onerror=alert(1)>"}'))).toContain('"x": "\\u4e2d"');
  });
  it.each(['', '{', '{"a":1,}', '[1,]', '01', '+1', 'NaN', '1.', '1e', 'true false', '"\\x"', '"line\n"', '{"a" 1}', '[}'])('rejects invalid JSON %s', value => {
    expect(() => parseJson(value)).toThrow(/JSON/);
  });
  it('bounds nested structures, node count and input size', () => {
    expect(() => parseJson('['.repeat(66) + '0' + ']'.repeat(66))).toThrow(/64 层/);
    expect(() => parseJson('[' + Array.from({ length: dataLimits.jsonNodes }, () => '0').join(',') + ']')).toThrow(/5000 个节点/);
    expect(() => parseJson(' '.repeat(dataLimits.characters + 1))).toThrow(/100 万字符/);
  });
});
