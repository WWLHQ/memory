// 阶段4-I / B8：监控指标卡跨模块接真契约。
// 旧实现：组名写「(1h)/(24h)/(1d)」却用全量审计零过滤；命中率 = recall 调用数/(recall+breach) 恒 100%；
// 证据不足率分母里 evidence_thin 审计根本不写入账本 → 恒 0%；payload_tokens p95 / 延迟 p99
// 谎称「账本无口径」显示「—」，而 agent.ts 的 recall 审计 detail 里本来就有 payload_tokens。
// 本套件锁住：真实时间窗口、真实 detail 字段分位数、内核审计字段接线、无口径卡「暂无数据」标注与人话短名契约。
// 原子任务 B 增量：monitor:stats 接真覆盖 5 卡；链路开销恒 0 显真实 0；真实 0 显示 0（不冒充空态）；证据不足无样本显「无极简」。
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { metricsFromLedger, percentile, applyMonitorStats, type MonitorStats } from '../useMonitorReal.ts';
import { MetricGrid } from '../MetricGrid.tsx';
import { MONITOR_GROUP_TEXT, monitorMetricKeys, monitorText, monitorValueText } from '../../growth/recallLabels.ts';
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

  it('空账本 + 无 monitor：依赖主进程拨测的 5 卡保持「未取数」，账本可算卡显示真实值（0 / 无极简）', () => {
    const cards = metricsFromLedger([], [], NOW);
    expect(cards).toHaveLength(13);
    const vals = Object.fromEntries(cards.map((c) => [c.metric, c.value]));
    // 主进程拨测相关（无 monitor 数据）：诚实空态
    for (const k of ['连通成功率(5min)', '熔断状态', '平均延迟', '写入成功率', '哈希校验失败(24h)']) {
      expect(vals[k], k).toBe('未取数');
    }
    // 账本可算：真实 0 不是假 0%
    expect(vals['待裁决']).toBe(0);
    expect(vals['超期 7d']).toBe(0);
    expect(vals['pipeline_llm_tokens p95']).toBe(0);
    expect(vals['极简证据不足率(1d)']).toBe('无极简');
    // 无召回审计
    expect(vals['命中率']).toBe('未取数');
    expect(vals['payload_tokens p95']).toBe('未取数');
    expect(vals['延迟 p99']).toBe('未取数');
    expect(vals['精炼队列']).toBe('未取数');
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

  it('pipeline_llm_tokens 恒 0（本地检索不调大模型）→ 显示真实 0，不再叫未采集', () => {
    const cards = metricsFromLedger([], [
      audit({ detail: { hits: 1, payload_tokens: 100, latency_ms: 10, mode: 'auto', evidence_thin: false, pipeline_llm_tokens: 0 } }),
    ], NOW);
    expect(cards.find((c) => c.metric === 'pipeline_llm_tokens p95')?.value).toBe(0);
  });

  it('MetricGrid：无样本卡标「暂无数据」、有真实值卡（含真实 0 / 无极简）不标', () => {
    const empty = metricsFromLedger([], [], NOW);
    const first = render(<MetricGrid cards={empty} />);
    // 9 张无样本（Agent 健康3 + 冷存储2 + 命中率/注入量/尾延迟 + 精炼队列）；其余 4 张显示真实值
    expect(first.container.querySelectorAll('.mval.empty')).toHaveLength(9);
    expect(first.container.textContent).toContain('暂无数据');
    expect(first.container.textContent).toContain('近 1 天没有极简检索');
    first.unmount();
    // 第 0 张（连通率）设值后不再 empty
    const second = render(<MetricGrid cards={empty.map((c, i) => (i === 0 ? { ...c, value: 42 } : c))} />);
    expect(second.container.querySelectorAll('.mval.empty')).toHaveLength(8);
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
    expect(grid).toMatch(/暂无数据/);
  });
});

