// 阶段4-I / B8：监控指标卡跨模块接真契约。
// 旧实现：组名写「(1h)/(24h)/(1d)」却用全量审计零过滤；命中率 = recall 调用数/(recall+breach) 恒 100%；
// 证据不足率分母里 evidence_thin 审计根本不写入账本 → 恒 0%；payload_tokens p95 / 延迟 p99
// 谎称「账本无口径」显示「—」，而 agent.ts 的 recall 审计 detail 里本来就有 payload_tokens。
// 本套件锁住：真实时间窗口、真实 detail 字段分位数、内核审计字段接线、无口径卡「未采集」标注。
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { metricsFromLedger, percentile } from '../useMonitorReal.ts';
import { MetricGrid } from '../MetricGrid.tsx';
import { createMemAgent } from '../../../core/memagent/agent.ts';
import { FakeLlmProvider } from '../../../core/memagent/llm.ts';
import { InMemoryStorage } from '../../../core/memagent/storage.ts';
import { JsVectorBackend } from '../../../core/memagent/vector.ts';
import type { AuditRecord } from '../../../core/memagent/types.ts';

const NOW = 1_800_000_000_000;
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

function audit(over: Partial<AuditRecord> = {}): AuditRecord {
  return {
    request_id: `r_${Math.random().toString(36).slice(2, 9)}`,
    action: 'recall',
    ts: NOW - 60_000,
    detail: { hits: 2, payload_tokens: 100, latency_ms: 12, mode: 'auto', evidence_thin: false, pipeline_llm_tokens: 0 },
    ...over,
  } as AuditRecord;
}

function cardOf(audits: AuditRecord[], metric: string) {
  return metricsFromLedger([], audits, NOW).find((c) => c.metric === metric);
}

