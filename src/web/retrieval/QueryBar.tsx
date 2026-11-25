// REQ-012 T3 查询条（定稿）：查询行「输入 + 场景 + 项目 + 检索」+ 模式行（§3.1 自动/手动二元分段）
// + 手动选项 / 项目默认 / history_query 倾向预览 + 预算·深度紧凑项。
// 联动校验不变：scene=critical 禁极简（16.5）、短查询极简提示、session 只读（R1）。
// 原型事实源：design/ui/检索页_原型.html §3.1–3.3；现役测试锚点（data-testid）保留。
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Mode, ModeSel, Scene } from './types.ts';
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
const ALL_MODES: Mode[] = ['top_insight', 'fact_first', 'event_replay', 'pattern_reasoning', 'minimal'];
export const DEPTH_OPTIONS = ['L1', 'L1–L3', 'L1–L6'] as const;

export function QueryBar({ value, projects = [], onChange, onSubmit, loading, disabled }: Props) {
  const { error, minimalHint } = useMemo(() => validateQuery(value.query), [value.query]);
  const table = resolveSceneBudget(value.scene);
  const critical = value.scene === 'critical';
  const budgetK = value.budget ?? Math.ceil(table.budget / 1000);
  const depth = value.depth ?? 'L1';

  // §3.3：全局默认恒为自动；项目默认与会话级手动记忆只在本次页面会话内有效（不写内核配置）
  const [projectDefaults, setProjectDefaults] = useState<Record<string, Mode>>({});
  const sessionManual = useRef<Mode | null>(null);
  const projectKey = value.project ?? 'all';
  // §3.1：分段状态独立于 mode——手动档允许「尚未选具体模式」的中间态，点检索时由必填校验拦截。
  // mode=null 只代表最终生效值走自动分流；外部把 mode 改成具体值时同步切到手动档（如「切事实优先重试」）。
  const [seg, setSeg] = useState<'auto' | 'manual'>(value.mode !== null ? 'manual' : 'auto');
  const manual = seg === 'manual';
  useEffect(() => { if (value.mode !== null) setSeg('manual'); }, [value.mode]);
  const pickedDefault = projectDefaults[projectKey];

  const setScene = (scene: Scene) => {
    const { mode, toast } = resolveModeLinkage(scene, value.mode);
    setSeg(mode === null ? 'auto' : 'manual');
    onChange({ ...value, scene, mode, budget: Math.ceil(resolveSceneBudget(scene).budget / 1000) }, toast);
  };
  const setMode = (mode: ModeSel) => {
    if (mode) sessionManual.current = mode;
    const r = resolveModeLinkage(value.scene, mode);
    setSeg(r.mode === null ? 'auto' : 'manual');
    onChange({ ...value, mode: r.mode }, r.toast);
  };
  /** 自动/手动分段切换：手动档优先会话记忆，其次项目默认；都没有则停在手动档等待必填校验 */
  const switchSegment = (next: 'auto' | 'manual') => {
    setSeg(next);
    if (next === 'auto') {
      onChange({ ...value, mode: null }, null);
      return;
    }
    const pick = sessionManual.current ?? pickedDefault ?? null;
    if (!pick) { onChange(value, null); return; }
    const r = resolveModeLinkage(value.scene, pick);
    onChange({ ...value, mode: r.mode }, r.toast);
  };
  const setProjectDefault = () => {
    if (!manual || !value.mode) { onChange(value, '需先在手动档选定具体模式'); return; }
    setProjectDefaults((d) => ({ ...d, [projectKey]: value.mode as Mode }));
    onChange(value, `已设为该项目默认：${modeName(value.mode as Mode)}（全局默认恒为自动）`);
  };
  const resetAuto = () => {
    setProjectDefaults((d) => {
      const next = { ...d };
      delete next[projectKey];
      return next;
    });
    sessionManual.current = null;
    setSeg('auto');
    onChange({ ...value, mode: null }, '已重置为自动（全局默认）');
  };
  /** §3.1 手动档必填校验：点检索时拦截并给出中文提示，不静默用自动档代替 */
  const handleSubmit = () => {
    if (manual && !value.mode) { onChange(value, '手动档需先选定具体模式（§3.1）'); return; }
    if (!value.query.trim()) { onChange(value, '查询内容不能为空'); return; }
    if (error) { onChange(value, error); return; }
    onSubmit();
  };

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
            if (e.key === 'Enter' && !error && !loading && !disabled) handleSubmit();
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
          onClick={handleSubmit}
        >
          {loading ? '检索中' : '检索'}
        </button>
      </div>

      <div className="ret-modes">
        <span className="ret-modes-k">模式:</span>

        <div className="ret-modeseg" role="group" aria-label="模式选择方式">
          <button
            type="button"
            data-testid="mode-auto"
            className={`ret-seg-btn${manual ? '' : ' active'}`}
            onClick={() => switchSegment('auto')}
          >
            自动（默认）
          </button>
          <button
            type="button"
            data-testid="mode-seg-manual"
            className={`ret-seg-btn${manual ? ' active' : ''}`}
            onClick={() => switchSegment('manual')}
          >
            手动
          </button>
        </div>

        {!manual && (
          <span className="ret-modeauto" data-testid="mode-auto-note">由系统按场景与关键词自动判断模式。</span>
        )}

        {/* 手动面板常驻 DOM（自动档 CSS 隐藏），保留既有测试锚点 mode-<m> */}
        <div className={`ret-modepanel${manual ? ' show' : ''}`} data-testid="mode-panel">
          <div className="ret-modeopts">
            {ALL_MODES.map((m) => {
              const disabledMode = !table.modes.includes(m);
              const active = value.mode === m;
              return (
                <button
                  type="button"
                  key={m}
                  data-testid={`mode-${m}`}
                  className={`ret-pill ret-mode-opt${active ? ' active' : ''}`}
                  disabled={disabledMode}
                  title={disabledMode ? '合规场景禁用极简（16.5）' : undefined}
                  onClick={() => setMode(m)}
                >
                  {modeName(m)}
                </button>
              );
            })}
          </div>
          <div className="ret-modepersist">
            <button type="button" className="ret-btn" data-testid="mode-set-default" onClick={setProjectDefault}>设为该项目默认</button>
            <button type="button" className="ret-btn" data-testid="mode-reset-auto" onClick={resetAuto}>重置为自动</button>
            {pickedDefault && <span className="ret-note" data-testid="mode-project-default">项目默认：{modeName(pickedDefault)}</span>}
          </div>
        </div>

        {/* §3.2 history_query 自动档倾向预览：只观测，不冒充已执行 */}
        {!manual && value.scene === 'history_query' && (
          <span className="ret-mode-tendency" data-testid="mode-tendency">
            本次倾向：{modeName(resolveSceneBudget('history_query').defaultMode)}（history_query 自动分流预览）
          </span>
        )}

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