describe('监控页人话契约（2026-11-15 用户拍板：短名 ≤5 字 + 一句白话）', () => {
  it('13 张指标卡全部有中文短名，且短名 / 依据 ≤5 字', () => {
    expect(monitorMetricKeys()).toHaveLength(13);
    const cards = metricsFromLedger([], [], NOW);
    expect(cards).toHaveLength(13);
    for (const c of cards) {
      const t = monitorText(c.metric);
      expect(t.label.length).toBeLessThanOrEqual(5);
      expect(t.label).not.toBe('未命名指标');
      expect(t.hint.length).toBeGreaterThan(0);
      expect(t.basis.length).toBeLessThanOrEqual(5);
    }
    expect(Object.keys(MONITOR_GROUP_TEXT)).toHaveLength(5);
  });

  it('用户点名的四项都变成人话短名', () => {
    expect(monitorText('payload_tokens p95').label).toBe('注入量');
    expect(monitorText('pipeline_llm_tokens p95').label).toBe('链路开销');
    expect(monitorText('延迟 p99').label).toBe('尾延迟');
    expect(monitorText('精炼队列').label).toBe('精炼队列');
  });

  it('渲染层不出原始字段名 / 英文枚举 / 规格编号', () => {
    const { container } = render(<MetricGrid cards={metricsFromLedger([], [], NOW)} />);
    const text = container.textContent ?? '';
    for (const raw of ['payload_tokens', 'pipeline_llm_tokens', 'RawArchive', 'p95', 'p99', '12.1', 'P10', '2.4.1', '未采集']) {
      expect(text, `UI 泄漏原始标记：${raw}`).not.toContain(raw);
    }
    expect(text).toContain('注入量');
    expect(text).toContain('尾延迟');
    expect(text).toContain('精炼队列');
    expect(text).toContain('暂无数据');
  });

  it('未知内部键 → 诚实兜底，不吐原始字段名', () => {
    expect(monitorText('some_raw_field').label).toBe('未命名指标');
    expect(monitorText('some_raw_field').hint).toBe('没有可翻译的明细');
    expect(monitorValueText('OPEN')).toBe('已切断');
    expect(monitorValueText('无极简')).toBe('近 1 天没有极简检索');
    expect(monitorValueText('unknown_enum')).toBe('没有可翻译的明细');
    expect(monitorValueText(2858)).toBe('2858');
  });

  it('精炼队列有真回执 → 值位显示成功/失败/等待三项；无回执 → 整卡暂无数据', () => {
    const summary = {
      enabled: true, pending: 0, done: 2247, failed: 1273, skipped: 265,
      day: '2026-11-15', day_rows: 9, cap_enabled: false, cap_rows: 500,
      day_limit: null, day_left: null, max_engines_per_call: 3,
      stop_codes: {}, updated_at: NOW, queue_path: 'refine-queue.json',
    };
    const withRefine = metricsFromLedger([], [], NOW, summary);
    const queue = withRefine.find((c) => c.metric === '精炼队列');
    expect(queue?.parts).toEqual({ ok: 2247, failed: 1273, waiting: 0, skipped: 265 });
    const { container } = render(<MetricGrid cards={withRefine} />);
    const text = container.querySelector('[data-testid="metric-精炼队列"]')?.textContent ?? '';
    expect(text).toContain('成功 2247');
    expect(text).toContain('失败 1273');
    expect(text).toContain('等待 0');
    expect(text).toContain('另有 265 条因内容太少跳过');
    const without = metricsFromLedger([], [], NOW, null).find((c) => c.metric === '精炼队列');
    expect(without?.value).toBe('未取数');
    expect(without?.parts).toBeUndefined();
  });

  it('死信卡已删：13 张卡里不存在该指标', () => {
    expect(metricsFromLedger([], [], NOW).some((c) => c.metric === '死信消息(24h)')).toBe(false);
  });
});

