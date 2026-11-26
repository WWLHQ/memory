// M0-5：自生长进化设置卡 —— 频率可改（周期/时间）+ 参数可配 + 可行性预测。
// 让用户在「调度」页签内一站式调控进化节奏，并能感知当前配置是否足够触发进化。
import { useEffect, useState } from 'react';
import type { AuditRecord } from '../../core/memagent/types.ts';
import {
  EVOLUTION_MODES, SCHEDULE_KEYS, SCHEDULE_TASKS,
  type EvolutionConfig, type EvolutionMode, type ScheduleExprCheck, type ScheduleExprs, type ScheduleKey,
  validateScheduleExpr, resolveScheduleExpr,
} from '../../shared/growthConfig.ts';
import { nextDue } from '../../shared/cron.ts';

const SAMPLE_ACTIONS = new Set(['insufficient_samples', 'weight_regression', 'weight_tuned']);
const TZ_OFFSET_MIN = 480;

/** 下拉选项出中文（2026-11-14：UI 不上屏 off/suggest/auto 这类枚举值） */
const MODE_LABEL: Record<EvolutionMode, string> = {
  off: '关闭（不运行）',
  suggest: '只出建议（不自动改配置）',
  auto: '自动采纳（过门槛与护栏才写）',
};

function modeHint(m: EvolutionMode): string {
  // M5-2：off 现在连手动触发也零审计（与 M3-8「off 零审计」同口径），文案必须同步，否则页面撒谎
  if (m === 'off') return '关闭：进化轮与回诊都不运行，手动触发也不产记录';
  if (m === 'auto') return '自动：达门槛且过护栏才自动采纳参数；不达标保持原配置';
  return '建议：只产建议、不自动落地（默认，与改造前一致）';
}