function src(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

describe('监控指标时间窗口与真实字段（阶段4-I / B8 变异杀手）', () => {
  it('percentile：最近秩分位数；空样本返回 null 而不是补 0', () => {
    expect(percentile([], 0.95)).toBeNull();
    expect(percentile([100, 200, 300, 400, 500], 0.95)).toBe(500);
    expect(percentile([500, 100, 400, 200, 300], 0.5)).toBe(300);
  });

  it('1h 窗口真过滤：2 小时前的召回不得混入命中率 / payload p95', () => {
    const audits = [
      audit({ detail: { hits: 3, payload_tokens: 500, latency_ms: 100, mode: 'auto', evidence_thin: false } }),
      audit({ ts: NOW - 2 * HOUR, detail: { hits: 0, payload_tokens: 9999, latency_ms: 9999, mode: 'auto', evidence_thin: false } }),
    ];
    expect(cardOf(audits, '命中率')?.value).toBe(100);
    expect(cardOf(audits, 'payload_tokens p95')?.value).toBe(500);
  });

  it('命中率按真实 detail.hits 实算，不再恒 100%', () => {
    const mk = (hits: number) => audit({ detail: { hits, payload_tokens: 10, latency_ms: 5, mode: 'auto', evidence_thin: false } });
    expect(cardOf([mk(2), mk(0), mk(0)], '命中率')?.value).toBe(33);
    expect(cardOf([mk(0), mk(0)], '命中率')?.value).toBe(0);
  });

  it('payload_tokens p95 从真实审计 detail 实算（不再谎称「账本无口径」）', () => {
    const vals = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    const audits = vals.map((payload_tokens) => audit({ detail: { hits: 1, payload_tokens, latency_ms: 10, mode: 'auto', evidence_thin: false } }));
    expect(cardOf(audits, 'payload_tokens p95')?.value).toBe(1000);
  });

  it('延迟 p99 从真实 latency_ms 实算并以秒展示', () => {
    const audits = Array.from({ length: 10 }, (_, i) => audit({
      detail: { hits: 1, payload_tokens: 10, latency_ms: (i + 1) * 10, mode: 'auto', evidence_thin: false },
    }));
    expect(cardOf(audits, '延迟 p99')?.value).toBe(0.1); // 100ms → 0.1s
  });

  it('证据不足率(1d) 按极简模式分母；非极简 / 超窗 / 历史缺字段均不计入', () => {
    const mk = (over: Partial<AuditRecord>, detail: Record<string, unknown>) => audit({ ...over, detail });
    const audits = [
      mk({}, { mode: 'minimal', evidence_thin: true, hits: 0, payload_tokens: 1, latency_ms: 1 }),
      mk({}, { mode: 'minimal', evidence_thin: false, hits: 1, payload_tokens: 1, latency_ms: 1 }),
      mk({}, { mode: 'auto', evidence_thin: true, hits: 0, payload_tokens: 1, latency_ms: 1 }), // 非极简
      mk({ ts: NOW - 2 * DAY }, { mode: 'minimal', evidence_thin: true, hits: 0, payload_tokens: 1, latency_ms: 1 }), // 超 1d
      mk({}, { mode: 'minimal', hits: 0, payload_tokens: 1, latency_ms: 1 }), // 历史缺 evidence_thin
    ];
    expect(cardOf(audits, '极简证据不足率(1d)')?.value).toBe(50);
  });

  it('死信消息(24h) 真按 24h 过滤，超窗不计入', () => {
    const audits = [
      audit({ action: 'sync_fail', ts: NOW - HOUR }),
      audit({ action: 'sync_fail', ts: NOW - 2 * DAY }),
    ];
    expect(cardOf(audits, '死信消息(24h)')?.value).toBe(1);
  });

  it('空账本 → 14 卡全「—」，绝不出现假 100% / 0%', () => {
    const cards = metricsFromLedger([], [], NOW);
    expect(cards).toHaveLength(14);
    expect(cards.every((c) => c.value === '—')).toBe(true);
    expect(cardOf([], '命中率')?.value).toBe('—');
    expect(cardOf([], '极简证据不足率(1d)')?.value).toBe('—');
  });

  it('历史审计缺 detail 字段 → 不计入分母，不拿 0 冒充已采集', () => {
    const audits = [
      audit({ detail: {} }),
      audit({ detail: { hits: 2, payload_tokens: 300, latency_ms: 20, mode: 'auto', evidence_thin: false } }),
    ];
    expect(cardOf(audits, '命中率')?.value).toBe(100);
    expect(cardOf(audits, 'payload_tokens p95')?.value).toBe(300);
  });

  it('端到端：内核 recall 真写 evidence_thin / latency_ms / pipeline_llm_tokens，监控卡据此出真值', async () => {
    const storage = new InMemoryStorage();
    const ma = createMemAgent({
      form: 'desktop', account: { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' },
      llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage,
    });
    await ma._seedMemory({ content: 'monitor wiring recall sample', category: 'fact', project_id: 'P1' });
    await ma.recall({ query: 'monitor wiring recall sample', project_id: 'P1' });
    const recalls = await storage.queryAudit({ action: 'recall' });
    expect(recalls).toHaveLength(1);
    expect(recalls[0].detail).toHaveProperty('evidence_thin');
    expect(recalls[0].detail).toHaveProperty('latency_ms');
    expect(recalls[0].detail.latency_ms).toBeGreaterThanOrEqual(0);
    expect(recalls[0].detail).toHaveProperty('pipeline_llm_tokens', 0);

    const cards = metricsFromLedger(await storage.listMemories({}), await storage.queryAudit({}));
    expect(cards.find((c) => c.metric === 'payload_tokens p95')?.value).toBeTypeOf('number');
    expect(cards.find((c) => c.metric === '延迟 p99')?.value).toBeTypeOf('number');
  });

  it('pipeline_llm_tokens 恒 0（未接网关 usage）→ 仍「—」，不拿 0 算 p95 冒充已接通', () => {
    const cards = metricsFromLedger([], [
      audit({ detail: { hits: 1, payload_tokens: 100, latency_ms: 10, mode: 'auto', evidence_thin: false, pipeline_llm_tokens: 0 } }),
    ], NOW);
    expect(cards.find((c) => c.metric === 'pipeline_llm_tokens p95')?.value).toBe('—');
  });

  it('MetricGrid 空值卡值位标「未采集」、有值卡不标', () => {
    const empty = metricsFromLedger([], [], NOW);
    const first = render(<MetricGrid cards={empty} />);
    expect(first.container.querySelectorAll('.mval.empty')).toHaveLength(14);
    expect([...first.container.querySelectorAll('.mval')].every((n) => (n.textContent || '').trim() === '未采集')).toBe(true);
    first.unmount();
    const second = render(<MetricGrid cards={empty.map((c, i) => (i === 0 ? { ...c, value: 42 } : c))} />);
    expect([...second.container.querySelectorAll('.mval')].filter((n) => (n.textContent || '').trim() === '未采集')).toHaveLength(13);
  });

  it('源码声明契约：旧全量分母 / 假分位数 / 缺接线不得回流', () => {
    const monitor = src('src/web/monitor/useMonitorReal.ts');
    const agent = src('src/core/memagent/agent.ts');
    const grid = src('src/web/monitor/MetricGrid.tsx');
    expect(monitor).not.toMatch(/recallDenom/);
    expect(monitor).not.toMatch(/action === 'evidence_thin'/);
    expect(monitor).toMatch(/within\(a, HOUR, now\)/);
    expect(monitor).toMatch(/'latency_ms'/);
    expect(agent).toMatch(/evidence_thin: evidence_thin \?\? false/);
    expect(agent).toMatch(/const latency_ms = Date\.now\(\) - now/);
    expect(grid).toMatch(/未采集/);
  });
});
