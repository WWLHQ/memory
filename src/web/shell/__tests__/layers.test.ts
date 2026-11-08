// S7 分层面板口径：计数来自真实 storage.browse(Ln)；读不到显示「读取失败」，绝不当 0。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { coreBrowse, coreListMemories } from '../../memory/coreMemoryOps.ts';
import { loadL0Status } from '../statusbar.ts';
import { loadLayerPanel } from '../layers.ts';

vi.mock('../../memory/coreMemoryOps.ts', () => ({ coreListMemories: vi.fn(), coreBrowse: vi.fn() }));
vi.mock('../statusbar.ts', () => ({ loadL0Status: vi.fn() }));

const L0 = { status: 'ok' as const, view: { has_admin_wrap: true, write_unlocked: false, active_sessions: 0, active_grants: 0 } };

function row(memId: string, content: string) {
  return { mem_id: memId, content } as never;
}

beforeEach(() => {
  vi.mocked(coreListMemories).mockReset();
  vi.mocked(coreBrowse).mockReset();
  vi.mocked(loadL0Status).mockReset();
  vi.mocked(loadL0Status).mockResolvedValue(L0);
});

describe('loadLayerPanel', () => {
  it('账本读取失败 → error，不再去 browse 造数', async () => {
    vi.mocked(coreListMemories).mockRejectedValue(new Error('E_LEDGER_LOCKED'));
    const r = await loadLayerPanel();
    expect(r).toEqual({ status: 'error', detail: '账本读取失败：E_LEDGER_LOCKED' });
    expect(coreBrowse).not.toHaveBeenCalled();
  });

  it('按层统计「有内容」的记忆去重数；browse 返回 null / 抛错都记为读取失败而不是 0', async () => {
    vi.mocked(coreListMemories).mockResolvedValue([row('a', ''), row('b', ''), row('c', '')]);
    vi.mocked(coreBrowse).mockImplementation(async (layer) => {
      if (layer === 'L6') return { rows: [row('m1', 'x'), row('m2', 'y'), row('m1', 'z'), row('m3', '')] } as never;
      if (layer === 'L4') return { rows: [row('m1', ''), row('m2', '  ')] } as never;
      if (layer === 'L3') return null as never;
      if (layer === 'L2') throw new Error('E_LAYER_READ');
      return { rows: [] } as never;
    });
    const r = await loadLayerPanel();
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    const byLayer = Object.fromEntries(r.view.layers.map((l) => [l.layer, l.count]));
    expect(r.view.total).toBe(3);
    expect(byLayer.L6).toBe(2); // m1 重复只算一次，m3 空内容不计
    expect(byLayer.L5).toBe(0); // 真读到空集 → 0 是真实读数
    expect(byLayer.L4).toBe(0); // 空白内容不算有内容
    expect(byLayer.L3).toBeNull(); // 读不到
    expect(byLayer.L2).toBeNull(); // 抛错
    expect(r.view.failed).toEqual(['L3', 'L2']);
    expect(r.view.l0).toEqual(L0);
    // 测试环境无宿主 → 必须标明是进程内内存账本，避免把 0 读成「全库没有」
    expect(r.view.kernelMode).toBe('browser');
  });
});
