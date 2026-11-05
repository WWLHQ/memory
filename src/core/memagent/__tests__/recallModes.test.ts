import { describe, it, expect } from 'vitest';
import {
  RECALL_MODE_SPECS, resolveMode, isManualMode, modeWeights, modeSpec,
  DEFAULT_DISPATCH_CONFIG,
} from '../recallModes.ts';

describe('recallModes — 模式配置表（§2.4.3）', () => {
  it('5 种具体模式齐全', () => {
    const ids = Object.keys(RECALL_MODE_SPECS) as (keyof typeof RECALL_MODE_SPECS)[];
    expect(ids.sort()).toEqual(['event_replay', 'fact_first', 'minimal', 'pattern_reasoning', 'top_insight']);
  });

  it('权重向量与规格书 §2.4.3 字面一致（含已知缺陷：pattern_reasoning 求和 0.90 ≠ 1.0）', () => {
    // 忠实于规格书，不擅自归一化；0.90 与 §2.4.3「权重和=1.0」声明矛盾，已在设计文档标注。
    const w = modeWeights('pattern_reasoning');
    const sum = w.f + w.i + w.c + w.a;
    expect(sum).toBeCloseTo(0.9, 6);
    expect(sum).not.toBeCloseTo(1, 6); // 显式锁定缺陷，待规格书修订
  });

  it('极简禁用 L2/L5 且 isMinimal=true', () => {
    expect(modeSpec('minimal').disabledLayers).toEqual(['L2', 'L5']);
    expect(modeSpec('minimal').isMinimal).toBe(true);
  });

  it('顶层洞察优先预加载 L5，其余无预加载', () => {
    expect(modeSpec('top_insight').preload).toBe('L5');
    expect(modeSpec('fact_first').preload).toBeNull();
  });

  it('权重向量与规格书 §2.4.3 一致', () => {
    expect(modeWeights('top_insight')).toEqual({ f: 0.20, i: 0.40, c: 0.10, a: 0.30 });
    expect(modeWeights('fact_first')).toEqual({ f: 0.10, i: 0.20, c: 0.40, a: 0.30 });
    expect(modeWeights('event_replay')).toEqual({ f: 0.40, i: 0.15, c: 0.15, a: 0.30 });
    expect(modeWeights('pattern_reasoning')).toEqual({ f: 0.15, i: 0.25, c: 0.10, a: 0.40 });
    expect(modeWeights('minimal')).toEqual({ f: 0.10, i: 0.20, c: 0.35, a: 0.35 });
  });
});

describe('isManualMode — 自动/手动 判别', () => {
  it('auto / null / undefined 视为自动', () => {
    expect(isManualMode('auto')).toBe(false);
    expect(isManualMode(null)).toBe(false);
    expect(isManualMode(undefined)).toBe(false);
  });
  it('5 种具体模式视为手动', () => {
    expect(isManualMode('top_insight')).toBe(true);
    expect(isManualMode('minimal')).toBe(true);
  });
});

describe('resolveMode — 自动分流（§2.4.4 裁决走查）', () => {
  it('task_start 零命中（中英混排真实问题）→ 默认 顶层洞察优先', () => {
    // 含拉丁词（FastAPI/Django）的混排查询不触发极简，走 scene 默认 top_insight（§2.4.4 长度规则按语言分别判定）
    const r = resolveMode({ query: '为什么当时选了 FastAPI 而不是 Django', scene: 'task_start' });
    expect(r.mode).toBe('top_insight');
    expect(r.hitKeywords).toEqual([]);
  });

  it('task_start 纯中文短查询零命中 → 极简（矩阵规则：长度<30 且无其他命中）', () => {
    const r = resolveMode({ query: '架构与验证', scene: 'task_start' });
    expect(r.mode).toBe('minimal');
  });

  it('history_query 复现/步骤还原 ≥2 → 事件复盘', () => {
    const r = resolveMode({ query: '上周三那个 NPE 怎么复现，拉出当时步骤', scene: 'history_query' });
    expect(r.mode).toBe('event_replay');
  });

  it('default 短查询（7 中文字）< 30 → 极简', () => {
    const r = resolveMode({ query: '修一下这个空指针', scene: 'default' });
    expect(r.mode).toBe('minimal');
    expect(r.reason).toContain('极简');
  });

  it('critical 故障+核对+报错 → 事实优先', () => {
    const r = resolveMode({ query: 'P0 故障，核对昨天发布三模块有没有报错', scene: 'critical' });
    expect(r.mode).toBe('fact_first');
  });

  it('高置信单字词「故障」命中即算（1 即命中）', () => {
    const r = resolveMode({ query: '线上故障', scene: 'default' });
    // default 候选为 [minimal, fact_first]；「故障」高置信 → fact_first 命中
    expect(r.mode).toBe('fact_first');
    expect(r.hitKeywords).toContain('故障');
  });
});

describe('resolveMode — 手动优先 + 16.5 硬规则', () => {
  it('手动指定事实优先，忽略自动分流', () => {
    const r = resolveMode({ query: '为什么当时选了 FastAPI 而不是 Django', scene: 'task_start', explicitMode: 'fact_first' });
    expect(r.mode).toBe('fact_first');
    expect(r.reason).toContain('手动');
  });

  it('手动指定顶层洞察优先，history_query 下仍尊重用户选择', () => {
    const r = resolveMode({ query: '上周三那个 NPE 怎么复现', scene: 'history_query', explicitMode: 'top_insight' });
    expect(r.mode).toBe('top_insight');
  });

  it('critical 下手动选极简被 16.5 硬规则降为事实优先', () => {
    const r = resolveMode({ query: '任何内容', scene: 'critical', explicitMode: 'minimal' });
    expect(r.mode).toBe('fact_first');
    expect(r.reason).toContain('16.5');
  });

  it('critical 下自动分流不允许极简（短查询也不触发）', () => {
    const r = resolveMode({ query: '改个变量名', scene: 'critical' });
    expect(r.mode).not.toBe('minimal');
    expect(r.mode).toBe('fact_first'); // critical 零命中默认
  });
});

describe('resolveMode — 多模式命中裁决次模式', () => {
  it('task_start 同时命中顶层洞察与事实优先 → 顶层洞察为主，事实优先为次', () => {
    // 混排（含拉丁词）避免触发极简；hitThreshold=1 时两类各 1 分均达阈值
    const r = resolveMode({
      query: '架构原则选型，核对验证方案，please give advice', scene: 'task_start',
      config: { ...DEFAULT_DISPATCH_CONFIG, hitThreshold: 1 },
    });
    expect(r.mode).toBe('top_insight');
    expect(r.secondary).toBe('fact_first');
  });

  it('极简模式不产生次模式降级', () => {
    const r = resolveMode({ query: '修空指针', scene: 'default' });
    expect(r.mode).toBe('minimal');
    expect(r.secondary).toBeUndefined();
  });
});
