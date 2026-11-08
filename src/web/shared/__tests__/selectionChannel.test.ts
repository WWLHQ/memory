// S4：选中项回传通道的校验（只渲染合法形状，绝不渲染半截/伪造数据）
import { describe, expect, it } from 'vitest';
import { parseSelection } from '../selectionChannel.ts';

const valid = {
  v: 1,
  page: 'memory.html',
  title: '记忆 mem_1',
  fields: [
    { k: 'ID', v: 'mem_1', mono: true },
    { k: '状态', v: 'active' },
  ],
};

describe('parseSelection', () => {
  it('接受合法 payload 并保留字段', () => {
    const out = parseSelection(valid);
    expect(out).toEqual({
      v: 1,
      page: 'memory.html',
      title: '记忆 mem_1',
      subtitle: undefined,
      fields: [
        { k: 'ID', v: 'mem_1', mono: true },
        { k: '状态', v: 'active', mono: false },
      ],
    });
  });

  it('拒绝 null/非对象/版本不符', () => {
    expect(parseSelection(null)).toBeNull();
    expect(parseSelection('x')).toBeNull();
    expect(parseSelection({ ...valid, v: 2 })).toBeNull();
  });

  it('拒绝缺 page/title 或空字段列表', () => {
    expect(parseSelection({ ...valid, page: '' })).toBeNull();
    expect(parseSelection({ ...valid, title: '' })).toBeNull();
    expect(parseSelection({ ...valid, fields: [] })).toBeNull();
    expect(parseSelection({ ...valid, fields: 'x' })).toBeNull();
  });

  it('拒绝字段形状不合法（缺 k/v 或非字符串）', () => {
    expect(parseSelection({ ...valid, fields: [{ k: 'ID' }] })).toBeNull();
    expect(parseSelection({ ...valid, fields: [{ k: 'ID', v: 1 }] })).toBeNull();
    expect(parseSelection({ ...valid, fields: [null] })).toBeNull();
  });

  it('超长文本被截断而不是原样灌入壳层', () => {
    const long = 'x'.repeat(3000);
    const out = parseSelection({ ...valid, fields: [{ k: 'content', v: long }] });
    expect(out?.fields[0].v.length).toBeLessThan(2200);
    expect(out?.fields[0].v.endsWith('…')).toBe(true);
  });
});
