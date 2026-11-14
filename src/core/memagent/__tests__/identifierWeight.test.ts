// REQ-013 / C3：标识符精确词加权（借鉴 dsh-hindsight 的精确词加权）
import { describe, it, expect } from 'vitest';
import { isIdentifierToken } from '../vector.ts';
import { tokenCoverage, tokenCoverageWeighted } from '../forgetting.ts';

describe('REQ-013 / C3 标识符精确词加权', () => {
  it('isIdentifierToken 识别路径 / 符号 / ID / camelCase', () => {
    expect(isIdentifierToken('foo.ts')).toBe(true);
    expect(isIdentifierToken('src/a/b')).toBe(true);
    expect(isIdentifierToken('getUserById')).toBe(true);
    expect(isIdentifierToken('mem_01abc')).toBe(true);
    expect(isIdentifierToken('Class.Foo')).toBe(true);
    expect(isIdentifierToken('bar()')).toBe(true);
    expect(isIdentifierToken('普通词')).toBe(false);
    expect(isIdentifierToken('hello')).toBe(false);
    expect(isIdentifierToken('ab')).toBe(false); // 太短，保守不识别
  });

  it('无标识符时 tokenCoverageWeighted 与 tokenCoverage 逐字一致（不破坏既有行为）', () => {
    const q = new Set(['hello', 'world']);
    expect(tokenCoverageWeighted(q, new Set(['hello', 'world']))).toBe(tokenCoverage(q, new Set(['hello', 'world'])));
    expect(tokenCoverageWeighted(q, new Set(['hello']))).toBeCloseTo(tokenCoverage(q, new Set(['hello'])));
  });

  it('标识符命中权重更高：含标识符 query 命中 → 覆盖率高于普通加权', () => {
    const q = new Set(['foo.ts', 'bar']);
    // 全命中：标识符权重 3 + 普通 1 = (3+1)/(3+1) = 1
    expect(tokenCoverageWeighted(q, new Set(['foo.ts', 'bar']))).toBe(1);
    // 只命中标识符：3 / (3+1) = 0.75 ；而普通加权 1/2 = 0.5
    const partial = new Set(['foo.ts']);
    expect(tokenCoverageWeighted(q, partial)).toBeCloseTo(0.75);
    expect(tokenCoverage(q, partial)).toBeCloseTo(0.5);
    expect(tokenCoverageWeighted(q, partial)).toBeGreaterThan(tokenCoverage(q, partial));
  });
});
