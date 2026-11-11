// 阶段5-F 诚实边界契约（变异杀手）：金额/预算单位口径 + growth 延迟接真 + 历史手测清单归档。
// ① 金额是「本地预算单位 t × 用户自设单价」的估算，不是网关 usage 账单，UI 必须带「估算」。
// ② 4-I 起内核 recall 审计真写 detail.latency_ms；growth 页接真平均值，无样本显示「—」。
// ③ MANUAL-TEST-BATCH.md 是历史清单，已推翻的演示预期就地更正并标 archived。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import type { AuditRecord, RecallResult } from '../../../core/memagent/types.ts';
import { buildRecallHint, rollupRecalls } from '../../../core/memagent/recallInsight.ts';
import { DEFAULT_CONFIG } from '../../params/defaults.ts';
import { NormalConfigCard } from '../../params/NormalConfigCard.tsx';
import { metricsFromLedger } from '../../growth/useGrowthReal.ts';
import { GrowthCards } from '../../growth/GrowthPanels.tsx';
import type { GrowthMetrics } from '../../growth/types.ts';

function src(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

function recallResult(): RecallResult {
  return {
    hits: [{ mem_id: 'm1', content: 'a'.repeat(100), layer: 'L1', decay_class: 'hot', pinned: false, locked: false, score: 0.9, evidence_ref: 'l0:m1' }],
    payload_tokens: 100,
    pipeline_llm_tokens: 0,
    budget: { soft: 1500, warn: 2000, hard: 3000, status: 'ok' },
    mode: 'auto', request_id: 'req_f', scanned_memories: 1,
    background: { items: [], tokens: 0, candidates: 0 },
    savings: {
      corpus_tokens: 10000, payload_tokens: 100, background_tokens: 0, injected_tokens: 102,
      budget_trimmed_tokens: 0, saved_tokens: 9898,
    },
  } as unknown as RecallResult;
}

const audit = (detail: Record<string, unknown>, action: AuditRecord['action'] = 'recall'): AuditRecord => ({
  request_id: 'r_f', action, ts: Date.now(), detail,
});

const metrics = (o: Partial<GrowthMetrics> = {}): GrowthMetrics => ({
  hit_rate: 0, confirmed: 0, rejected: 0, low_quality_ratio: 0, level_stats_L6: 0,
  latency_ms: 0, latency_samples: 0, ...o,
});

describe('5-F / ① 金额与预算单位口径（阶段4-D 遗留）', () => {
  it('配单价 → 完整提示行明写「金额估算（本地预算单位 t × 单价）」，金额数值仍同源', () => {
    const hint = buildRecallHint(recallResult(), rollupRecalls([], Date.now()), 10);
    expect(hint.line).toContain('金额估算（本地预算单位 t × 单价）');
    expect(hint.line).toContain('¥0.00102');
    expect(hint.line).not.toContain('💰 本次 ¥');
    expect(hint.money).not.toBeNull();
  });

  it('短摘要第二行以「💰 估算 本次」开头，不再像真实账单', () => {
    const hint = buildRecallHint(recallResult(), rollupRecalls([], Date.now()), 10);
    expect(hint.shortLine.split('\n')[1]).toMatch(/^💰 估算 本次 /);
  });

  it('未配单价 → 明示未设置单价 + 预算单位，且不出现「本次 ¥」或「/百万 token」', () => {
    const hint = buildRecallHint(recallResult(), rollupRecalls([], Date.now()), null);
    expect(hint.money).toBeNull();
    expect(hint.line).toContain('未设置单价');
    expect(hint.line).toContain('预算单位 t');
    expect(hint.line).not.toContain('本次 ¥');
    expect(hint.line).not.toContain('/百万 token');
  });

  it('明细页 saveLines 标「估算花费」+ 金额口径说明，不写「/百万 token」', () => {
    const s = src('src/core/memagent/recallInsight.ts');
    expect(s).toContain('估算花费');
    expect(s).toContain('金额口径：本地预算单位 t');
    expect(s).toContain('不是网关真实 usage 账单');
    expect(s).not.toContain('/百万 token');
    expect(s).not.toContain('💰 本次 ');
  });

  it('参数页成本单价标「预算单位 t」并说明非厂商账单', () => {
    render(<NormalConfigCard cfg={DEFAULT_CONFIG} onChange={() => {}} />);
    expect(screen.getByTestId('normal-config')).toHaveTextContent('预算单位 t');
    expect(screen.getByTestId('normal-config')).toHaveTextContent('非厂商账单');
    const s = src('src/web/params/NormalConfigCard.tsx');
    expect(s).not.toContain('百万 token');
    expect(s).toContain('百万预算单位 t');
  });

  it('源码声明杀手：RecallMoney 注释 + estTokens 口径 + 精确断言同步不回流', () => {
    const insight = src('src/core/memagent/recallInsight.ts');
    expect(insight).toContain('金额是**估算**，不是账单');
    expect(insight).toContain('未接入网关真实 usage');
    expect(insight).toMatch(/export const CHARS_PER_BUDGET_UNIT = 2/);
    expect(insight).toContain('**不是 LLM tokenizer 的 token 数**');
    const t = src('src/core/memagent/__tests__/recallInsight.test.ts');
    expect(t).toContain('💰 估算 本次');
    expect(t).toContain('¥/百万预算单位 t');
    expect(t).not.toContain('¥/百万 token');
  });
});

describe('5-F / ② growth 检索耗时接真到 4-I 的真实审计', () => {
  it('空账本 → latency_ms=0 · latency_samples=0（不拿 0 冒充已采集）', () => {
    const m = metricsFromLedger([], []);
    expect(m.latency_ms).toBe(0);
    expect(m.latency_samples).toBe(0);
  });

  it('3 条真实 recall 审计 → 平均值 20ms · 样本数 3', () => {
    const m = metricsFromLedger([], [
      audit({ latency_ms: 10 }), audit({ latency_ms: 20 }), audit({ latency_ms: 30 }),
    ]);
    expect(m.latency_ms).toBe(20);
    expect(m.latency_samples).toBe(3);
  });

  it('历史缺 latency_ms 的行与非 recall 动作不计入分母（与 4-I 同口径）', () => {
    const m = metricsFromLedger([], [
      audit({ latency_ms: 10 }),
      audit({ hits: 1 }),
      audit({ latency_ms: 999 }, 'write'),
    ]);
    expect(m.latency_ms).toBe(10);
    expect(m.latency_samples).toBe(1);
  });

  it('负值 / NaN / Infinity / 字符串不污染样本', () => {
    const m = metricsFromLedger([], [
      audit({ latency_ms: 10 }), audit({ latency_ms: -5 }), audit({ latency_ms: NaN }),
      audit({ latency_ms: Infinity }), audit({ latency_ms: '20' }),
    ]);
    expect(m.latency_ms).toBe(10);
    expect(m.latency_samples).toBe(1);
  });

  it('GrowthCards：有样本显示真值，无样本显示「未取数」且 note 指明真实审计字段', () => {
    const { unmount } = render(<GrowthCards m={metrics({ latency_ms: 218, latency_samples: 3 })} />);
    expect(screen.getByTestId('m-latency')).toHaveTextContent('218ms');
    expect(screen.getByTestId('growth-cards')).toHaveTextContent('detail.latency_ms');
    unmount();

    render(<GrowthCards m={metrics()} />);
    expect(screen.getByTestId('m-latency')).toHaveTextContent('未取数');
  });

  it('源码声明杀手：旧「账本未采样」措辞不回流，样本字段在类型/页面/夹具齐备', () => {
    const real = src('src/web/growth/useGrowthReal.ts');
    expect(real).not.toContain('账本无真实延迟采样');
    expect(real).toContain('latencySamples');
    expect(real).toContain("a.action === 'recall'");
    expect(src('src/web/growth/GrowthPanels.tsx')).not.toContain('耗时账本未采样');
    for (const f of ['src/web/growth/types.ts', 'src/web/growth/GrowthPage.tsx', 'src/web/growth/__tests__/fixtures.ts']) {
      expect(src(f)).toContain('latency_samples');
    }
  });
});

describe('5-F / ③ MANUAL-TEST-BATCH.md 历史清单就地更正', () => {
  const doc = () => src('specs/MANUAL-TEST-BATCH.md');

  it('frontmatter 标 archived 并被 42 号关账报告取代', () => {
    const d = doc();
    expect(d).toMatch(/status:\s*archived/);
    expect(d).toContain('superseded-by: specs/MANUAL-TEST-FIX-BATCH-42.md');
    expect(d).not.toMatch(/status:\s*done/);
  });

  it('顶部有归档声明 + 「不可作为当前验收依据」', () => {
    const d = doc();
    expect(d).toContain('历史验收清单（已归档');
    expect(d).toContain('不可作为当前验收依据');
    expect(d).toContain('批次42 更正索引');
  });

  it('旧演示预期标识在文档零命中（不复现假值）', () => {
    const d = doc();
    for (const legacy of [
      'claude-code', 'claude-free', '6.3s', 'req_m1', 'sync-00', '模拟一次代理调用',
      '5 维度条形图', '合并/覆盖/保留', 'safe-noop', '14 张卡', '占位链接', '熔断 OPEN',
      '7 条种子', '8 条种子', '队列 5 条', 'demo1234', 'l0pass', 'L1~L6 六层回执',
      '/百万 token', '真实 token 节省估算', '耗时账本未采样',
    ]) {
      expect(d, `旧标识仍在文档中：${legacy}`).not.toContain(legacy);
    }
  });

  it('当前诚实口径在位：三态 / 单一真源 / 真接口径 / 真实账本', () => {
    const d = doc();
    expect(d).toContain('getHostLlmSnapshot()');
    expect(d).toContain('policyFor()');
    expect(d).toContain('/api/mirror/audit');
    expect(d).toContain('new/grafted/duplicated/filtered');
    expect(d).toContain('本地预算单位 t');
    expect(d).toContain('detail.latency_ms');
    expect(d).toContain('未采集');
  });

  it('更正索引覆盖被推翻的关键条目编号', () => {
    const d = doc();
    for (const n of ['9 /', '15 /', '19 /', '39 /', '47–51', '93 |', '112–117', '120–123']) {
      expect(d).toContain(n);
    }
  });
});
