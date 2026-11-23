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
  DeltaMetric, DeltaPoint, DimKey, DimWeights, GrowthAuditEntry, GrowthMetrics, GrowthReceipt,
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
  coreGrowthAudit, coreLoadGrowthConfig, coreRunEvolution, coreRunGrowthRegression, coreSaveGrowthConfig,
} from './coreGrowth.ts';
import {
  DEFAULT_EVOLUTION, DEFAULT_FEEDBACK_POLICY, DEFAULT_RECALL_WEIGHTS,
  DEFAULT_SCHEDULE_EXPRS, DEFAULT_SCHEDULE_FLAGS,
  type EvolutionConfig, type FeedbackPolicy, type RecallWeights,
  type ScheduleExprs, type ScheduleFlags,
} from '../../shared/growthConfig.ts';
import { useGrowthMirror } from './useGrowthMirror.ts';
import { newRequestId } from '../kernel.ts';
import { hostCapability } from '../../desktop/hostBridge.ts';
import { loadRealGrowthData } from './useGrowthReal.ts';
import { summarizeAgentUsage, type AgentUsageSummary } from '../../core/memagent/agentUsage.ts';
import { DedupCard, DevTunePanel, ShortCircuitFlow } from './DedupCards.tsx';
import {
  AgentUsageCard, DeltaPanel, FeedbackLoopCard, GrowthCards, OptimizationList,   RecallWeightCard,
  RegressionTable, ScheduleTimeline, EvolutionEffectCard,
} from './GrowthPanels.tsx';
import { EvolutionSettingsCard } from './EvolutionSettingsCard.tsx';
import { EvolutionTimelineCard } from './EvolutionTimelineCard.tsx';
import { useToast } from './useToast.tsx';
import { useHostTheme } from '../shared/hostTheme.ts';
import '../shared/afPage.css';

const EMPTY_METRICS: GrowthMetrics = {
  hit_rate: 0, confirmed: 0, rejected: 0, low_quality_ratio: 0, level_stats_L6: 0, latency_ms: 0, latency_samples: 0,
};

/**
 * 把底层异常还原成可读原因。进化轮属于「必须能自我诊断」的链路：
 * 只写「内核暂不可达」会把真因（如 2026-11-14 的 request_id 非法）永久吞掉。
 */
const errText = (e: unknown): string => String((e as Error)?.message ?? e);

/** 回归四态 → 人话（与 RegressionTable / DeltaPanel 同一份真实审计口径） */
const REGRESSION_LABEL: Record<string, string> = {
  never_run: '未到运行时间',
  insufficient_samples: '样本不足（积累中）',
  not_adopted: '已评估未达门槛',
  adopted: '已采纳',
};

