// 批次42 阶段4（4-D / B3）：本地预算单位 t 的口径契约。
// 侦察判定：estTokens 是全链路同源的确定性预算换算（硬熔断/背景/省量/金额都读它），
// 不是可替换的演示占位；基线 B3「契约级演示」为误判。零依赖下没有真实 tokenizer，
// 且改口径会断裂历史审计与 3000t 阈值语义 —— 故做口径常量化 + 诚实标注 + 不变量锁定。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Hit, Memory } from '../types.ts';
import {
  BACKGROUND_MAX_TOKENS, CHARS_PER_BUDGET_UNIT, computeRecallSavings, corpusTokens,
  estTokens, selectRecallBackground,
} from '../recallInsight.ts';

function mem(mem_id: string, content: string): Memory {
  return {
    mem_id, content, project_id: 'P1', enterprise_id: 'e1', team_id: 't1',
    category: 'fact', layer: 'L1', decay_class: 'hot', pinned: false, locked: false,
    version: 1, created_at: 1000,
  };
}

function hit(mem_id: string, content: string): Hit {
  return {
    mem_id, content, layer: 'L1', decay_class: 'hot', pinned: false, locked: false,
    score: 0.9, evidence_ref: `l0:${mem_id}`,
  };
}

describe('B3：estTokens 是确定性预算换算（口径固定，不得悄悄改动）', () => {
  it('口径常量与实现一致；空串=0、向上取整、确定性', () => {
    expect(CHARS_PER_BUDGET_UNIT).toBe(2);
    expect(estTokens('')).toBe(0);
    expect(estTokens('a')).toBe(1);
    expect(estTokens('abcd')).toBe(2);
    expect(estTokens('abcde')).toBe(3);
    expect(estTokens('abcd')).toBe(estTokens('abcd'));
  });

  it('单调不减；中文/ASCII/混合都按同一字符口径（不因字符类别漂移）', () => {
    expect(estTokens('部署脚本')).toBe(2);        // 4 字 → 2t（已知低估真实 BPE，见源码注释）
    expect(estTokens('deploy docker')).toBe(7);  // 13 字符 → ceil(13/2)=7
    const mixed = '校验 Redis 连接';
    expect(estTokens(mixed)).toBe(estTokens('x'.repeat(mixed.length)));
    for (let n = 0; n <= 20; n++) {
      expect(estTokens('x'.repeat(n + 1))).toBeGreaterThanOrEqual(estTokens('x'.repeat(n)));
    }
  });

  it('全链路同源：背景/省量/语料的 token 都等于 estTokens 之和', () => {
    const mems = [mem('m1', 'a'.repeat(10)), mem('m2', 'b'.repeat(20)), mem('m3', 'c'.repeat(30))];
    const bg = selectRecallBackground(mems, new Set(), {});
    expect(bg.tokens).toBe(bg.items.reduce((sum, i) => sum + estTokens(i.content), 0));
    expect(corpusTokens(mems)).toBe(mems.reduce((sum, m) => sum + estTokens(m.content), 0));

    const hits = [hit('m1', 'a'.repeat(10))];
    const s = computeRecallSavings({ memories: mems, hits, background: bg, preCapTokens: 999 });
    expect(s.payload_tokens).toBe(hits.reduce((sum, h) => sum + estTokens(h.content), 0));
    expect(s.injected_tokens).toBe(s.payload_tokens + bg.tokens);
  });

  it('预算边界：maxTokens 永不突破（硬熔断余量语义）', () => {
    const mems = Array.from({ length: 10 }, (_, i) => mem(`b${i}`, 'x'.repeat(200)));
    for (const cap of [0, 1, 7, 50, BACKGROUND_MAX_TOKENS]) {
      const bg = selectRecallBackground(mems, new Set(), { maxTokens: cap });
      expect(bg.tokens).toBeLessThanOrEqual(cap);
      expect(bg.items.every((i) => i.tokens === estTokens(i.content))).toBe(true);
    }
  });
});

/** Gate C 变异杀手：B3 是口径契约化（无行为差异），用源码级声明契约验证。 */
describe('B3：源码声明不得自称「契约级演示」，且口径说明必须存在', () => {
  // cwd 字符串路径：本机 fs shim 不接受 vitest 转换后的 URL 对象（见 4-C 记录）
  const src = readFileSync(resolve(process.cwd(), 'src/core/memagent/recallInsight.ts'), 'utf8');

  it('杀手①：不出现「契约级演示」「粗略 token 估算」等自称演示/占位字样', () => {
    expect(src).not.toMatch(/契约级演示/);
    expect(src).not.toMatch(/粗略 token 估算/);
  });

  it('杀手②：口径常量与已知限制说明必须存在（防止删掉说明式假绿）', () => {
    expect(src).toMatch(/export const CHARS_PER_BUDGET_UNIT = 2/);
    expect(src).toMatch(/本地预算单位/);
    expect(src).toMatch(/不是 LLM tokenizer 的 token 数/);
    expect(src).toMatch(/已知限制/);
  });
});
