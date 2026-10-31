// 批次24 口径2：层级生成时间的展示纯函数单测。
// 诚实原则：历史行没有这个字段就显示「未记录」，绝不拿 created_at / updated_at 冒充。
import { describe, it, expect } from 'vitest';
import { LAYER_GEN_UNRECORDED, fmtLayerGen } from '../layerTime.ts';

describe('fmtLayerGen', () => {
  it('缺字段（批次24 之前的历史行）：显示未记录，不伪造时间', () => {
    expect(fmtLayerGen(undefined)).toBe(LAYER_GEN_UNRECORDED);
    expect(fmtLayerGen(undefined, 'date')).toBe(LAYER_GEN_UNRECORDED);
    expect(LAYER_GEN_UNRECORDED).toContain('未记录');
  });

  it('完整模式：带「层级生成」前缀与时分秒', () => {
    const text = fmtLayerGen('2026-10-31T02:00:00.000Z');
    expect(text.startsWith('层级生成')).toBe(true);
    expect(text).toContain('2026');
    expect(text).toContain(':');
  });

  it('date 模式（表格里更紧凑）：只有日期，不含时分秒', () => {
    const text = fmtLayerGen('2026-10-31T02:00:00.000Z', 'date');
    expect(text.startsWith('层级生成')).toBe(true);
    expect(text).toContain('2026');
    expect(text).not.toContain(':');
  });

  it('畸形时间串：不抛错，原样带出真实值', () => {
    expect(fmtLayerGen('not-a-date')).toBe('层级生成 not-a-date');
  });
});
