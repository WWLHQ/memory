// REQ-012 T3 查询条（定稿 6 项）：查询 / 场景 / 项目 / 模式 / 预算 / 注入深度 + 联动校验
import { useMemo } from 'react';
import type { ModeSel, Scene } from './types.ts';
import { modeName, resolveModeLinkage, resolveSceneBudget, sceneName, validateQuery } from './logic.ts';

export interface QueryBarValue {
  query: string;
  scene: Scene;
  mode: ModeSel;
  /** 检索项目范围；缺省 = 全部项目（A26） */
  project?: string;
  /** 预算（× 1000 tokens）；缺省按场景预算向上取整 */
  budget?: number;
  /** 注入深度（展示口径；注入纪律始终只 L1） */
  depth?: string;
}

interface Props {
  value: QueryBarValue;
  /** 账本真实项目清单（不含内部 P_SYSTEM）；空账本只有「全部项目」 */
  projects?: string[];
  onChange: (v: QueryBarValue, toast: string | null) => void;
  onSubmit: () => void;
  loading: boolean;
  disabled?: boolean;
}

const SCENES: Scene[] = ['default', 'task_start', 'history_query', 'critical'];
const ALL_MODES: NonNullable<ModeSel>[] = ['top_insight', 'fact_first', 'event_replay', 'pattern_reasoning', 'minimal'];
export const DEPTH_OPTIONS = ['L1', 'L1–L3', 'L1–L6'] as const;

export function QueryBar({ value, projects = [], onChange, onSubmit, loading, disabled }: Props) {
  const { error, minimalHint } = useMemo(() => validateQuery(value.query), [value.query]);
  const table = resolveSceneBudget(value.scene);
  const critical = value.scene === 'critical';
  const budgetK = value.budget ?? Math.ceil(table.budget / 1000);
  const depth = value.depth ?? 'L1';

  const setScene = (scene: Scene) => {
    const { mode, toast } = resolveModeLinkage(scene, value.mode);
    // 切场景时预算回到该场景内核预算（千 token 向上取整）；用户仍可在预算输入里改
    onChange({ ...value, scene, mode, budget: Math.ceil(resolveSceneBudget(scene).budget / 1000) }, toast);
  };
  const setMode = (mode: ModeSel) => {
    const r = resolveModeLinkage(value.scene, mode);
    onChange({ ...value, mode: r.mode }, r.toast);
  };

  return (
    <div className="p0-card" data-testid="query-bar">
      <div className="p0-hd">
        <h3>检索查询</h3>
        <span className="p0-sub">查询条六项 · scene/mode 分流（2.4.4）</span>
      </div>

      <div className="p0-form">
        <div className="p0-frow p0-fcol">
          <label>查询</label>
          <input
            className="p0-in"
            data-testid="q-input"
            value={value.query}
            placeholder="输入查询内容…"
            onChange={(e) => onChange({ ...value, query: e.target.value }, null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !error && !loading && !disabled) onSubmit();
            }}
          />
          <button
            type="button"
            className="p0-btn primary"
            data-testid="q-submit"
            disabled={!value.query.trim() || !!error || loading || disabled}
            onClick={onSubmit}
          >
            检索
          </button>
        </div>

        <div className="p0-frow">
          <label>场景</label>
          <select
            className="p0-in"
            data-testid="q-scene"
            value={value.scene}
            onChange={(e) => setScene(e.target.value as Scene)}
          >
            {SCENES.map((s) => <option key={s} value={s}>{sceneName(s)}（预算 {resolveSceneBudget(s).budget}t）</option>)}
          </select>
        </div>

        <div className="p0-frow">
          <label>项目</label>
          <select
            className="p0-in"
            data-testid="q-project"
            value={value.project ?? 'all'}
            onChange={(e) => onChange({ ...value, project: e.target.value }, null)}
          >
            <option value="all">全部项目</option>
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div className="p0-frow">
          <label>模式</label>
          <select
            className="p0-in"
            data-testid="q-mode"
            value={value.mode ?? ''}
            onChange={(e) => setMode(e.target.value === '' ? null : (e.target.value as NonNullable<ModeSel>))}
          >
            <option value="">自动</option>
            {ALL_MODES.map((m) => (
              <option key={m} value={m} disabled={!table.modes.includes(m)} title={!table.modes.includes(m) ? '合规场景禁用极简（16.5）' : undefined}>
                {modeName(m)}
              </option>
            ))}
          </select>
        </div>

        <div className="p0-frow">
          <label>预算</label>
          <input
            className="p0-in"
            type="number"
            min={1}
            max={64}
            step={1}
            data-testid="q-budget"
            value={budgetK}
            onChange={(e) => {
              const n = Math.max(1, Math.min(64, Math.floor(Number(e.target.value) || 1)));
              onChange({ ...value, budget: n }, null);
            }}
            style={{ maxWidth: 90 }}
          />
          <span className="p0-note">× 1000 tokens（R9 硬熔断 3000t 由内核另判）</span>
        </div>

        <div className="p0-frow">
          <label>深度</label>
          <select
            className="p0-in"
            data-testid="q-depth"
            value={depth}
            onChange={(e) => onChange({ ...value, depth: e.target.value }, null)}
          >
            {DEPTH_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <span className="p0-note">展示深度；注入纪律只 L1</span>
        </div>
      </div>

      <div className="p0-note" data-testid="ctx-note">
        session：自动继承（只读，R1）· 回灌深度 {table.backfillDepth} · 场景预算 {table.budget}t
        {minimalHint && !critical && <span className="p0-tag info" data-testid="minimal-hint" style={{ marginLeft: 6 }}>短查询 · 将触发极简</span>}
        {critical && <span className="p0-tag warn" data-testid="rerank-chip" style={{ marginLeft: 6 }}>重排：强制开（R5）</span>}
      </div>
      {error && value.query.length > 0 && <div className="p0-note err" data-testid="q-err">{error}</div>}
    </div>
  );
}
