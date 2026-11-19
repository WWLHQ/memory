// REQ-012 T3 查询条（定稿）：查询行「输入 + 场景 + 项目 + 检索」+ 模式行（胶囊）+ 预算/深度紧凑项。
// 联动校验不变：scene=critical 禁极简（16.5）、短查询极简提示、session 只读（R1）。
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
  /** 模式胶囊清单：自动（null）+ 五个具体模式；场景禁用的置灰并带 16.5 说明 */
  const pills: { id: ModeSel; label: string; disabled: boolean }[] = [
    { id: null, label: '自动', disabled: false },
    ...ALL_MODES.map((m) => ({ id: m as ModeSel, label: modeName(m), disabled: !table.modes.includes(m) })),
  ];

  return (
    <div className="ret-query" data-testid="query-bar">
      <div className="ret-qrow">
        <input
          className="ret-in ret-q-in"
          data-testid="q-input"
          value={value.query}
          placeholder="输入要检索的内容…"
          onChange={(e) => onChange({ ...value, query: e.target.value }, null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !error && !loading && !disabled) onSubmit();
          }}
        />

        <label className="ret-pick" title="场景决定预算 / 回灌深度 / 重排强度">
          <span>场景:</span>
          <select
            data-testid="q-scene"
            value={value.scene}
            onChange={(e) => setScene(e.target.value as Scene)}
          >
            {SCENES.map((s) => <option key={s} value={s}>{sceneName(s)}（{resolveSceneBudget(s).budget}t）</option>)}
          </select>
        </label>

        <label className="ret-pick">
          <span>项目:</span>
          <select
            data-testid="q-project"
            value={value.project ?? 'all'}
            onChange={(e) => onChange({ ...value, project: e.target.value }, null)}
          >
            <option value="all">全部项目</option>
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>

        <button
          type="button"
          className="ret-btn primary ret-go"
          data-testid="q-submit"
          disabled={!value.query.trim() || !!error || loading || disabled}
          onClick={onSubmit}
        >
          {loading ? '检索中' : '检索'}
        </button>
      </div>

      <div className="ret-modes">
        <span className="ret-modes-k">模式:</span>
        {pills.map((p) => {
          const active = (value.mode ?? null) === p.id;
          return (
            <button
              type="button"
              key={p.id ?? 'auto'}
              data-testid={p.id ? `mode-${p.id}` : 'mode-auto'}
              className={`ret-pill${active ? ' active' : ''}`}
              disabled={p.disabled}
              title={p.disabled ? '合规场景禁用极简（16.5）' : undefined}
              onClick={() => setMode(p.id)}
            >
              {p.label}
            </button>
          );
        })}

        {critical && <span className="ret-tag warn" data-testid="rerank-chip">重排：强制开（R5）</span>}
        {minimalHint && !critical && <span className="ret-tag info" data-testid="minimal-hint">短查询 · 将触发极简</span>}

        <span className="ret-modes-right">
          <label className="ret-mini">
            预算
            <input
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
            />
            ×1000t
          </label>
          <label className="ret-mini">
            深度
            <select
              data-testid="q-depth"
              value={depth}
              onChange={(e) => onChange({ ...value, depth: e.target.value }, null)}
            >
              {DEPTH_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <span className="ret-note" data-testid="ctx-note">session 自动继承（只读）· 回灌 {table.backfillDepth}</span>
        </span>
      </div>

      {error && value.query.length > 0 && <div className="ret-err" data-testid="q-err">{error}</div>}
    </div>
  );
}
