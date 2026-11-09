// 批次54：导航角标只读真实数据；参考图里的 1467 / 3 / 3 是示例数，绝不写进实现。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  coreListMemories: vi.fn(),
  coreConflicts: vi.fn(),
  onboardBaseUrl: vi.fn(),
}));

vi.mock('../../memory/coreMemoryOps.ts', () => ({ coreListMemories: m.coreListMemories }));
vi.mock('../../dispute/coreDispute.ts', () => ({ coreConflicts: m.coreConflicts }));
vi.mock('../../backend.ts', () => ({ onboardBaseUrl: m.onboardBaseUrl }));
vi.mock('../../shared/session.ts', () => ({ currentSessionId: () => null }));

import { loadNavCounts } from '../navCounts.ts';

const rows = (n: number) => Array.from({ length: n }, () => ({}));
const cards = (n: number) => Array.from({ length: n }, (_, i) => ({ agent_name: `agent-${i}` }));
const fetchJson = (body: unknown) => vi.fn(async () => ({ json: async () => body }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  m.onboardBaseUrl.mockReturnValue('http://127.0.0.1:8200');
});

describe('loadNavCounts', () => {
  it('三个角标分别来自真实账本 / 冲突队列 / 接入后端，不写死示例数', async () => {
    m.coreListMemories.mockResolvedValue(rows(7));
    m.coreConflicts.mockResolvedValue(rows(2));
    const fetch = fetchJson({ ok: true, cards: cards(3) });
    vi.stubGlobal('fetch', fetch);

    await expect(loadNavCounts()).resolves.toEqual({ 'memory-bank': 7, dispute: 2, agent: 3 });
    expect(m.coreListMemories).toHaveBeenCalledTimes(1);
    expect(m.coreConflicts).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('C2 读取失败：失败项不写入计数，成功项保留；角标组件只显示 >0', async () => {
    m.coreListMemories.mockRejectedValue(new Error('E_LEDGER_LOCKED'));
    m.coreConflicts.mockResolvedValue(rows(1));
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));

    await expect(loadNavCounts()).resolves.toEqual({ dispute: 1, agent: 0 });
  });

  it('后端被显式关闭（?agentBackend=）时不发请求，agent 记 0 而不是伪造卡片', async () => {
    m.onboardBaseUrl.mockReturnValue('');
    m.coreListMemories.mockResolvedValue(rows(0));
    m.coreConflicts.mockResolvedValue(rows(0));
    const fetch = fetchJson({ ok: true, cards: rows(9) });
    vi.stubGlobal('fetch', fetch);

    await expect(loadNavCounts()).resolves.toEqual({ 'memory-bank': 0, dispute: 0, agent: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('C2 空账本 / 空队列 / 空卡片：如实为 0，不冒充参考图数字', async () => {
    m.coreListMemories.mockResolvedValue(rows(0));
    m.coreConflicts.mockResolvedValue(rows(0));
    vi.stubGlobal('fetch', fetchJson({ ok: true, cards: [] }));

    const out = await loadNavCounts();
    expect(out).toEqual({ 'memory-bank': 0, dispute: 0, agent: 0 });
    expect(JSON.stringify(out)).not.toContain('1467');
  });
});
