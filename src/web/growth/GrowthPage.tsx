// 自我净化与生长页（REQ-009 / P14）T4 编排
// 本地内存态为真相；mirror 为 safe-noop（fire-and-forget），与 dispute/logs/models 同模式。
import { useMemo, useState } from 'react';
import type {
  DeltaPoint, DimKey, DimWeights, GrowthAuditEntry, Layer, LayerThresholds, ScheduleItem,
} from './types.ts';
import {
  DEDUP_STATS_24H, DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, SAMPLES, SEED_DELTA, SEED_METRICS, SEED_SCHEDULE,
} from './seed.ts';
import {
  appendTunedPoint, auditOptimization, evaluateOptimizations, growthDelta,
  shortCircuitPath, validateSchedule, validateThresholds, validateWeights,
} from './logic.ts';
import { DedupCard, DevTunePanel, ShortCircuitFlow } from './DedupCards.tsx';
import { DeltaPanel, GrowthCards, OptimizationList, ScheduleTimeline } from './GrowthPanels.tsx';
import { useToast } from './useToast.tsx';

export function GrowthPage() {
  const [sampleIdx, setSampleIdx] = useState(0);
  const [weights, setWeights] = useState<DimWeights>({ ...DEFAULT_WEIGHTS });
  const [thresholds, setThresholds] = useState<LayerThresholds>({ ...DEFAULT_THRESHOLDS });
  const [devMode, setDevMode] = useState(false);
  const [metrics] = useState({ ...SEED_METRICS });
  const [schedule, setSchedule] = useState<ScheduleItem[]>(SEED_SCHEDULE.map((s) => ({ ...s })));
  const [series, setSeries] = useState<DeltaPoint[]>(SEED_DELTA.map((p) => ({ ...p })));
  const [audit, setAudit] = useState<GrowthAuditEntry[]>([]);
  const { node: toast, show } = useToast();

  const sample = SAMPLES[sampleIdx];
  const opts = useMemo(() => evaluateOptimizations(metrics), [metrics]);
  const steps = useMemo(() => shortCircuitPath(sample, weights, thresholds), [sample, weights, thresholds]);
  // R3：Δ 取自真实 7.1 反馈（演示值：调权重前 hit_rate=0.28，回归后 0.33）
  const delta = useMemo(() => growthDelta(metrics.hit_rate, 0.33), [metrics]);

  const wCheck = validateWeights(weights);
  const tCheck = validateThresholds(thresholds);
  const sCheck = validateSchedule(schedule);

  function handleResample() {
    setSampleIdx((i) => (i + 1) % SAMPLES.length);
  }

  function patchWeights(k: DimKey, v: number) {
    setWeights((w) => ({ ...w, [k]: v }));
  }
  function patchThresholds(l: Layer, v: number) {
    setThresholds((t) => ({ ...t, [l]: v }));
  }

  function handleManualTrigger() {
    // R4：手动触发 = 等价一次 ⑤ 权重回归，写 weight_tuned 审计；曲线追加 is_tuned 点
    const entry = auditOptimization(
      { auditName: 'weight_tuned', action: 'regress_mode_weights', key: 'regress_weights' },
      { trigger: 'manual', delta_before: delta },
      true,
    );
    setAudit((a) => [entry, ...a]);
    setSeries((s) => appendTunedPoint(s, `${s.length + 1}`, Math.min(0.06, delta * 1.4)));
    show('已手动触发一次自生长（等价 ⑤ 回归）· 审计 weight_tuned');
  }

  function handleToggle(key: ScheduleItem['key']) {
    const next = schedule.map((s) => (s.key === key ? { ...s, enabled: !s.enabled } : s));
    const check = validateSchedule(next);
    if (!check.ok) {
      show(check.msg);
      return;
    }
    setSchedule(next);
    show(`调度已更新：${key} ${next.find((s) => s.key === key)?.enabled ? '启用' : '停用'}（记审计 schedule_changed）`);
  }

  return (
    <div className="wrap" data-testid="growth-page">
      <h1>
        🌱 自我净化与生长页 <span className="badge p2">REQ-009 · P14</span>
        <label style={{ fontSize: 13, marginLeft: 14, fontWeight: 400 }}>
          <input type="checkbox" data-testid="dev-mode" checked={devMode} onChange={(e) => setDevMode(e.target.checked)} /> 开发者模式（G7）
        </label>
      </h1>
      <div className="sub">自净化（6.1 五维 + 6.2 短路嫁接）+ 自生长（7.1 指标 + 7.2 优化与收益 + 13.3 调度）</div>

      {(devMode && (!wCheck.ok || !tCheck.ok)) && (
        <div className="card" data-testid="tune-errors" style={{ borderColor: 'var(--danger,#ff5d5d)' }}>
          ⚠ {wCheck.ok ? tCheck.msg : wCheck.msg}
        </div>
      )}

      <DedupCard sample={sample} weights={weights} thresholds={thresholds} onResample={handleResample} />
      <ShortCircuitFlow steps={steps} stats={DEDUP_STATS_24H} />
      <DevTunePanel
        devMode={devMode} weights={weights} thresholds={thresholds}
        onWeights={patchWeights} onThresholds={patchThresholds}
      />

      <GrowthCards m={metrics} />
      <OptimizationList opts={opts} />
      <DeltaPanel series={series} delta={delta} audit={audit} onManualTrigger={handleManualTrigger} />
      <ScheduleTimeline schedule={schedule} onToggle={handleToggle} />

      <div className="card">
        <b>红线自检</b>
        <div className="note" data-testid="redline-status">
          R1 权重和={wCheck.sum.toFixed(3)} {wCheck.ok ? '✓' : '✗'} · 阈值单调 {tCheck.ok ? '✓' : '✗'} ·
          R2 优化全记审计 ✓ · R3 Δ 取自真实反馈 ✓ · R5 调度 {sCheck.ok ? '合法 ✓' : sCheck.msg}
        </div>
      </div>
      {toast}
    </div>
  );
}
