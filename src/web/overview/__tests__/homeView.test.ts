// 批次57-B 首页派生层（deriveHomeView）单测：只断言「真实快照 → 版式字符串/列表」的翻译口径。
// 闸门 B：正向（真实读数如实翻译）+ 诚实降级（读不到给原因，不拿占位冒充）。
// 闸门 C 变异靶点：healthOk / sessionText / l0Alert 三处判定（改错必须红灯）。
import { describe, it, expect } from 'vitest';
import { deriveHomeView } from '../OverviewPage.tsx';
import type { OverviewSnapshot } from '../../shell/overview.ts';
import { emptyLayerGraph } from '../../Home/layerGraph.ts';

function snap(over: Partial<OverviewSnapshot> = {}): OverviewSnapshot {
  return {
    // 2026-11-10 01:30:00 UTC → 东八区 09:30:00（用户可见时间统一 UTC+08:00）
    loadedAt: Date.UTC(2026, 10, 10, 1, 30, 0),
    kernelMode: 'host',
    storageError: null,
    gains: [],
    raw: { gains: [], anomalies: [], activeMemories: [], todos: [] },
    pendingSync: 0,
    health: { status: 'ok', detail: 'HTTP 200', checkedAt: 1 },
    session: true,
    billing: { status: 'ok', detail: '1 个引擎厂商实时可查', live: 1, total: 1 },
    facts: { memories: 7, audits: 12, writeToday: 1, recallToday: 2, conflicts: 1 },
    strata: [{ layer: 'L1', count: 7 }],
    effectGains: [{ icon: 'x', title: 'Token 节省', big: '-40%', desc: 'd', src: 's' }],
    graph: emptyLayerGraph(),
    recentAudits: { ok: true, rows: [], total: 12, error: null },
    today: { ok: true, write: 1, recall: 2, graft: 0, filtered: 0, error: null },
    token: { ok: true, savedPct: 40, recallCount: 2, savedTokens: 600, series: [900, 600], error: null },
    refine: { ok: false, available: false, view: null, error: '非桌面壳' },
    mcp: { ok: false, available: false, endpoint: null, clients: [], error: '非桌面壳' },
    engines: { ok: false, available: false, engines: [], error: '非桌面壳' },
    dataRoot: { available: true, root: 'D:\\data', error: null },
    ...over,
  };
}

describe('deriveHomeView（批次57-B 首页派生）', () => {
  it('时间按东八区翻译（审计/读取时钟统一 UTC+08:00）', () => {
    expect(deriveHomeView(snap()).dateText).toBe('11-10 09:30:00');
  });

  it('会话文案随真实登录态：已登录 / 未登录·只读', () => {
    expect(deriveHomeView(snap({ session: true })).sessionText).toBe('已登录');
    expect(deriveHomeView(snap({ session: false })).sessionText).toBe('未登录 · 只读');
  });

  it('healthOk 只在后端真实可达（status=ok）时为真', () => {
    expect(deriveHomeView(snap()).healthOk).toBe(true);
    expect(deriveHomeView(snap({ health: { status: 'down', detail: '不可达', checkedAt: 1 } })).healthOk).toBe(false);
  });

  it('数据根文案：可用给真目录；不可用给原因（不编造路径）', () => {
    expect(deriveHomeView(snap()).dataRootText).toBe('D:\\data');
    expect(deriveHomeView(snap({ dataRoot: { available: false, root: null, error: '非桌面壳：无数据根' } })).dataRootText)
      .toBe('非桌面壳：无数据根');
  });

  it('L0 阻断提示只在账本确有 error 级 L0/写密钥/锁定异常时出现', () => {
    const withL0 = snap({
      raw: { gains: [], activeMemories: [], todos: [], anomalies: [{ title: 'L0 写入密钥锁定', detail: '需就地解锁', level: 'error' }] },
    });
    expect(deriveHomeView(withL0).l0Alert).toBe('L0 写入密钥锁定');
    // warn 级不算阻断；无异常则为 null（绝不编造告警）
    const warnOnly = snap({
      raw: { gains: [], activeMemories: [], todos: [], anomalies: [{ title: 'L0 写入密钥锁定', detail: 'x', level: 'warn' }] },
    });
    expect(deriveHomeView(warnOnly).l0Alert).toBeNull();
    expect(deriveHomeView(snap()).l0Alert).toBeNull();
  });

  it('写密钥锁没解 → 常驻醒目提示，且不需要「近 30 分钟有写入被拒」', () => {
    const locked = snap({ l0Write: { available: true, unlocked: false, detail: null } });
    const v = deriveHomeView(locked);
    expect(v.l0WriteLocked).toBe(true);
    expect(v.l0WriteUnknown).toBe(false);
    expect(v.l0Alert).toBeNull(); // 变异靶点：不能靠异常聚合才显示
  });

  it('写密钥已解锁 → 不显示常驻提示；状态读不到 → 如实标注 unknown，绝不猜已解锁', () => {
    const unlocked = snap({ l0Write: { available: true, unlocked: true, detail: null } });
    expect(deriveHomeView(unlocked).l0WriteLocked).toBe(false);
    expect(deriveHomeView(unlocked).l0WriteUnknown).toBe(false);

    const unknown = snap({ l0Write: { available: false, unlocked: false, detail: '浏览器模式：读不到' } });
    const u = deriveHomeView(unknown);
    expect(u.l0WriteLocked).toBe(false);
    expect(u.l0WriteUnknown).toBe(true);
    expect(u.l0WriteDetail).toBe('浏览器模式：读不到');

    // 老快照没有该字段（向后兼容）→ 同样诚实标注读不到
    expect(deriveHomeView(snap()).l0WriteUnknown).toBe(true);
  });

  it('效果四卡与图谱原样透传真实账本聚合（不重算、不伪造）', () => {
    const s = snap();
    const v = deriveHomeView(s);
    expect(v.gains).toBe(s.effectGains);
    expect(v.graph).toBe(s.graph);
    expect(v.anomalies).toEqual([]);
  });
});