function fmtLocal(ts: number | null): string {
  if (ts == null) return '不可达';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

interface NumFieldProps {
  testid: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}

function NumField({ testid, label, value, min, max, step, onChange }: NumFieldProps) {
  return (
    <label className="row" style={{ gap: 6, alignItems: 'center' }}>
      <span>{label}</span>
      <input
        data-testid={testid} type="number" value={value} min={min} max={max} step={step ?? 1}
        onChange={(e) => {
          if (e.target.value === '') return;
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </label>
  );
}

/** 可行性预测：用真实判重审计时间戳算窗口内样本/负例缺口 + 线性外推预计天数（诚实，不依赖新埋点） */
function feasibility(
  audit: AuditRecord[], windowDays: number, minTotal: number, minNeg: number,
): { total: number; neg: number; need: number; etaDays: number | null; perDay: number } {
  const now = Date.now();
  const cutoff = now - windowDays * 86400000;
  const rel = audit.filter((a) => SAMPLE_ACTIONS.has(a.action) && a.ts >= cutoff);
  const total = rel.length;
  let neg = 0;
  let earliest = now;
  for (const a of rel) {
    // 与 useGrowthReal.countsOf 一致：insufficient_samples 把 counts 摊平到 detail 顶层，
    // 其余（not_adopted / adopted）在 detail.counts 内。两处都读，避免漏算负例。
    const d = a.detail as Record<string, unknown> | undefined;
    const c = d?.counts as { negatives?: unknown } | undefined;
    const nTop = typeof d?.negatives === 'number' ? d.negatives : undefined;
    const nInner = typeof c?.negatives === 'number' ? c.negatives : undefined;
    const n = nTop ?? nInner;
    if (typeof n === 'number') neg += n;
    if (a.ts < earliest) earliest = a.ts;
  }
  const days = Math.max(1, (now - earliest) / 86400000);
  const perDay = total / days;
  const need = Math.max(0, Math.max(minTotal - total, minNeg - neg));
  const etaDays = perDay > 0 ? Math.ceil(need / perDay) : null;
  return { total, neg, need, etaDays, perDay };
}

export function EvolutionSettingsCard({
  evolution, scheduleExprs, audit, onSave,
}: {
  evolution: EvolutionConfig;
  scheduleExprs: ScheduleExprs;
  audit: AuditRecord[];
  onSave: (evolution: EvolutionConfig, exprs: ScheduleExprs) => void;
}) {
  const [draftE, setDraftE] = useState<EvolutionConfig>(evolution);
  const [draftX, setDraftX] = useState<ScheduleExprs>(scheduleExprs);
  const [saved, setSaved] = useState<string | null>(null);

  // props 重载（保存后 GrowthPage setEvolution/setScheduleExprs）时同步草稿，避免显示与实际不符
  useEffect(() => { setDraftE(evolution); setDraftX(scheduleExprs); }, [evolution, scheduleExprs]);

  const exprChecks = SCHEDULE_KEYS.reduce((acc, k) => {
    acc[k] = validateScheduleExpr(k, draftX[k]);
    return acc;
  }, {} as Record<ScheduleKey, ScheduleExprCheck>);
  const exprAllOk = SCHEDULE_KEYS.every((k) => exprChecks[k].ok);

  const f = feasibility(audit, draftE.window.dedup_days, draftE.min_samples.dedup_total, draftE.min_samples.dedup_negatives);

  const patchE = (p: Partial<EvolutionConfig>) => { setDraftE((d) => ({ ...d, ...p })); setSaved(null); };
  const patchWin = (p: Partial<EvolutionConfig['window']>) => { setDraftE((d) => ({ ...d, window: { ...d.window, ...p } })); setSaved(null); };
  const patchRollback = (p: Partial<EvolutionConfig['rollback']>) => { setDraftE((d) => ({ ...d, rollback: { ...d.rollback, ...p } })); setSaved(null); };
  const patchGuard = (p: Partial<EvolutionConfig['guard']>) => { setDraftE((d) => ({ ...d, guard: { ...d.guard, ...p } })); setSaved(null); };
  const patchMin = (p: Partial<EvolutionConfig['min_samples']>) => { setDraftE((d) => ({ ...d, min_samples: { ...d.min_samples, ...p } })); setSaved(null); };
  const patchExpr = (k: ScheduleKey, v: string) => { setDraftX((x) => ({ ...x, [k]: v })); setSaved(null); };

  const doSave = () => { if (!exprAllOk) return; onSave(draftE, draftX); setSaved('已保存'); };

  return (
    <div className="card" data-testid="evolution-settings-card">
      <b>自生长进化设置（M0 · 可感知 / 可调控）</b>
      <div className="note">
        频率与参数均可在此调整；mode 默认 suggest = 与改造前逐字一致（读取期召回权重只产建议、不自动落地），
        auto 需显式开启才会自动采纳参数。
      </div>

      <div className="row" style={{ marginTop: 8, gap: 12, alignItems: 'center' }}>
        <label>进化总闸</label>
        <select data-testid="evolution-mode" value={draftE.mode} onChange={(e) => patchE({ mode: e.target.value as EvolutionMode })}>
          {EVOLUTION_MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
        </select>
        <span className="dim" data-testid="evolution-mode-hint">{modeHint(draftE.mode)}</span>
      </div>

      <div style={{ marginTop: 12 }}>
        <b>调度频率（可改）</b>
        {SCHEDULE_TASKS.map((t) => {
          const check = exprChecks[t.key];
          const next = nextDue(resolveScheduleExpr(t.key, draftX), Date.now(), TZ_OFFSET_MIN);
          return (
            <div key={t.key} className="row" style={{ gap: 8, marginTop: 6, alignItems: 'center' }}>
              <label style={{ width: 190 }}>{t.label}{t.required ? '（必跑）' : ''}</label>
              <input
                data-testid={`expr-input-${t.key}`} value={draftX[t.key]}
                onChange={(e) => patchExpr(t.key, e.target.value)}
                style={{ width: 130, borderColor: check.ok ? undefined : 'var(--danger,#ff5d5d)' }}
              />
              <span data-testid={`expr-check-${t.key}`} className={check.ok ? 'dim' : 'err'}>
                {check.ok ? `下次约 ${fmtLocal(next)}` : check.reason}
              </span>
            </div>
          );
        })}
      </div>

      <div className="row" style={{ marginTop: 12, gap: 16, flexWrap: 'wrap' }}>
        <NumField testid="window-dedup-days" label="判重窗口(天)" value={draftE.window.dedup_days} min={1} max={180} onChange={(v) => patchWin({ dedup_days: v })} />
        <NumField testid="window-recall-days" label="召回窗口(天)" value={draftE.window.recall_days} min={1} max={90} onChange={(v) => patchWin({ recall_days: v })} />
        <NumField testid="window-dispatch-days" label="分流窗口(天)" value={draftE.window.dispatch_days} min={1} max={365} onChange={(v) => patchWin({ dispatch_days: v })} />
        <NumField testid="sample-top-n" label="采样条数" value={draftE.sample_top_n} min={10} max={50} onChange={(v) => patchE({ sample_top_n: v })} />
      </div>

      <div className="row" style={{ marginTop: 8, gap: 16, flexWrap: 'wrap' }}>
        <NumField testid="rollback-after-days" label="回滚天数" value={draftE.rollback.after_days} min={1} max={90} onChange={(v) => patchRollback({ after_days: v })} />
        <NumField testid="rollback-min-recalls" label="回滚最少召回" value={draftE.rollback.min_recalls} min={0} max={10000} onChange={(v) => patchRollback({ min_recalls: v })} />
        <NumField testid="rollback-max-drop" label="回滚跌破" value={draftE.rollback.max_drop} min={0.01} max={0.20} step={0.01} onChange={(v) => patchRollback({ max_drop: v })} />
      </div>

      <details className="row" style={{ marginTop: 8 }} data-testid="evolution-advanced">
        <summary>高级（最小样本 / 护栏）</summary>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
          <NumField testid="min-dedup-total" label="最小样本(总)" value={draftE.min_samples.dedup_total} min={1} max={10000} onChange={(v) => patchMin({ dedup_total: v })} />
          <NumField testid="min-dedup-neg" label="最小负例" value={draftE.min_samples.dedup_negatives} min={1} max={10000} onChange={(v) => patchMin({ dedup_negatives: v })} />
          <NumField testid="min-recall-count" label="最小召回次数" value={draftE.min_samples.recall_count} min={1} max={10000} onChange={(v) => patchMin({ recall_count: v })} />
          <NumField testid="min-recall-tagged" label="最小带标签" value={draftE.min_samples.recall_tagged} min={1} max={10000} onChange={(v) => patchMin({ recall_tagged: v })} />
          <NumField testid="min-dispatch-tagged" label="分流最小标注" value={draftE.min_samples.dispatch_tagged} min={1} max={100} onChange={(v) => patchMin({ dispatch_tagged: v })} />
          <NumField testid="rollback-dispatch-max-drop" label="分流回诊跌幅" value={draftE.rollback.mode_dispatch_max_drop} min={0.05} max={0.30} step={0.01} onChange={(v) => patchRollback({ mode_dispatch_max_drop: v })} />
          <NumField testid="guard-cooldown" label="冷却(天)" value={draftE.guard.cooldown_days} min={1} max={90} onChange={(v) => patchGuard({ cooldown_days: v })} />
          <NumField testid="guard-max-step" label="最大步长" value={draftE.guard.max_step} min={0.01} max={0.20} step={0.01} onChange={(v) => patchGuard({ max_step: v })} />
          <NumField testid="guard-max-drift" label="最大漂移" value={draftE.guard.max_drift} min={0.05} max={0.50} step={0.01} onChange={(v) => patchGuard({ max_drift: v })} />
        </div>
      </details>

      <div className="note" data-testid="feasibility" style={{ marginTop: 10 }}>
        {f.need === 0
          ? `可行性：窗口内已采 ${f.total} 条 / 负例 ${f.neg}，已达最小样本（总 ${draftE.min_samples.dedup_total} / 负例 ${draftE.min_samples.dedup_negatives}），下次评估即可进化。`
          : `可行性：窗口内 ${f.total} 条 / 负例 ${f.neg}，距最小样本还差约 ${f.need} 条${f.etaDays !== null ? `（按历史日均 ${f.perDay.toFixed(1)} 条，预计还需约 ${f.etaDays} 天）` : '（历史无增速数据，无法预测天数）'}。`}
      </div>

      <div className="row" style={{ marginTop: 10, gap: 12, alignItems: 'center' }}>
        <button className="btn" data-testid="evolution-save" disabled={!exprAllOk} onClick={doSave}>保存进化设置</button>
        {saved && <span className="dim" data-testid="evolution-saved">{saved}</span>}
      </div>
    </div>
  );
}
