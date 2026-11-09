// 批次53：导航栏层级刻度的数据口径 —— 全部来自真实账本，读不到就如实报错。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { coreBrowse, getStorage } from '../../memory/coreMemoryOps.ts';
import { loadStrataScale, STRATA_LAYERS } from '../strataScale.ts';

vi.mock('../../memory/coreMemoryOps.ts', () => ({
  getStorage: vi.fn(),
  coreBrowse: vi.fn(),
}));

const row = (mem_id: string, content: string) => ({ mem_id, content }) as never;
const mem = (extra: Record<string, unknown>) => ({ mem_id: 'm', ...extra }) as never;
const ledger = (rows: unknown[]) => ({ listMemories: vi.fn(async () => rows) });

beforeEach(() => {
  vi.mocked(getStorage).mockReset();
  vi.mocked(coreBrowse).mockReset();
});

describe('STRATA_LAYERS 定义', () => {
  it('L0–L6 共 7 档，标题不含 STRATA 英文，层名按定稿', () => {
    expect(STRATA_LAYERS.map((s) => s.layer)).toEqual(['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
    expect(STRATA_LAYERS.map((s) => s.label)).toEqual(['密文', '脱敏', '摘要', '要点', '场景', '边界', '索引']);
    expect(STRATA_LAYERS.every((s) => /^#[0-9a-f]{6}$/.test(s.color))).toBe(true);
  });
});

describe('loadStrataScale', () => {
  it('账本读取失败 → error，绝不去 browse 造数', async () => {
    vi.mocked(getStorage).mockReturnValue({ listMemories: vi.fn(async () => { throw new Error('E_LEDGER_LOCKED'); }) } as never);
    const r = await loadStrataScale();
    expect(r).toEqual({ status: 'error', detail: '账本读取失败：E_LEDGER_LOCKED' });
    expect(coreBrowse).not.toHaveBeenCalled();
  });

  it('L0 计「有原文」的行：has_l0 / 行上信封 / 行上明文算一次，空行不算', async () => {
    vi.mocked(getStorage).mockReturnValue(ledger([
      mem({ has_l0: true }),
      mem({ content_l0_enc: 'ENV:v2:xxx' }),
      mem({ content_orig: '原始输入' }),
      mem({ has_l0: true, content_l0_enc: 'ENV:v2:yyy' }), // 同一记忆不重复计
      mem({ content_orig: '   ' }),                        // 空白不算有原文
      mem({}),                                            // 无原文
    ]) as never);
    vi.mocked(coreBrowse).mockResolvedValue({ rows: [] } as never);
    const r = await loadStrataScale();
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.view.rows[0].count).toBe(4);
    expect(r.view.rows.map((x) => x.layer)).toEqual(['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
  });

  // C2 输入/状态变异矩阵：不存在 / 空账本 / 历史行缺字段 / 非法类型 / 边界值，
  // 判据是「如实空态或明确报错」，绝不静默造数或抛未捕获异常。
  it('C2 空账本 → 七档全 0 且标明内存账本，不伪造任何计数', async () => {
    vi.mocked(getStorage).mockReturnValue(ledger([]) as never);
    vi.mocked(coreBrowse).mockResolvedValue({ rows: [] } as never);
    const r = await loadStrataScale();
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.view.rows.every((x) => x.count === 0)).toBe(true);
    expect(r.view.failed).toEqual([]);
    expect(r.view.kernelMode).toBe('browser');
  });

  it('C2 历史行缺 has_l0 / 信封字段 → L0 为 0（向后兼容，不猜「应该有原文」）', async () => {
    vi.mocked(getStorage).mockReturnValue(ledger([mem({ layer: 'L1' })]) as never);
    vi.mocked(coreBrowse).mockResolvedValue({ rows: [] } as never);
    const r = await loadStrataScale();
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.view.rows[0].count).toBe(0);
  });

  it('C2 非法类型 / 边界值：content 为 null、数字、空白 → 不计入且不崩溃', async () => {
    vi.mocked(getStorage).mockReturnValue(ledger([
      mem({ content_orig: 12345 }), mem({ content_l0_enc: null }), mem({ has_l0: 'yes' }),
    ]) as never);
    // 故意注入运行时非法类型（内核契约是 string，此处模拟脏数据），用 as never 绕过测试桩签名
    vi.mocked(coreBrowse).mockResolvedValue({
      rows: [
        { mem_id: 'a', content: null },
        { mem_id: 'b', content: 42 },
        { mem_id: 'c', content: '   ' },
        { mem_id: 'd', content: 'ok' },
      ] as never,
    } as never);
    const r = await loadStrataScale();
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.view.rows[0].count).toBe(1); // 仅 has_l0 真值那行；数字/ null / 空白不算有原文
    expect(r.view.rows.slice(1).every((x) => x.count === 1)).toBe(true); // 仅 d 有非空内容
    expect(r.view.failed).toEqual([]);
  });

  it('L1–L6 按「该层有非空内容」去重计数；browse 返回 null / 抛错记为失败而非 0', async () => {
    vi.mocked(getStorage).mockReturnValue(ledger([mem({})]) as never);
    vi.mocked(coreBrowse).mockImplementation(async (layer) => {
      if (layer === 'L1') return { rows: [row('a', 'x'), row('a', 'y'), row('b', '  ')] } as never;
      if (layer === 'L2') return { rows: [row('c', 'z')] } as never;
      if (layer === 'L3') return null as never;
      if (layer === 'L4') throw new Error('E_LAYER_READ');
      return { rows: [] } as never;
    });
    const r = await loadStrataScale();
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    const by = Object.fromEntries(r.view.rows.map((x) => [x.layer, x.count]));
    expect(by.L1).toBe(1);   // a 两条去重、b 空白不算
    expect(by.L2).toBe(1);
    expect(by.L3).toBeNull(); // 读不到 ≠ 0
    expect(by.L4).toBeNull();
    expect(by.L5).toBe(0);    // 真读到空集 → 0 是真实读数
    expect(by.L6).toBe(0);
    expect(r.view.failed).toEqual(['L3', 'L4']);
    // 测试环境无宿主 → 标明浏览器内存账本，避免把 0 读成「全库没有」
    expect(r.view.kernelMode).toBe('browser');
  });
});
