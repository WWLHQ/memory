// REQ-012 T3 查询栏（§1）：query/scene/mode + 校验 + 联动
import { useMemo } from 'react';
import type { ModeSel, Scene } from './types.ts';
import { modeName, resolveModeLinkage, resolveSceneBudget, sceneName, validateQuery } from './logic.ts';

export interface QueryBarValue {
  query: string;
  scene: Scene;
  mode: ModeSel;
}

interface Props {
  value: QueryBarValue;
  onChange: (v: QueryBarValue, toast: string | null) => void;
  onSubmit: () => void;
  loading: boolean;
  disabled?: boolean;
}

const SCENES: Scene[] = ['default', 'task_start', 'history_query', 'critical'];
const ALL_MODES: NonNullable<ModeSel>[] = ['top_insight', 'fact_first', 'event_replay', 'pattern_reasoning', 'minimal'];

export function QueryBar({ value, onChange, onSubmit, loading, disabled }: Props) {
  const { error, minimalHint } = useMemo(() => validateQuery(value.query), [value.query]);
  const table = resolveSceneBudget(value.scene);
  const critical = value.scene === 'critical';

  const setScene = (scene: Scene) => {
    const { mode, toast } = resolveModeLinkage(scene, value.mode);
    onChange({ ...value, scene, mode }, toast);
  };
  const setMode = (mode: ModeSel) => {
    const r = resolveModeLinkage(value.scene, mode);
    onChange({ ...value, mode: r.mode }, r.toast);
  };

  return (
    <div className="card" data-testid="query-bar">
      <div className="row">
        <input
          data-testid="q-input"
          value={value.query}
          placeholder="输入查询内容…"
          style={{ flex: 1, minWidth: 260, background: 'var(--panel2)', color: 'var(--txt)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px' }}
          onChange={(e) => onChange({ ...value, query: e.target.value }, null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !error && !loading && !disabled) onSubmit();
          }}
        />
        <button
          type="button" className="btn primary" data-testid="q-submit"
          disabled={!value.query.trim() || !!error || loading || disabled}
          onClick={onSubmit}
        >检索</button>
      </div>

      <div className="row">
        <label style={{ fontSize: 12 }}>场景</label>
        <select data-testid="q-scene" value={value.scene} onChange={(e) => setScene(e.target.value as Scene)}>
          {SCENES.map((s) => <option key={s} value={s}>{sceneName(s)}（预算 {resolveSceneBudget(s).budget}t）</option>)}
        </select>

        <label style={{ fontSize: 12 }}>模式</label>
        <select data-testid="q-mode" value={value.mode ?? ''} onChange={(e) => setMode(e.target.value === '' ? null : (e.target.value as NonNullable<ModeSel>))}>
          <option value="">自动</option>
          {ALL_MODES.map((m) => (
            <option key={m} value={m} disabled={!table.modes.includes(m)} title={!table.modes.includes(m) ? '合规场景禁用极简（16.5）' : undefined}>
              {modeName(m)}
            </option>
          ))}
        </select>

        {minimalHint && !critical && <span className="status hibernating" data-testid="minimal-hint">短查询 · 将触发极简</span>}
        {critical && <span className="status deprecated" data-testid="rerank-chip">重排：强制开（R5）</span>}
      </div>

      <div className="row">
        <span className="dim" data-testid="ctx-note">
          session：自动继承（只读，R1）· 回灌深度 {table.backfillDepth} · 预算 {table.budget}t
        </span>
      </div>
      {error && value.query.length > 0 && <div className="note" data-testid="q-err">{error}</div>}
    </div>
  );
}
