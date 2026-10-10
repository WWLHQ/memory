import { describe, it, expect } from 'vitest';
import {
  normalizeScene, normalizeMode, resolveSceneBudget, resolveModeLinkage,
  isMinimalCandidate, autoDispatch, sortHits, freshness, decayClass,
  budgetLevel, validateQuery, modeName, sceneName,
} from '../logic.ts';
import type { RetrievalHit } from '../types.ts';

const hit = (over: Partial<RetrievalHit>): RetrievalHit => ({
  memory_id: 'm', content: 'c', l2_only: false, decay_class: 'hot', pinned: false,
  locked: false, freshness: 1, importance: 0.5, confidence: 0.5, score: 0.5,
  tags: [], age_days: 1, half_life_days: 30, ...over,
});

describe('枚举回落（§7.3/4）', () => {
  it('scene 非法 → default', () => {
    expect(normalizeScene('bad')).toBe('default');
    expect(normalizeScene('critical')).toBe('critical');
  });
  it('mode 非法 → null', () => {
    expect(normalizeMode('bad')).toBeNull();
    expect(normalizeMode('minimal')).toBe('minimal');
  });
});

describe('resolveSceneBudget（§1.1）', () => {
  it('四档预算/默认模式/重排', () => {
    expect(resolveSceneBudget('default')).toMatchObject({ budget: 800, defaultMode: 'minimal', rerank: false });
    expect(resolveSceneBudget('task_start')).toMatchObject({ budget: 1200, defaultMode: 'top_insight' });
    expect(resolveSceneBudget('history_query')).toMatchObject({ budget: 2000, defaultMode: 'event_replay', rerank: 'auto' });
    expect(resolveSceneBudget('critical')).toMatchObject({ budget: 2500, defaultMode: 'fact_first', rerank: true });
  });
  it('critical 候选不含 minimal（16.5）', () => {
    expect(resolveSceneBudget('critical').modes).not.toContain('minimal');
  });
});

describe('resolveModeLinkage（§1.2/§7.5）', () => {
  it('critical + minimal → 强制 null + toast', () => {
    const r = resolveModeLinkage('critical', 'minimal');
    expect(r.mode).toBeNull();
    expect(r.toast).toContain('16.5');
  });
  it('合法 mode 原样通过', () => {
    expect(resolveModeLinkage('critical', 'fact_first')).toEqual({ mode: 'fact_first', toast: null });
  });
  it('mode 不在候选 → 回落 scene 默认 + toast', () => {
    // 所有 scene 候选都含全部 mode 除 critical 禁 minimal，故用 minimal+default 不触发；
    // 构造：history_query 支持全部，default 支持全部 —— 唯一回落路径是 critical。
    const r = resolveModeLinkage('critical', normalizeMode('minimal'));
    expect(r.toast).not.toBeNull();
  });
});

describe('isMinimalCandidate（§7.2）', () => {
  it('中文 <30 字 → true', () => {
    expect(isMinimalCandidate('修一下这个空指针')).toBe(true);
  });
  it('中文 ≥30 字 → false', () => {
    expect(isMinimalCandidate('请核对昨天发布流程的三个模块是否全部完成回归测试并确认没有遗留报错')).toBe(false);
  });
  it('英文 <12 词 → true', () => {
    expect(isMinimalCandidate('fix the null pointer bug in login flow')).toBe(true);
  });
});

describe('autoDispatch（§2.4.4）', () => {
  it('验收用例1：P0 故障关键词 → fact_first + 事实命中', () => {
    const r = autoDispatch('P0 故障,核对昨天发布三模块有没有报错', 'critical');
    expect(r.mode).toBe('fact_first');
    expect(r.hit_keywords).toContain('fact');
  });
  it('验收用例2：短查询 default → minimal', () => {
    expect(autoDispatch('修一下这个空指针', 'default').mode).toBe('minimal');
  });
  it('无信号 → scene 默认模式', () => {
    expect(autoDispatch('这是一条足够长的普通描述语句它不包含任何分流关键词只是平静地陈述了一个客观事实供系统兜底使用', 'task_start').mode).toBe('top_insight');
  });
});

describe('sortHits（§3/R3）', () => {
  it('pinned 置顶 → score 降序 → confidence 次级', () => {
    const list = [
      hit({ memory_id: 'a', score: 0.9, confidence: 0.9 }),
      hit({ memory_id: 'p', pinned: true, score: 0.1 }),
      hit({ memory_id: 'b', score: 0.8, confidence: 0.5 }),
      hit({ memory_id: 'c', score: 0.8, confidence: 0.7 }),
    ];
    expect(sortHits(list).map((h) => h.memory_id)).toEqual(['p', 'a', 'c', 'b']);
  });
});

describe('freshness / decayClass（§3.1/15.3）', () => {
  it('freshness = 0.5^(age/hl)，下限 0.05', () => {
    expect(freshness(0, 30)).toBe(1);
    expect(freshness(30, 30)).toBeCloseTo(0.5);
    expect(freshness(3000, 1)).toBe(0.05);
  });
  it('温度徽标阈值', () => {
    expect(decayClass(0, 30)).toBe('hot');
    expect(decayClass(31, 30)).toBe('warm');
    expect(decayClass(200, 30)).toBe('cold');
  });
});

describe('budgetLevel（R9）', () => {
  it('四档', () => {
    expect(budgetLevel(1500)).toBe('ok');
    expect(budgetLevel(1800)).toBe('trim');
    expect(budgetLevel(2500)).toBe('warn');
    expect(budgetLevel(3001)).toBe('breach');
  });
});

describe('validateQuery（§7.1）', () => {
  it('空 → error', () => {
    expect(validateQuery('   ').error).toContain('不能为空');
  });
  it('短查询 → minimalHint', () => {
    expect(validateQuery('修一下空指针').minimalHint).toBe(true);
    expect(validateQuery('请核对昨天发布流程的三个模块是否全部完成回归测试并确认没有遗留报错').minimalHint).toBe(false);
  });
});

describe('名称映射', () => {
  it('mode/scene 中文名', () => {
    expect(modeName('fact_first')).toBe('事实优先');
    expect(sceneName('critical')).toBe('合规关键');
  });
});
