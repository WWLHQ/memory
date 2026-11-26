import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonical, fingerprintOf, isIndexCurrent } from '../code-index-core.mjs';

test('LF 与 CRLF 同一内容 → fingerprintOf 相同', () => {
  const lf = 'export const a = 1;\n// 中文摘要\nexport function b() {}\n';
  const crlf = lf.replace(/\n/g, '\r\n');
  assert.equal(fingerprintOf(lf), fingerprintOf(crlf));
});

test('isIndexCurrent：CRLF 索引 vs LF 生成 → true', () => {
  const generated = '# 索引\n\n| 文件 | 行数 |\n|---|---|\n| a.ts | 3 |\n';
  const crlfIndex = generated.replace(/\n/g, '\r\n');
  assert.equal(isIndexCurrent(crlfIndex, generated), true);
  assert.equal(isIndexCurrent(generated, crlfIndex), true);
});

test('单字节改动 → fingerprintOf 不同（源码/文档各一）', () => {
  const srcA = 'export const x = 1;\n';
  const srcB = 'export const x = 2;\n';
  assert.notEqual(fingerprintOf(srcA), fingerprintOf(srcB));
  const docA = '# 标题一\n';
  const docB = '# 标题二\n';
  assert.notEqual(fingerprintOf(docA), fingerprintOf(docB));
});

test('真 CR（老 Mac 换行）也归一化；真变更不被放过', () => {
  const lf = 'a\nb\nc';
  const cr = 'a\rb\rc';
  assert.equal(canonical(cr), lf);
  assert.equal(fingerprintOf(cr), fingerprintOf(lf));
  // 内容真变了，即使换行一致也必须判过期
  assert.equal(isIndexCurrent('a\nb\nc', 'a\nb\nC'), false);
});