describe('monitor:stats 接真（原子任务 B）', () => {
  const base = () => metricsFromLedger([], [], NOW);
const stats = (over: Partial<MonitorStats> = {}): MonitorStats => ({
  agent: { connectivityRate: 100, circuit: 'CLOSED', avgLatencyMs: 120, probedAt: NOW, windowSamples: 25, ...over.agent },
  writeRate: over.writeRate ?? { rate: 99, success: 100, filtered: 1, failed: 0, since: NOW - 86_400_000 },
  checksumFail: over.checksumFail ?? 0,
});

  it('无 stats → 卡原样不动', () => {
    const b = base();
    const out = applyMonitorStats(b, null);
    expect(out.map((c) => c.value)).toEqual(b.map((c) => c.value));
  });

  it('stats 有数据 → 5 卡接真覆盖', () => {
    const m = applyMonitorStats(base(), stats());
    expect(m.find((c) => c.metric === '连通成功率(5min)')?.value).toBe(100);
    expect(m.find((c) => c.metric === '熔断状态')?.value).toBe('CLOSED');
    expect(m.find((c) => c.metric === '平均延迟')?.value).toBeCloseTo(0.12, 2);
    expect(m.find((c) => c.metric === '写入成功率')?.value).toBe(99);
    expect(m.find((c) => c.metric === '哈希校验失败(24h)')?.value).toBe(0);
    // 未覆盖的卡保持原值
    expect(m.find((c) => c.metric === '待裁决')?.value).toBe(0);
  });

  it('熔断 OPEN → crit；连通率 <95% 只判 warn（规格 12.1 无 second crit 档）', () => {
    const open = stats({ agent: { connectivityRate: 70, circuit: 'OPEN', avgLatencyMs: 120, probedAt: NOW, windowSamples: 25 } });
    const m = applyMonitorStats(base(), open);
    expect(m.find((c) => c.metric === '熔断状态')?.level).toBe('crit');
    // 规格 12.1：连通成功率只有 <95% ⚠️ 一档；<80% 不再额外造 🔴 严重档
    expect(m.find((c) => c.metric === '连通成功率(5min)')?.level).toBe('warn');
  });

  it('熔断零样本（windowSamples=0）→ 不覆盖，保持未取数（不拿初始 CLOSED 冒充「正常」）', () => {
    const s: MonitorStats = {
      agent: { connectivityRate: null, circuit: 'CLOSED', avgLatencyMs: null, probedAt: null, windowSamples: 0 },
      writeRate: null,
      checksumFail: null,
    };
    const m = applyMonitorStats(base(), s);
    expect(m.find((c) => c.metric === '熔断状态')?.value).toBe('未取数');
    expect(m.find((c) => c.metric === '连通成功率(5min)')?.value).toBe('未取数');
    expect(m.find((c) => c.metric === '平均延迟')?.value).toBe('未取数');
  });

  it('写入率 77%（含质量门过滤）→ 按方案 1 口径已成为 warn 而非 crit；95~99.5 也只 warn', () => {
    const low = stats({ writeRate: { rate: 77, success: 91, filtered: 27, failed: 0, since: NOW - 86_400_000 } });
    const m = applyMonitorStats(base(), low);
    expect(m.find((c) => c.metric === '写入成功率')?.level).toBe('warn');
    const mid = stats({ writeRate: { rate: 97, success: 97, filtered: 3, failed: 0, since: NOW - 86_400_000 } });
    expect(applyMonitorStats(base(), mid).find((c) => c.metric === '写入成功率')?.level).toBe('warn');
    const good = stats({ writeRate: { rate: 100, success: 91, filtered: 27, failed: 0, since: NOW - 86_400_000 } });
    expect(applyMonitorStats(base(), good).find((c) => c.metric === '写入成功率')?.level).toBe('ok');
  });

  it('连通率 80%~95% → 告警（warn），未到严重', () => {
    const warn = stats({ agent: { connectivityRate: 85, circuit: 'CLOSED', avgLatencyMs: 120, probedAt: NOW, windowSamples: 25 } });
    const m = applyMonitorStats(base(), warn);
    expect(m.find((c) => c.metric === '连通成功率(5min)')?.level).toBe('warn');
  });

  it('写入率 null / 校验异常 null → 不覆盖（保持未取数）', () => {
    // 主进程首轮慢计算前 cache 为 null；stats() helper 的 ?? 会吞 null，故直接写对象
    const s: MonitorStats = {
      agent: { connectivityRate: 100, circuit: 'CLOSED', avgLatencyMs: 120, probedAt: NOW, windowSamples: 25 },
      writeRate: null,
      checksumFail: null,
    };
    const m = applyMonitorStats(base(), s);
    expect(m.find((c) => c.metric === '写入成功率')?.value).toBe('未取数');
    expect(m.find((c) => c.metric === '哈希校验失败(24h)')?.value).toBe('未取数');
  });
});
