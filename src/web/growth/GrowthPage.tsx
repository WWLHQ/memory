// 自我净化与生长页（REQ-009 / P14）· 真实数据接真版
// 设计约定（与记忆库管理页一致）：数据真相 = 内核账本（桌面 Electron 下 = 主进程
// FileStorage 持久库；浏览器降级 = 内存态，未写入过即空账本 → 诚实空态，绝不伪造数据）。
// 本页所有展示数字均由 loadRealGrowth() 从真实账本实算（见 useGrowthReal.ts）：
//   · 指标卡 = 真实召回审计 + 真实记忆表
//   · 判重样本 = 真实记忆内容（最近 4 条），五维只填有可信测量的维度（缺的显示「未测量」）
//   · 24h 统计 = 真实 merge / filtered 审计条数
//   · Δ 曲线 = 真实 weight_tuned / growth_op 审计事件（无记录则空态）
//   · 调度 / 权重 / 阈值 = 真实配置（非演示数据）
import { useEffect, useMemo, useState } from 'react';
import type {
  DeltaPoint, DimKey, DimWeights, GrowthAuditEntry, GrowthMetrics, GrowthReceipt,
  Layer, LayerThresholds, ScheduleItem,
} from './types.ts';
import type { RealGrowth } from './useGrowthReal.ts';
import {
  DEFAULT_SCHEDULE, DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS,
} from './spec.ts';
import {
  evaluateOptimizations, growthDelta,
  shortCircuitPath, validateSchedule, validateThresholds, validateWeights,
} from './logic.ts';
import {
  coreGrowthAudit, coreLoadGrowthConfig, coreRunGrowthRegression, coreSaveGrowthConfig,
} from './coreGrowth.ts';
import { DEFAULT_SCHEDULE_FLAGS, type ScheduleFlags } from '../../shared/growthConfig.ts';
import { useGrowthMirror } from './useGrowthMirror.ts';
import { newRequestId } from '../kernel.ts';
import { hostCapability } from '../../desktop/hostBridge.ts';
import { loadRealGrowthData } from './useGrowthReal.ts';
import { DedupCard, DevTunePanel, ShortCircuitFlow } from './DedupCards.tsx';
import { DeltaPanel, GrowthCards, OptimizationList, RegressionTable, ScheduleTimeline } from './GrowthPanels.tsx';
import { useToast } from './useToast.tsx';

const EMPTY_METRICS: GrowthMetrics = {
  hit_rate: 0, confirmed: 0, rejected: 0, low_quality_ratio: 0, level_stats_L6: 0, latency_ms: 0, latency_samples: 0,
};

