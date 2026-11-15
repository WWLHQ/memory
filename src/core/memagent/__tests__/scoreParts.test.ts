// M1-1：打分拆分（scoreParts / scoreFromParts / scoreMemory）逐位不变验证。
// 关键不变量：拆分后 scoreMemory 必须与旧实现逐位相同（含 pinned +0.15、钳制下限、千分位取整）。
import { describe, expect, it } from 'vitest';
import {
  scoreMemory, scoreParts, scoreFromParts, SCORE_WEIGHTS,
} from '../forgetting.ts';
import type { Memory } from '../types.ts';

const DAY = 24 * 3600 * 1000;
const now = Date.now();
const OLD = 30 * DAY; // 30 天前，配合 insight 半衰期 30 天 → freshness 恰为 0.5

function mkMem(p: Partial<Memory> & { category: Memory['category'] }): Memory {
  return {
    mem_id: 'mem_x', content: 'x', layer: 'L1', decay_class: 'warm',
    created_at: now - OLD, ...p,
  } as Memory;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

describe('scoreParts（M1-1）', () => {
  it('四分量钳制符合 17.5 下限', () => {
    const m = mkMem({ category: 'insight', importance: 0, confidence: 0.01, access_count: 100 });
    const p = scoreParts(m, now);
    expect(p.f).toBeCloseTo(0.5, 6);
    expect(p.imp).toBe(0.1); // CLAMP.importance
    expect(p.conf).toBe(0.05); // CLAMP.confidence
    expect(p.boost).toBe(1); // min(1, 100/10)
  });

  it('缺字段回退默认 0.5，access_count 缺省 boost=0', () => {
    const m = mkMem({ category: 'insight' });
    const p = scoreParts(m, now);
    expect(p.imp).toBe(0.5);
    expect(p.conf).toBe(0.5);
    expect(p.boost).toBe(0);
  });
});

describe('scoreFromParts / scoreMemory 逐位一致（M1-1）', () => {
  it('scoreMemory === scoreFromParts(scoreParts(...))（含 pinned / 缺字段 / 钳制边界）', () => {
    const cases: Memory[] = [
      mkMem({ category: 'insight', pinned: false }),
      mkMem({ category: 'insight', pinned: true }),
      mkMem({ category: 'fact', importance: 0, confidence: 0.01, access_count: 100, pinned: true }),
      mkMem({ category: 'context', created_at: now - 3 * DAY, pinned: false }), // 极新鲜
      mkMem({ category: 'pitfall', created_at: now - 400 * DAY, pinned: true }), // 极老
    ];
    for (const m of cases) {
      for (const rel of [0, 0.2, 0.7, 1]) {
        const a = scoreMemory(m, rel, now);
        const b = scoreFromParts(rel, scoreParts(m, now), SCORE_WEIGHTS, m.pinned);
        expect(a).toBe(b);
        // 与独立手算公式一致（f/imp/conf/boost 取自 scoreParts，含 pinned +0.15）
        const p = scoreParts(m, now);
        const w = SCORE_WEIGHTS;
        const manual = round3(rel * (w.w_f * p.f + w.w_i * p.imp + w.w_c * p.conf + w.w_a * p.boost) + (m.pinned ? 0.15 : 0));
        expect(a).toBe(manual);
      }
    }
  });

  it('pinned 加分恰为 +0.15 且不被千分位吞掉', () => {
    const base = mkMem({ category: 'insight', pinned: false });
    const pinned = mkMem({ category: 'insight', pinned: true });
    const rel = 0.5;
    // 两分各自千分位取整后相减有 IEEE-754 尾数误差，用 toBeCloseTo 判定
    expect(scoreMemory(pinned, rel, now) - scoreMemory(base, rel, now)).toBeCloseTo(0.15, 10);
  });

  it('随机属性测试：1000 例 scoreMemory 与手算公式逐位相同', () => {
    let seed = 123456789;
    const rnd = () => {
      // 确定性 LCG，避免 flaky
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const cats: Memory['category'][] = ['fact', 'preference', 'decision', 'pitfall', 'insight', 'context'];
    for (let i = 0; i < 1000; i++) {
      const m = mkMem({
        category: cats[Math.floor(rnd() * cats.length)],
        importance: rnd(),
        confidence: rnd(),
        access_count: Math.floor(rnd() * 200),
        created_at: now - Math.floor(rnd() * 500) * DAY,
        pinned: rnd() > 0.5,
      });
      const rel = rnd();
      const a = scoreMemory(m, rel, now);
      const p = scoreParts(m, now);
      const w = SCORE_WEIGHTS;
      const manual = round3(rel * (w.w_f * p.f + w.w_i * p.imp + w.w_c * p.conf + w.w_a * p.boost) + (m.pinned ? 0.15 : 0));
      expect(a).toBe(manual);
    }
  });
});
