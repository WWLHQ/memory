// 批次55：层级刻度改由概览页同一次真实账本快照派生，不再独立读 storage / browse。
// 判据：读失败整块报错；缺层/非法计数显示「读取失败」而非 0；绝不写死参考图示例数。
import { describe, expect, it } from 'vitest';
import { STRATA_LAYERS, strataViewFromOverview, type StrataSnapshotLike } from '../strataScale.ts';

const snapshot = (over: Partial<StrataSnapshotLike> = {}): StrataSnapshotLike => ({
  strata: [
    { layer: 'L0', count: 7 },
    { layer: 'L1', count: 2 },
    { layer: 'L2', count: 1 },
    { layer: 'L3', count: 0 },
    { layer: 'L4', count: 4 },
    { layer: 'L5', count: 2 },
    { layer: 'L6', count: 1 },
  ],
  kernelMode: 'host',
  loadedAt: 1_790_000_000_000,
  storageError: null,
  ...over,
});

describe('STRATA_LAYERS 定义', () => {
  it('L0–L6 共 7 档，标题不含 STRATA 英文，层名按定稿', () => {
    expect(STRATA_LAYERS.map((s) => s.layer)).toEqual(['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
    expect(STRATA_LAYERS.map((s) => s.label)).toEqual(['密文', '脱敏', '摘要', '要点', '场景', '边界', '索引']);
    expect(STRATA_LAYERS.every((s) => /^#[0-9a-f]{6}$/.test(s.color))).toBe(true);
  });
});

describe('strataViewFromOverview', () => {
  it('快照未到 → 读取中，不渲染任何伪造行', () => {
    expect(strataViewFromOverview(null)).toEqual({ status: 'error', detail: '账本读取中…' });
  });

  it('账本读取失败 / strata 为 null → 整块 error，绝不拿 0 冒充', () => {
    const a = strataViewFromOverview(snapshot({ storageError: 'E_LEDGER_LOCKED', strata: null }));
    expect(a).toEqual({ status: 'error', detail: '账本读取失败：E_LEDGER_LOCKED' });
    const b = strataViewFromOverview(snapshot({ strata: null }));
    expect(b).toEqual({ status: 'error', detail: '账本读取失败：未拿到分层计数' });
  });

  it('复用概览页同一次账本快照：7 档真实读数、kernelMode / loadedAt 同源', () => {
    const r = strataViewFromOverview(snapshot());
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.view.rows.map((x) => x.layer)).toEqual(['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
    expect(r.view.rows.map((x) => x.count)).toEqual([7, 2, 1, 0, 4, 2, 1]);
    expect(r.view.failed).toEqual([]);
    expect(r.view.kernelMode).toBe('host');
    expect(r.view.loadedAt).toBe(1_790_000_000_000);
    expect(JSON.stringify(r)).not.toContain('1467');
  });

  it('C2 缺失层 / 非法计数 → 该层「读取失败」而非 0，failed 如实记录', () => {
    const r = strataViewFromOverview(snapshot({
      strata: [
        { layer: 'L0', count: 1 },
        { layer: 'L1', count: -2 },
        { layer: 'L2', count: Number.NaN },
        { layer: 'L3', count: 3 },
        // L4 缺失
        { layer: 'L5', count: 0 },
        { layer: 'L6', count: 1 },
      ],
    }));
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    const by = Object.fromEntries(r.view.rows.map((x) => [x.layer, x.count]));
    expect(by.L0).toBe(1);
    expect(by.L1).toBeNull();
    expect(by.L2).toBeNull();
    expect(by.L3).toBe(3);
    expect(by.L4).toBeNull();
    expect(r.view.failed).toEqual(['L1', 'L2', 'L4']);
  });

  it('C2 空账本 → 七档全 0 是真实读数，不标失败、不冒充参考图数字', () => {
    const r = strataViewFromOverview(snapshot({
      strata: (['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6'] as const).map((layer) => ({ layer, count: 0 })),
      kernelMode: 'browser',
    }));
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.view.rows.every((x) => x.count === 0)).toBe(true);
    expect(r.view.failed).toEqual([]);
    expect(r.view.kernelMode).toBe('browser');
    expect(JSON.stringify(r)).not.toContain('1467');
  });
});