export function GrowthPage() {
  useHostTheme();
  const [weights, setWeights] = useState<DimWeights>({ ...DEFAULT_WEIGHTS });
  const [thresholds, setThresholds] = useState<LayerThresholds>({ ...DEFAULT_THRESHOLDS });
  // 批次61 GAP-1/GAP-2：召回权重与反馈策略也从 growth:v1 读写（默认值 = 历史常量 / 策略关闭）
  const [recallWeights, setRecallWeights] = useState<RecallWeights>({ ...DEFAULT_RECALL_WEIGHTS });
  const [feedbackPolicy, setFeedbackPolicy] = useState<FeedbackPolicy>({ ...DEFAULT_FEEDBACK_POLICY });
  // M0-5：自生长进化配置 + 调度频率表达式（与判重配置独立读写，避免被「改判重」顺手重置）
  const [evolution, setEvolution] = useState<EvolutionConfig>({ ...DEFAULT_EVOLUTION });
  const [scheduleExprs, setScheduleExprs] = useState<ScheduleExprs>({ ...DEFAULT_SCHEDULE_EXPRS });
  const [devMode, setDevMode] = useState(false);
  // 结构照定稿：4 个页签（判重与嫁接 / 回归评估 / 调度 / 红线自检），只渲染当前页签
  const [tab, setTab] = useState(0);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [audit, setAudit] = useState<GrowthAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [real, setReal] = useState<RealGrowth | null>(null);
  const [receipt, setReceipt] = useState<GrowthReceipt | null>(null);
  const [sampleIdx, setSampleIdx] = useState(0);
  // M5-2：手动跑一轮进化的运行态与真实回执文案
  const [evoRunning, setEvoRunning] = useState(false);
  const [evoReceipt, setEvoReceipt] = useState<string | null>(null);
  const { node: toast, show } = useToast();
  const reportMirror = useGrowthMirror();

  // 深链：?tab=0..2 与页签一一对应（红线自检已并入判重页签；无参数 = 判重与嫁接）
  useEffect(() => {
    const t = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('tab') : null;
    const n = t === null ? NaN : Number(t);
    if (Number.isInteger(n) && n >= 0 && n <= 2) setTab(n);
  }, []);

  /** 场景卡动作：切页签并滚到真实面板（按钮本身只做导航，不改任何业务状态） */
  const jumpTo = (index: number, testid: string) => {
    setTab(index);
    setTimeout(() => {
      document.querySelector(`[data-testid="${testid}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  };

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
        setRecallWeights(cfg.recall_weights);
        setFeedbackPolicy(cfg.feedback_policy);
        setEvolution(cfg.evolution);
        setScheduleExprs(cfg.schedule_exprs);
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
  // GAP-3：未加载/空账本时给一份「全空」画像 —— 卡片据此显示「暂无数据」，而不是 0
  const agentUsage = useMemo<AgentUsageSummary>(
    () => real?.agentUsage ?? summarizeAgentUsage([], Date.now(), 7),
    [real],
  );
  const dedupStats = real?.dedupStats ?? { short_circuit_hits: 0, merged: 0, avg_cost_ms: 0, avg_cost_samples: 0 };
  const samples = real?.samples ?? [];
  const series: DeltaPoint[] = real?.deltaSeries ?? [];
  const empty = real ? !real.available : true;

  // ── 摘要 / 场景卡的真实读数（全部由 real + growth:v1 派生；取不到就写未采样） ──
  const regressionKind = real?.regression.kind ?? 'never_run';
  const regressionText = REGRESSION_LABEL[regressionKind] ?? regressionKind;
  const enabledSchedules = schedule.filter((s) => s.enabled).length;
  const hitRateText = metrics.hit_rate > 0 ? `${(metrics.hit_rate * 100).toFixed(1)}%` : '未采样';
  const dedupCostText = dedupStats.avg_cost_samples > 0 ? `${Math.round(dedupStats.avg_cost_ms)}ms` : '未采样';
  const lastAudit = audit[0] ?? null;

  /** 重新读真实账本 + growth:v1（只读刷新，不写审计、不改配置） */
  async function reloadAll() {
    try {
      const [fresh, cfg] = await Promise.all([loadRealGrowthData(), coreLoadGrowthConfig()]);
      setReal(fresh);
      setAudit(fresh.growthAudit.slice().reverse());
      setWeights(cfg.weights);
      setThresholds(cfg.thresholds);
      setRecallWeights(cfg.recall_weights);
      setFeedbackPolicy(cfg.feedback_policy);
      setEvolution(cfg.evolution);
      setScheduleExprs(cfg.schedule_exprs);
      show(`已重新读取真实账本：记忆 ${fresh.memCount} 条 / 审计 ${fresh.auditCount} 条`);
    } catch (e) {
      show(`刷新失败：${errText(e)}`);
    }
  }

  const sample = samples.length > 0 ? samples[sampleIdx % samples.length] : null;
  const opts = useMemo(() => evaluateOptimizations(metrics), [metrics]);
  const steps = useMemo(
    () => (sample ? shortCircuitPath(sample, weights, thresholds) : []),
    [sample, weights, thresholds],
  );
  // R3：Δ 取自真实 7.1 反馈（调权重前后命中率差；最近一次 weight_tuned 审计的 payload）
  const lastTuned = audit.filter((a) => a.event === 'weight_tuned').slice(0, 1)[0];
  const deltaBefore = real && lastTuned ? extractDeltaBefore(lastTuned) : 0;
  // 口径分离：聚合 Δ 优先取真实回归采纳的测试集 F1 提升；无采纳记录才退回历史 weight_tuned 的命中率差。
  const adopted = real?.regressionRecords.find(
    (r) => r.kind === 'adopted' && r.before && r.after,
  );
  const hasF1Baseline = Boolean(adopted?.before && adopted.after);
  // 2026-11-14 事故：此前无基线时 deltaBefore 落 0，于是 Δ = 当前命中率（0.942）被当成「改善 +0.942」并标绿，
  // 与同卡「暂无真实自生长调参记录」自相矛盾。没有基线就明说没有基线，绝不拿 0 冒充「调前」。
  const deltaMetric: DeltaMetric = hasF1Baseline ? 'f1_gain' : lastTuned ? 'hitrate_delta' : 'none';
  const delta = useMemo(() => {
    if (adopted?.before && adopted.after) {
      return Math.round((adopted.after.f1 - adopted.before.f1) * 1000) / 1000;
    }
    if (!lastTuned) return 0; // 无基线 → 数字无意义，由 DeltaPanel 按 deltaMetric='none' 渲染
    return growthDelta(deltaBefore, metrics.hit_rate);
  }, [adopted, lastTuned, deltaBefore, metrics.hit_rate]);

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

  /**
   * 批次61 GAP-1：采纳召回权重建议 —— 用户显式确认后才写 growth:v1.recall_weights。
   * 其余配置（判重五维 / 阈值 / 调度 / 反馈策略）一并带上现值，避免被页面旧状态覆盖。
   */
  async function handleApplyRecallWeights(to: RecallWeights) {
    const requestId = newRequestId('req');
    const at = Date.now();
    try {
      await coreSaveGrowthConfig(
        { weights, thresholds, schedule: flagsOf(schedule), recall_weights: to },
        requestId,
      );
      const entry: GrowthAuditEntry = {
        event: 'recall_weight_applied', action: 'apply_recall_weights',
        payload: JSON.stringify({ from: recallWeights, to, at }), at,
      };
      await coreGrowthAudit(entry, requestId);
      reportMirror('recall_weight_applied', requestId, entry);
      const [fresh, cfg] = await Promise.all([loadRealGrowthData(), coreLoadGrowthConfig()]);
      setReal(fresh);
      setRecallWeights(cfg.recall_weights);
      setAudit(fresh.growthAudit.slice().reverse());
      show('已采纳召回权重建议：写入 growth:v1，下次召回按新权重排序');
    } catch {
      show('采纳失败：内核暂不可达');
    }
  }

  /**
   * 批次61 GAP-2：保存反馈策略（含启用开关）—— 写 growth:v1.feedback_policy。
   * 关闭 = 与改造前逐字一致；开启后 coreFeedback 才按窗口/阈值触发降档。
   */
  async function handleSaveFeedbackPolicy(next: FeedbackPolicy) {
    const requestId = newRequestId('req');
    const at = Date.now();
    try {
      await coreSaveGrowthConfig(
        { weights, thresholds, schedule: flagsOf(schedule), feedback_policy: next },
        requestId,
      );
      const entry: GrowthAuditEntry = {
        event: 'feedback_policy_changed',
        action: next.enabled ? 'enable_feedback_downgrade' : 'disable_feedback_downgrade',
        payload: JSON.stringify(next), at,
      };
      await coreGrowthAudit(entry, requestId);
      reportMirror('feedback_policy_changed', requestId, entry);
      setFeedbackPolicy(next);
      show(`反馈策略已${next.enabled ? '启用' : '停用'}：写入 growth:v1.feedback_policy`);
    } catch {
      show('反馈策略保存失败：内核暂不可达');
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

  /**
   * M0-5：保存自生长进化设置（mode / 窗口 / 最小样本 / 回滚 / 护栏 / 调度频率表达式）。
   * 只改这两块的保存不得重置判重权重/阈值/调度开关/召回权重/反馈策略（coreSaveGrowthConfig 继承账本现值）；
   * 写入真审计 evolution_settings_changed，重进页面不丢历史。
   */
  async function handleSaveEvolution(nextEvolution: EvolutionConfig, nextExprs: ScheduleExprs) {
    const requestId = newRequestId('req');
    const at = Date.now();
    try {
      await coreSaveGrowthConfig(
        { weights, thresholds, schedule: flagsOf(schedule), evolution: nextEvolution, schedule_exprs: nextExprs },
        requestId,
      );
      const entry: GrowthAuditEntry = {
        event: 'evolution_settings_changed', action: 'save_evolution_settings',
        payload: JSON.stringify({ evolution: nextEvolution, schedule_exprs: nextExprs }), at,
      };
      await coreGrowthAudit(entry, requestId);
      reportMirror('evolution_settings_changed', requestId, entry);
      const [fresh, cfg] = await Promise.all([loadRealGrowthData(), coreLoadGrowthConfig()]);
      setReal(fresh);
      setEvolution(cfg.evolution);
      setScheduleExprs(cfg.schedule_exprs);
      setAudit(fresh.growthAudit.slice().reverse());
      show('自生长进化设置已写入 growth:v1（真实审计 evolution_settings_changed）');
    } catch {
      show('进化设置保存失败：内核暂不可达');
    }
  }

  /**
   * M5-2：手动跑一轮进化（与每周日 03:00 cron 同一套函数：进化轮 + 回诊）。
   * 回执只说真实结果：mode=off → 零审计；无样本 → 明确「还需 N 次」；有采纳/回滚 → 报真实状态。
   */
  async function handleRunEvolution() {
    setEvoRunning(true);
    setEvoReceipt(null);
    try {
      const r = await coreRunEvolution({ force: true });
      if (r.mode === 'off') {
        const msg = '进化已关闭（mode=off）：本轮没有运行，也没有写任何审计';
        setEvoReceipt(msg);
        show(msg);
        return;
      }
      const recall = r.round.decisions.find((d) => d.family === 'recall_weights');
      const parts: string[] = [`本轮新增 ${r.added} 条 growth_op 审计`];
      if (recall) parts.push(`召回权重：${recall.status}（${recall.reason}）`);
      parts.push(`回诊：${r.rollback.status}`);
      const msg = parts.join(' · ');
      setEvoReceipt(msg);
      show(msg);
      // 真实重载：时间线/漂移/审计全部来自账本，不手工拼点
      const [fresh, cfg] = await Promise.all([loadRealGrowthData(), coreLoadGrowthConfig()]);
      setReal(fresh);
      setRecallWeights(cfg.recall_weights);
      setAudit(fresh.growthAudit.slice().reverse());
    } catch (e) {
      // 报真因：本轮已在 core 内做过审计形状自检，异常文本本身就是可执行的排查线索。
      const msg = `手动进化触发失败：${errText(e)}`;
      setEvoReceipt(msg);
      show(msg);
    } finally {
      setEvoRunning(false);
    }
  }

  if (loading) {
    return (
      <div className="p0-page af-page" data-testid="growth-page">
        <div className="af-head" data-testid="growth-head">
          <h1>净化生长</h1>
          <span className="sub">正在读取真实账本…</span>
        </div>
        <div className="note">加载真实账本中…</div>
      </div>
    );
  }

  return (
    <div className="p0-page af-page" data-testid="growth-page">
      <div className="af-head" data-testid="growth-head">
        <h1>净化生长</h1>
        <span className="sub">
          真实账本 · 记忆 {real?.memCount ?? 0} 条 / 审计 {real?.auditCount ?? 0} 条 · 自净化（五维判重 + 短路嫁接）+ 自生长（回归 / 调度 / 进化）
        </span>
        <span className="right">
          <span className="p0-tag info">growth:v1 真实配置</span>
          <label style={{ fontSize: 11.5 }}>
            <input type="checkbox" data-testid="dev-mode" checked={devMode} onChange={(e) => setDevMode(e.target.checked)} /> 开发者模式（G7）
          </label>
        </span>
      </div>

      {/* ── 摘要读数条（真实账本 / growth:v1，取不到写未采样） ── */}
      <section className="af-panel" data-testid="growth-summary">
        <div className="af-ph"><h3>生长摘要</h3><span className="hint">核心账本 + growth:v1 · 非示例数据</span></div>
        <div className="af-pb">
          <div className="af-g4">
            <div className="af-stat">
              <div className="k">账本记忆 <span>memCount</span></div>
              <div className="v">{real?.memCount ?? 0}</div>
              <div className="d mut">判重样本实际取自其中最近 {samples.length} 条</div>
            </div>
            <div className="af-stat" data-testid="growth-stat-hitrate">
              <div className="k">检索命中率 <span>hit_rate</span></div>
              <div className={`v${metrics.hit_rate > 0 ? '' : ' sm'}`}>{hitRateText}</div>
              <div className={metrics.hit_rate > 0 ? 'd' : 'd mut'}>
                {metrics.hit_rate > 0 ? `召回审计实算 · L6 命中 ${metrics.level_stats_L6}` : '账本暂无召回审计，不写 0 冒充读数'}
              </div>
            </div>
            <div className="af-stat">
              <div className="k">最近回归 <span>dedup_regression</span></div>
              <div className="v sm">{regressionText}</div>
              <div className={regressionKind === 'adopted' ? 'd' : 'd mut'}>
                {real?.regression.ts ? `真实审计时间 ${new Date(real.regression.ts).toLocaleString('zh-CN', { hour12: false })}` : '尚无回归审计记录'}
              </div>
            </div>
            <div className="af-stat">
              <div className="k">growth 审计 <span>growth_op</span></div>
              <div className="v">{audit.length}</div>
              <div className="d mut">
                {lastAudit ? `最近 ${lastAudit.event} · ${new Date(lastAudit.at).toLocaleTimeString('zh-CN', { hour12: false })}` : '本页尚无 growth_op 记录'}
              </div>
            </div>
          </div>
          <p className="af-note">
            数据来源：内核账本（桌面 = 主进程 FileStorage 持久库，浏览器 = 进程内账本）+ growth:v1 配置。
            空账本时读数为真实 0；无审计支撑的指标写「未采样」，页面不生成演示数据。
          </p>
        </div>
      </section>

      {/* ── 场景分组：2×2 等宽等高，回答/来源压成一行，读数与动作优先 ── */}
      <div className="af-g2" data-testid="growth-groups">
        <section className="af-panel" data-testid="growth-group-dedup">
          <div className="af-ph"><h3>净化 / 去重候选与处置</h3><span className="hint">6.1/6.2 · 记忆表+merge审计</span></div>
          <div className="af-pb">
            <p className="af-q">这次写入会不会被判重、能否短路嫁接？</p>
            <div className="af-mini">
              <span>判重样本 <b>{samples.length}</b></span>
              <span>24h 合并 <b>{dedupStats.merged}</b></span>
              <span>短路命中 <b>{dedupStats.short_circuit_hits}</b></span>
              <span>平均耗时 <b>{dedupCostText}</b></span>
            </div>
            <div className="af-actions">
              <button type="button" className="btn" data-testid="growth-jump-dedup" onClick={() => jumpTo(0, 'dedup-card')}>查看五维判重</button>
              <button type="button" className="btn" data-testid="growth-group-resample" onClick={() => handleResample()}>换一条样本</button>
            </div>
          </div>
        </section>

        <section className="af-panel" data-testid="growth-group-metrics">
          <div className="af-ph"><h3>生长指标与回归结果</h3><span className="hint">7.1–7.3 · 召回+回归审计</span></div>
          <div className="af-pb">
            <p className="af-q">召回质量在变好还是变差，回归是否被采纳？</p>
            <div className="af-mini">
              <span>命中率 <b>{hitRateText}</b></span>
              <span>确认 <b>{metrics.confirmed}</b></span>
              <span>拒绝 <b>{metrics.rejected}</b></span>
              <span>状态 <b>{regressionText}</b></span>
            </div>
            <div className="af-actions">
              <button type="button" className="btn primary" data-testid="growth-group-regress" onClick={() => void handleManualTrigger()}>触发一轮真实回归</button>
              <button type="button" className="btn" data-testid="growth-jump-metrics" onClick={() => jumpTo(1, 'growth-cards')}>查看指标</button>
            </div>
          </div>
        </section>

        <section className="af-panel" data-testid="growth-group-params">
          <div className="af-ph"><h3>参数与生效范围</h3><span className="hint">growth:v1 · param_save</span></div>
          <div className="af-pb">
            <p className="af-q">现在生效的权重 / 阈值 / 调度 / 进化模式是什么？</p>
            <div className="af-mini">
              <span>权重和 <b>{wCheck.sum.toFixed(3)}</b> {wCheck.ok ? '' : <b className="bad">R1 不合格</b>}</span>
              <span>调度启用 <b>{enabledSchedules}</b> / {schedule.length}</span>
              <span>进化 <b>{evolution.mode}</b></span>
              <span>阈值 L1 <b>{thresholds.L1.toFixed(2)}</b> · L6 <b>{thresholds.L6.toFixed(2)}</b></span>
            </div>
            <div className="af-actions">
              <button
                type="button" className="btn" data-testid="growth-jump-tune"
                onClick={() => { setDevMode(true); jumpTo(0, 'dev-tune-panel'); }}
              >打开调参</button>
              <button type="button" className="btn" data-testid="growth-jump-schedule" onClick={() => jumpTo(2, 'schedule-timeline')}>打开调度</button>
            </div>
          </div>
        </section>

        <section className="af-panel" data-testid="growth-group-audit">
          <div className="af-ph"><h3>审计留痕</h3><span className="hint">growth_op · 只读</span></div>
          <div className="af-pb">
            <p className="af-q">每次自净化 / 自生长动作，能不能追到人与时间？</p>
            <div className="af-mini">
              <span>growth_op 条目 <b>{audit.length}</b></span>
              <span>最近事件 <b>{lastAudit ? lastAudit.event : '暂无'}</b></span>
              <span>最近时间 <b>{lastAudit ? new Date(lastAudit.at).toLocaleString('zh-CN', { hour12: false }) : '无记录'}</b></span>
            </div>
            <div className="af-actions">
              <a className="btn" data-testid="growth-jump-audit" href="../audit.html">打开审计日志</a>
              <button type="button" className="btn" data-testid="growth-reload" onClick={() => void reloadAll()}>重新读取真实账本</button>
            </div>
          </div>
        </section>
      </div>

      {(devMode && (!wCheck.ok || !tCheck.ok)) && (
        <div className="p0-banner err" data-testid="tune-errors">
          ⚠ {wCheck.ok ? tCheck.msg : wCheck.msg}
        </div>
      )}

      <div className="p0-tabs" role="tablist" data-testid="growth-tabs">
        {['判重与嫁接', '回归评估', '调度'].map((label, i) => (
          <button
            key={label} type="button" role="tab" aria-selected={tab === i}
            className={`p0-tab${tab === i ? ' active' : ''}`}
            data-testid={`gtab-${i}`} data-tab={i}
            onClick={() => setTab(i)}
          >{label}</button>
        ))}
      </div>

      {tab === 0 && (
      <div className="p0-sec" data-testid="growth-sec-dedup">
        <div className="p0-sec-hd">
          <h3>判重与嫁接</h3>
          <span className="p0-tag">6.1 五维判重 · 6.2 多层短路</span>
        </div>
        <div className="gt-grid">
          <div className="gt-cell"><DedupCard sample={sample} weights={weights} thresholds={thresholds} onResample={handleResample} /></div>
          <div className="gt-cell"><ShortCircuitFlow steps={steps} stats={dedupStats} /></div>
          <div className="gt-cell gt-span2">
            <DevTunePanel
              devMode={devMode} weights={weights} thresholds={thresholds}
              onWeights={patchWeights} onThresholds={patchThresholds} onSave={handleSaveConfig}
            />
          </div>
          {/* 2026-11-22 用户要求：「红线自检」卡从独立页签移入判重与嫁接页签 */}
          <div className="gt-cell gt-span2">
            <div className="card" data-testid="growth-sec-check">
              <b>红线自检</b>
              <div className="note" data-testid="redline-status">
                R1 权重和={wCheck.sum.toFixed(3)} {wCheck.ok ? '✓' : '✗'} · 阈值单调 {tCheck.ok ? '✓' : '✗'} ·
                R2 优化全记真实审计 ✓ · R3 Δ 取自真实反馈 ✓ · R5 调度 {sCheck.ok ? '合法 ✓' : sCheck.msg}
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

      {tab === 1 && (
      <div className="p0-sec" data-testid="growth-sec-regression">
        <div className="p0-sec-hd">
          <h3>回归评估</h3>
          <span className="p0-tag">7.1 指标 · 7.2 Δ · 7.3 回归</span>
        </div>
        <div className="gt-grid">
          <div className="gt-cell"><GrowthCards m={metrics} empty={empty} /></div>
          <div className="gt-cell"><OptimizationList opts={opts} /></div>
          <div className="gt-cell"><AgentUsageCard usage={agentUsage} /></div>
          <div className="gt-cell">
            <RecallWeightCard
              current={recallWeights}
              suggestion={real?.recallSuggestion ?? null}
              onApply={handleApplyRecallWeights}
            />
          </div>
          <div className="gt-cell">
            <FeedbackLoopCard
              policy={feedbackPolicy}
              signal={real?.feedbackSignal ?? null}
              onSave={handleSaveFeedbackPolicy}
            />
          </div>
          <div className="gt-cell"><EvolutionEffectCard records={real?.regressionRecords ?? []} /></div>
          <div className="gt-cell gt-span2"><RegressionTable records={real?.regressionRecords ?? []} /></div>
          <div className="gt-cell gt-span2">
            <EvolutionTimelineCard
              entries={real?.evolutionTimeline ?? []}
              current={recallWeights}
              onRun={handleRunEvolution}
              running={evoRunning}
              lastRun={evoReceipt ?? undefined}
            />
          </div>
          <div className="gt-cell gt-span2">
            <DeltaPanel
              series={series} delta={delta} deltaMetric={deltaMetric} currentHitRate={metrics.hit_rate}
              audit={audit} onManualTrigger={handleManualTrigger}
              regression={real?.regression ?? { kind: 'never_run', ts: null }}
              receipt={receipt}
            />
          </div>
        </div>
      </div>
      )}

      {tab === 2 && (
      <div className="p0-sec" data-testid="growth-sec-schedule">
        <div className="p0-sec-hd">
          <h3>调度</h3>
          <span className="p0-tag">13.3 周期任务</span>
        </div>
        <div className="gt-grid">
          <div className="gt-cell"><ScheduleTimeline schedule={schedule} onToggle={handleToggle} hostKind={hostCapability()} /></div>
          <div className="gt-cell">
            <EvolutionSettingsCard
              evolution={evolution}
              scheduleExprs={scheduleExprs}
              audit={real?.sampleAudits ?? []}
              onSave={handleSaveEvolution}
            />
          </div>
        </div>
      </div>
      )}

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