export function GrowthPage() {
  const [weights, setWeights] = useState<DimWeights>({ ...DEFAULT_WEIGHTS });
  const [thresholds, setThresholds] = useState<LayerThresholds>({ ...DEFAULT_THRESHOLDS });
  const [devMode, setDevMode] = useState(false);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [audit, setAudit] = useState<GrowthAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [real, setReal] = useState<RealGrowth | null>(null);
  const [receipt, setReceipt] = useState<GrowthReceipt | null>(null);
  const [sampleIdx, setSampleIdx] = useState(0);
  const { node: toast, show } = useToast();
  const reportMirror = useGrowthMirror();

  // 挂载：加载真实账本（记忆表 + 全量审计 + growth_op 历史）+ 已保存的生长配置（权重/阈值/调度）
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [r, cfg] = await Promise.all([loadRealGrowthData(), coreLoadGrowthConfig()]);
        if (!alive) return;
        setReal(r);
        setAudit(r.growthAudit.slice().reverse());
        setWeights(cfg.weights);
        setThresholds(cfg.thresholds);
        setSchedule(DEFAULT_SCHEDULE.map((s) => ({
          ...s,
          enabled: s.key === 'decay' ? true : cfg.schedule[s.key],
          run: r.scheduleRuns[s.key] ?? null,
        })));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const metrics = useMemo<GrowthMetrics>(() => real?.metrics ?? EMPTY_METRICS, [real]);
  const dedupStats = real?.dedupStats ?? { short_circuit_hits: 0, merged: 0, avg_cost_ms: 0, avg_cost_samples: 0 };
  const samples = real?.samples ?? [];
  const series: DeltaPoint[] = real?.deltaSeries ?? [];
  const empty = real ? !real.available : true;

  const sample = samples.length > 0 ? samples[sampleIdx % samples.length] : null;
  const opts = useMemo(() => evaluateOptimizations(metrics), [metrics]);
  const steps = useMemo(
    () => (sample ? shortCircuitPath(sample, weights, thresholds) : []),
    [sample, weights, thresholds],
  );
  // R3：Δ 取自真实 7.1 反馈（调权重前后命中率差；最近一次 weight_tuned 审计的 payload）
  const lastTuned = audit.filter((a) => a.event === 'weight_tuned').slice(0, 1)[0];
  const deltaBefore = real && lastTuned ? extractDeltaBefore(lastTuned) : 0;
  const delta = useMemo(() => {
    // Δ 优先取真实回归采纳的测试集 F1 提升；无采纳记录才退回历史 weight_tuned 的命中率差。
    const adopted = real?.regressionRecords.find(
      (r) => r.kind === 'adopted' && r.before && r.after,
    );
    if (adopted?.before && adopted.after) {
      return Math.round((adopted.after.f1 - adopted.before.f1) * 1000) / 1000;
    }
    return growthDelta(deltaBefore, metrics.hit_rate);
  }, [real, deltaBefore, metrics.hit_rate]);

  const wCheck = validateWeights(weights);
  const tCheck = validateThresholds(thresholds);
  const sCheck = validateSchedule(schedule);

  function handleResample() {
    if (samples.length > 1) setSampleIdx((i) => (i + 1) % samples.length);
  }

  function patchWeights(k: DimKey, v: number) {
    setWeights((w) => ({ ...w, [k]: v }));
  }
  function patchThresholds(l: Layer, v: number) {
    setThresholds((t) => ({ ...t, [l]: v }));
  }

  /** 调度项 → 内核开关（衰减恒开，R5） */
  function flagsOf(items: ScheduleItem[]): ScheduleFlags {
    const out = { ...DEFAULT_SCHEDULE_FLAGS, decay: true };
    for (const s of items) if (s.key !== 'decay') out[s.key] = s.enabled;
    return out;
  }

  async function handleSaveConfig() {
    const bad = !wCheck.ok ? wCheck.msg : !tCheck.ok ? tCheck.msg : !sCheck.ok ? sCheck.msg : null;
    if (bad) { show(bad); return; }
    const requestId = newRequestId('req');
    try {
      await coreSaveGrowthConfig({ weights, thresholds, schedule: flagsOf(schedule) }, requestId);
      show('判重参数已写入内核 preference 账本（真实审计 param_save）· 下次写入即按新配置查重');
    } catch {
      show('保存失败：内核暂不可达');
    }
  }

  async function handleManualTrigger() {
    // 手动触发 = 跑**真实**回归（与主进程 cron 同一核心算法）；
    // 三种结果由 core 落审计，页面只转述真实结论，不再手写 weight_tuned。
    try {
      const { result: r, receipt: rc } = await coreRunGrowthRegression();
      setReceipt(rc);
      if (r.status === 'insufficient_samples') {
        const c = r.counts;
        show(`样本不足（累计 ${c.total} 条 / 负例 ${c.negatives} 条）· 正在积累样本，非故障`);
      } else if (r.status === 'not_adopted') {
        show(`已评估未达门槛（${r.reason}）· 未改动权重/阈值`);
      } else {
        show(`已采纳：测试集 F1 ${r.before.test.f1} → ${r.after.test.f1}（F1 升 ≥0.02 且 precision 降 ≤0.05）`);
      }
      // 真实重载：曲线/指标/权重/阈值全部来自账本，不手工拼点
      const [fresh, cfg] = await Promise.all([loadRealGrowthData(), coreLoadGrowthConfig()]);
      setReal(fresh);
      setWeights(cfg.weights);
      setThresholds(cfg.thresholds);
      setAudit(fresh.growthAudit.slice().reverse());
    } catch {
      show('触发失败：内核暂不可达');
    }
  }

  async function handleToggle(key: ScheduleItem['key']) {
    const next = schedule.map((s) => (s.key === key ? { ...s, enabled: !s.enabled } : s));
    const check = validateSchedule(next);
    if (!check.ok) {
      show(check.msg);
      return;
    }
    const entry: GrowthAuditEntry = {
      event: 'schedule_changed', action: `toggle_${key}`,
      payload: JSON.stringify({ key, enabled: next.find((s) => s.key === key)?.enabled }),
      at: Date.now(),
    };
    const requestId = newRequestId('req');
    try {
      // 先落配置（内核下次写入即生效），再落审计；两步都成功才改页面状态
      await coreSaveGrowthConfig({ weights, thresholds, schedule: flagsOf(next) }, newRequestId('req'));
      await coreGrowthAudit(entry, requestId);
      reportMirror('schedule_changed', requestId, entry);
      setSchedule(next);
      show(`调度已更新：${key} ${next.find((s) => s.key === key)?.enabled ? '启用' : '停用'}（真实审计 schedule_changed）`);
    } catch {
      show('调度更新失败：内核暂不可达');
    }
  }

  if (loading) {
    return (
      <div className="p0-page" data-testid="growth-page">
        <div className="p0-hd">
          <h2>🌱 生长与自进化</h2>
          <span className="p0-tag">REQ-009 · P14</span>
        </div>
        <div className="note">加载真实账本中…</div>
      </div>
    );
  }

  return (
    <div className="p0-page" data-testid="growth-page">
      <div className="p0-hd">
        <h2>🌱 生长与自进化</h2>
        <span className="p0-tag">REQ-009 · P14</span>
        <span className="p0-tag info">真实 growth:v1</span>
        <div className="p0-right">
          <label style={{ fontSize: 11.5 }}>
            <input type="checkbox" data-testid="dev-mode" checked={devMode} onChange={(e) => setDevMode(e.target.checked)} /> 开发者模式（G7）
          </label>
        </div>
      </div>
      <div className="sub">
        自净化（6.1 五维：仅展示有可信测量的维度 + 6.2 短路嫁接）+ 自生长（7.1 指标 / 7.2 Δ / 13.3 调度 真实账本实算）·
        账本规模：记忆 {real?.memCount ?? 0} 条 / 审计 {real?.auditCount ?? 0} 条
      </div>

      {(devMode && (!wCheck.ok || !tCheck.ok)) && (
        <div className="p0-banner err" data-testid="tune-errors">
          ⚠ {wCheck.ok ? tCheck.msg : wCheck.msg}
        </div>
      )}

      <div className="p0-sec" data-testid="growth-sec-dedup">
        <div className="p0-sec-hd">
          <h3>一、判重与嫁接</h3>
          <span className="p0-tag">6.1 五维判重 · 6.2 多层短路</span>
        </div>
        <DedupCard sample={sample} weights={weights} thresholds={thresholds} onResample={handleResample} />
        <ShortCircuitFlow steps={steps} stats={dedupStats} />
        <DevTunePanel
          devMode={devMode} weights={weights} thresholds={thresholds}
          onWeights={patchWeights} onThresholds={patchThresholds} onSave={handleSaveConfig}
        />
      </div>

      <div className="p0-sec" data-testid="growth-sec-regression">
        <div className="p0-sec-hd">
          <h3>二、回归评估</h3>
          <span className="p0-tag">7.1 指标 · 7.2 Δ · 7.3 回归</span>
        </div>
        <GrowthCards m={metrics} empty={empty} />
        <OptimizationList opts={opts} />
        <RegressionTable records={real?.regressionRecords ?? []} />
        <DeltaPanel
          series={series} delta={delta} audit={audit} onManualTrigger={handleManualTrigger}
          regression={real?.regression ?? { kind: 'never_run', ts: null }}
          receipt={receipt}
        />
      </div>

      <div className="p0-sec" data-testid="growth-sec-schedule">
        <div className="p0-sec-hd">
          <h3>三、调度</h3>
          <span className="p0-tag">13.3 周期任务</span>
        </div>
        <ScheduleTimeline schedule={schedule} onToggle={handleToggle} hostKind={hostCapability()} />
      </div>

      <div className="p0-sec" data-testid="growth-sec-check">
        <div className="p0-sec-hd">
          <h3>四、红线自检</h3>
          <span className="p0-tag">R1–R10</span>
        </div>
        <div className="card">
          <b>红线自检</b>
          <div className="note" data-testid="redline-status">
            R1 权重和={wCheck.sum.toFixed(3)} {wCheck.ok ? '✓' : '✗'} · 阈值单调 {tCheck.ok ? '✓' : '✗'} ·
            R2 优化全记真实审计 ✓ · R3 Δ 取自真实反馈 ✓ · R5 调度 {sCheck.ok ? '合法 ✓' : sCheck.msg}
          </div>
        </div>
      </div>
      {toast}
    </div>
  );
}

/** 从真实 weight_tuned 审计的 payload 提取调权重前命中率（R3 真实差值来源） */
function extractDeltaBefore(entry: GrowthAuditEntry): number {
  try {
    const p = JSON.parse(entry.payload) as { delta_before?: number };
    return p.delta_before ?? 0;
  } catch {
    return 0;
  }
}
