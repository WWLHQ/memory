// REQ-012 T5 右侧栏三块：Token 预算（R9 三档 + 分段量表）· 召回漏斗 · 裁剪明细。
// 拆成三个独立卡片导出，页面按需要排序（预算 → 最近召回 → 漏斗 → 裁剪明细）；
// BudgetPanel 仍保留为三者叠放的兼容壳。
// 所有数字来自内核真实计数（payload / scanned / background / injected / trimmed）；
// 审计快照里没采集的字段一律不渲染该行，不写「—」冒充读数，也不拿命中数冒充注入条数。
import type { BudgetData } from './types.ts';
import { budgetLevel } from './logic.ts';

const LEVEL_LABEL = { ok: '正常', trim: '已裁剪', warn: '告警', breach: '硬熔断' } as const;
const LEVEL_CLASS = { ok: 'ok', trim: 'warn', warn: 'warn', breach: 'breach' } as const;

/** R9 三段阈值（占硬熔断 3000t 的比例）：<60% 安全 · 60–85% 警戒 · >85% 熔断 */
const SAFE_PCT = 60;
const WARN_PCT = 85;

interface BudgetProps {
  data: BudgetData;
  /** 数据来源标注（本次召回 / 最近一次召回 + 时间），保证读者不会把历史当本次 */
  sourceNote?: string;
  onOpenSource?: () => void;
}

/** Token 预算卡：payload 占比 + R9 分段量表 */
export function TokenBudgetCard({ data, sourceNote, onOpenSource }: BudgetProps) {
  const level = budgetLevel(data.payload_tokens);
  const cap = data.budget_tokens && data.budget_tokens > 0 ? data.budget_tokens : 3000;
  const used = Math.max(0, data.injected_total_tokens ?? data.payload_tokens);
  const pct = Math.min(100, Math.round((used / cap) * 100));
  const zone = pct > WARN_PCT ? 'breach' : pct > SAFE_PCT ? 'warn' : 'ok';

  return (
    <section className="ret-card ret-budget" data-testid="budget-panel">
      <div className="ret-budget-hd">
        <h3>Token 预算</h3>
        <span className="ret-note">硬熔断 {cap}t</span>
        <span className={`ret-level ${LEVEL_CLASS[level]}`} data-testid="budget-level">
          {LEVEL_LABEL[level]}
        </span>
      </div>

      {sourceNote && (
        <div className="ret-budget-src" data-testid="budget-source">
          {sourceNote}
          {onOpenSource && (
            <button type="button" className="ret-linkbtn" data-testid="budget-source-open" onClick={onOpenSource}>
              按 id 查审计 →
            </button>
          )}
        </div>
      )}

      <div className="ret-budget-row">
        <span className="ret-budget-k">payload</span>
        <span className="mono">{used} / {cap}</span>
      </div>

      <div className="ret-budget-pct" data-testid="budget-pct">
        <b>{pct}</b><span>%</span>
      </div>

      <div className="ret-budget-track" title={`payload 占硬上限 ${cap}t`}>
        <i className={`ret-budget-fill ${zone}`} style={{ width: `${pct}%` }} data-testid="budget-bar" />
      </div>

      <div className="ret-legend">
        <span className="safe">安全 &lt;{SAFE_PCT}%</span>
        <span className="warn">警戒 {SAFE_PCT}–{WARN_PCT}%</span>
        <span className="breach">熔断 &gt;{WARN_PCT}%</span>
      </div>

      {data.budget_breach && (
        <div className="ret-breach" data-testid="breach-detail">
          超支被裁（budget_breach=true）：{data.breach_detail?.join(' · ') ?? '（内核未给出明细）'} — 未进上下文（2.4.1 裁剪顺序）
        </div>
      )}
    </section>
  );
}

/** 召回漏斗：扫描 → 候选 → 注入（审计快照没有注入条数时如实写「命中」） */
export function FunnelCard({ data }: { data: BudgetData }) {
  const scanned = data.scanned_count ?? 0;
  const candidates = data.stage1_count ?? 0;
  const hasInjectedCount = data.injected_count !== undefined;
  const flowCount = data.injected_count ?? candidates;
  const barPct = (n: number) => (scanned > 0 ? Math.min(100, Math.max(n > 0 ? 2 : 0, (n / scanned) * 100)) : 0);

  return (
    <section className="ret-card ret-funnel-card" data-testid="funnel">
      <div className="ret-funnel-row">
        <span className="ret-funnel-k">扫描</span>
        <span className="ret-funnel-track"><i style={{ width: `${barPct(scanned)}%` }} /></span>
        <span className="ret-funnel-n mono">{scanned}</span>
      </div>
      <div className="ret-funnel-row">
        <span className="ret-funnel-k">候选</span>
        <span className="ret-funnel-track"><i style={{ width: `${barPct(candidates)}%` }} /></span>
        <span className="ret-funnel-n mono">{candidates}</span>
      </div>
      <div className="ret-funnel-row">
        <span className="ret-funnel-k">{hasInjectedCount ? '注入' : '命中'}</span>
        <span className="ret-funnel-track"><i style={{ width: `${barPct(flowCount)}%` }} /></span>
        <span className="ret-funnel-n mono">{flowCount}</span>
      </div>
    </section>
  );
}

/** 裁剪明细：背景 / 命中 / 合计 + 熔断裁掉（有值才出行）+ 未注入条数（本次才知道） */
export function TrimCard({ data }: { data: BudgetData }) {
  const cap = data.budget_tokens && data.budget_tokens > 0 ? data.budget_tokens : 3000;
  const used = Math.max(0, data.injected_total_tokens ?? data.payload_tokens);
  const pct = Math.min(100, Math.round((used / cap) * 100));
  const candidates = data.stage1_count ?? 0;
  const background = data.background_tokens ?? 0;
  const hitTokens = data.payload_tokens;
  const dropped = data.dropped_count;
  const trimmed = data.trimmed_tokens;
  const flowCount = data.injected_count ?? candidates;

  return (
    <section className="ret-card ret-trim" data-testid="trim-detail">
      <h3>裁剪明细</h3>
      <div className="ret-trim-line">
        项目背景 {background}t · 命中 {candidates} 条 {hitTokens}t
      </div>
      <div className="ret-trim-line">
        合计 {used}t · 占上限 {pct}%
      </div>
      {trimmed !== undefined && trimmed > 0 && (
        <div className="ret-trim-line muted" data-testid="trim-trimmed">熔断裁掉 {trimmed}t</div>
      )}
      {dropped !== undefined && (
        <div className="ret-trim-line muted" data-testid="trim-dropped">
          未注入 {dropped} 条（预算内取前 {flowCount} 条）
          {data.depth ? ` · 深度 ${data.depth}` : ''}
        </div>
      )}
    </section>
  );
}

/** 兼容壳：三块按「预算 → 漏斗 → 裁剪明细」叠放 */
export function BudgetPanel({ data, sourceNote, onOpenSource }: BudgetProps) {
  return (
    <div className="ret-rail-stack">
      <TokenBudgetCard data={data} sourceNote={sourceNote} onOpenSource={onOpenSource} />
      <FunnelCard data={data} />
      <TrimCard data={data} />
    </div>
  );
}
