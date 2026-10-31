// 宿主真扫 node IO 层解析函数单测（tasklist/wmic 输出 → 进程名列表）
import { describe, expect, test } from 'vitest';
import { parseTasklistCsv, parseWmicJson } from '../hostScan.ts';

describe('parseTasklistCsv（tasklist /fo csv /nh 输出解析）', () => {
  test('标准 CSV：首个引号字段即映像名', () => {
    const out = [
      '"System Idle Process","0","Services","0","8 K"',
      '"System","4","Services","0","1,364 K"',
      '"claude.exe","1234","Console","1","120,000 K"',
    ].join('\n');
    expect(parseTasklistCsv(out)).toEqual(['System Idle Process', 'System', 'claude.exe']);
  });

  test('空输出/空行 → 空数组', () => {
    expect(parseTasklistCsv('')).toEqual([]);
    expect(parseTasklistCsv('\n\n')).toEqual([]);
  });

  test('非引号行被跳过（容错）', () => {
    expect(parseTasklistCsv('INFO: no tasks\n"a.exe","1","x","0","1 K"')).toEqual(['a.exe']);
  });
});

describe('parseWmicJson（wmic /format:json 兜底解析）', () => {
  test('形态① Property 包装（键值对数组）→ Name 列表', () => {
    const out = '{"Node":[{"Property":[{"Name":"Name","VALUE":"a.exe"}]},{"Property":[{"Name":"Name","VALUE":"b.exe"}]}]}';
    expect(parseWmicJson(out)).toEqual(['a.exe', 'b.exe']);
  });

  test('形态② node 直接带 Name → Name 列表', () => {
    const out = '{"Node":[{"Name":"a.exe"},{"Name":"b.exe"}]}';
    expect(parseWmicJson(out)).toEqual(['a.exe', 'b.exe']);
  });

  test('无 JSON / 坏 JSON / 缺 Node → 空数组', () => {
    expect(parseWmicJson('not json')).toEqual([]);
    expect(parseWmicJson('{bad')).toEqual([]);
    expect(parseWmicJson('{"Foo":[]}')).toEqual([]);
  });
});
