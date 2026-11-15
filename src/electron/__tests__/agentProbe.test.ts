// 原子任务 B：主进程 Agent 健康定时拨测 + 熔断状态机纯函数契约。
// 落盘/定时器副作用不在单测里跑（避免真实 60s 定时器与写审计）；只锁纯函数 nextCircuitState 与初始结构。
import { describe, expect, it } from 'vitest';
import { nextCircuitState, getMonitorStats, classifyWriteRows, type CircuitState } from '../agentProbe.ts';

describe('agentProbe 熔断状态机（nextCircuitState 纯函数）', () => {
  it('CLOSED 连续失败累计，到第 5 次 → OPEN', () => {
    let s = { circuit: 'CLOSED' as CircuitState, failStreak: 0, openSince: 0 };
    for (let i = 1; i <= 5; i++) s = nextCircuitState(s.circuit, s.failStreak, true, i * 1000, s.openSince);
    expect(s.circuit).toBe('OPEN');
    expect(s.failStreak).toBe(5);
  });

  it('CLOSED 不足 5 次仍 CLOSED', () => {
    let s = { circuit: 'CLOSED' as CircuitState, failStreak: 0, openSince: 0 };
    for (let i = 1; i <= 4; i++) s = nextCircuitState(s.circuit, s.failStreak, true, i * 1000, s.openSince);
    expect(s.circuit).toBe('CLOSED');
  });

  it('CLOSED 不全失败 → 重置 streak', () => {
    const s = nextCircuitState('CLOSED', 3, false, 1000, 0);
    expect(s.circuit).toBe('CLOSED');
    expect(s.failStreak).toBe(0);
  });

  it('OPEN 满 60s → HALF_OPEN', () => {
    const s = nextCircuitState('OPEN', 5, true, 70_000, 0);
    expect(s.circuit).toBe('HALF_OPEN');
  });

  it('OPEN 不足 60s → 仍 OPEN', () => {
    const s = nextCircuitState('OPEN', 5, true, 30_000, 0);
    expect(s.circuit).toBe('OPEN');
  });

  it('HALF_OPEN 不全失败 → CLOSED 且重置', () => {
    const s = nextCircuitState('HALF_OPEN', 5, false, 80_000, 0);
    expect(s.circuit).toBe('CLOSED');
    expect(s.failStreak).toBe(0);
  });

  it('HALF_OPEN 仍全失败 → 重新 OPEN（刷新 openSince）', () => {
    const s = nextCircuitState('HALF_OPEN', 5, true, 80_000, 0);
    expect(s.circuit).toBe('OPEN');
    expect(s.openSince).toBe(80_000);
  });
});

describe('agentProbe getMonitorStats 初始结构', () => {
  it('未 init → 诚实空态（连通率为 null、熔断 CLOSED、无慢计算缓存）', () => {
    const s = getMonitorStats();
    expect(s.agent.connectivityRate).toBeNull();
    expect(s.agent.circuit).toBe('CLOSED');
    expect(s.agent.avgLatencyMs).toBeNull();
    expect(s.agent.windowSamples).toBe(0);
    expect(s.writeRate).toBeNull();
    expect(s.checksumFail).toBeNull();
  });
});

// 2026-11-15 用户拍板方案 1：写入率分母剔除质量门过滤
describe('classifyWriteRows 写入成功率口径（方案 1）', () => {
  const w = (detail: unknown) => ({ detail });

  it('真实形态：91 成功 + 27 质量门过滤 + 0 真失败 → 100%（不再是 77%）', () => {
    const rows = [
      ...Array.from({ length: 91 }, () => w({ dedup: 'new', mem_id: 'm' })),
      ...Array.from({ length: 27 }, () => w({ action: 'filtered_l0_to_l1', filter_code: 'thin' })),
    ];
    const r = classifyWriteRows(rows);
    expect(r).toEqual({ success: 91, filtered: 27, failed: 0, rate: 100 });
  });

  it('有真失败才进分母：9 成功 + 1 失败 + 5 过滤 → 90%', () => {
    const rows = [
      ...Array.from({ length: 9 }, () => w({ mem_id: 'm' })),
      w({ error: 'E_IO' }),
      ...Array.from({ length: 5 }, () => w({ action: 'filtered_l0_to_l1' })),
    ];
    expect(classifyWriteRows(rows)).toEqual({ success: 9, filtered: 5, failed: 1, rate: 90 });
  });

  it('ok=false 也算真失败', () => {
    const r = classifyWriteRows([w({ ok: false }), w({ mem_id: 'm' })]);
    expect(r.failed).toBe(1);
    expect(r.rate).toBe(50);
  });

  it('全是质量门过滤（无成功也无失败）→ rate=null（不伪造 100%/0%）', () => {
    const r = classifyWriteRows([w({ action: 'filtered_l0_to_l1' }), w({ action: 'filtered_l0_to_l1' })]);
    expect(r).toEqual({ success: 0, filtered: 2, failed: 0, rate: null });
  });

  it('空账本 → rate=null', () => {
    expect(classifyWriteRows([])).toEqual({ success: 0, filtered: 0, failed: 0, rate: null });
  });

  it('缺 detail 的旧行按成功计（历史兼容，不当作失败）', () => {
    const r = classifyWriteRows([{}, { detail: undefined }]);
    expect(r.success).toBe(2);
    expect(r.rate).toBe(100);
  });
});
