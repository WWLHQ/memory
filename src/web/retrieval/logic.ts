// 检索页（REQ-012）纯逻辑层
// 全部为纯函数，便于单测覆盖（T2）。规格：§1.1/1.2 scene·mode 联动、§2.4.4 自动分流、§3 排序、
// §3.1 decay、§5/R9 预算三档、§7 校验、§8 红线。
import type { BudgetLevel, DecayClass, Mode, ModeSel, RetrievalHit, Scene, SceneBudget } from './types.ts';

const MODE_NAMES: Record<Mode, string> = {
  top_insight: '顶层洞察',
  fact_first: '事实优先',
  event_replay: '事件复盘',
  pattern_reasoning: '模式推理',
  minimal: '极简轻量',
};

export function modeName(m: Mode): string {
  return MODE_NAMES[m];
}

/** scene 中文 */
export function sceneName(s: Scene): string {
  return { default: '默认', task_start: '任务启动', history_query: '历史查询', critical: '合规关键' }[s];
}

/** §1.1 scene 联动表（2.4.1 场景化预算 + 2.4.4 候选集） */
const SCENE_TABLE: Record<Scene, SceneBudget> = {
  default: { budget: 800, defaultMode: 'minimal', backfillDepth: 'L3+L4', rerank: false, modes: ['top_insight', 'fact_first', 'event_replay', 'pattern_reasoning', 'minimal'] },
  task_start: { budget: 1200, defaultMode: 'top_insight', backfillDepth: '项目记忆+L5×1', rerank: false, modes: ['top_insight', 'fact_first', 'event_replay', 'pattern_reasoning', 'minimal'] },
  history_query: { budget: 2000, defaultMode: 'event_replay', backfillDepth: '允许L2占位', rerank: 'auto', modes: ['top_insight', 'fact_first', 'event_replay', 'pattern_reasoning', 'minimal'] },
  critical: { budget: 2500, defaultMode: 'fact_first', backfillDepth: 'L2+校验', rerank: true, modes: ['top_insight', 'fact_first', 'event_replay', 'pattern_reasoning'] },
};

/** scene 枚举回落（§7.3）：非法值 → default */
export function normalizeScene(s: string): Scene {
  return (s in SCENE_TABLE ? s : 'default') as Scene;
}

/** mode 枚举回落（§7.4）：非法值 → null（自动） */
export function normalizeMode(m: string): ModeSel {
  return (m in MODE_NAMES ? m : null) as ModeSel;
}

/** §1.1 scene 预算表 */
export function resolveSceneBudget(scene: Scene): SceneBudget {
  return SCENE_TABLE[scene];
}

/**
 * §1.2/§7.5 mode 联动：
 * - critical + minimal → 强制回落 null（自动）+ 标记 toast（16.5/2.4.4 约束5）
 * - mode 不在当前 scene 候选 → 回落为 scene 默认模式 + 标记 toast
 */
export function resolveModeLinkage(scene: Scene, mode: ModeSel): { mode: ModeSel; toast: string | null } {
  const table = SCENE_TABLE[scene];
  if (mode === 'minimal' && !table.modes.includes('minimal')) {
    return { mode: null, toast: '合规场景禁用极简（16.5），已切回自动分流' };
  }
  if (mode !== null && !table.modes.includes(mode)) {
    return { mode: table.defaultMode, toast: `mode 已按场景调整（${sceneName(scene)} 不支持该模式）` };
  }
  return { mode, toast: null };
}

/** §7.2 语言长度：中文去标点 <30 字 / 英文 <12 词 → 极简候选信号 */
export function isMinimalCandidate(query: string): boolean {
  const q = query.trim();
  const zhChars = q.replace(/[，。！？、；：""''（）\s]/g, '').length;
  const hasCJK = /[\u4e00-\u9fff]/.test(q);
  if (hasCJK) return zhChars < 30;
  return q.split(/\s+/).filter(Boolean).length < 12;
}

/** §2.4.4 自动分流：极简信号 + 关键词命中 → mode + hit_keywords */
export function autoDispatch(query: string, scene: Scene): { mode: Mode; hit_keywords: string[] } {
  const table = SCENE_TABLE[scene];
  const KEYWORDS: { kw: string[]; mode: Mode; label: string }[] = [
    { kw: ['故障', '核对', '报错', '发布', 'p0'], mode: 'fact_first', label: 'fact' },
    { kw: ['复盘', '回顾', '昨天', '上周', '历史'], mode: 'event_replay', label: 'event' },
    { kw: ['总结', '要点', '洞察'], mode: 'top_insight', label: 'insight' },
    { kw: ['规律', '模式', '为什么'], mode: 'pattern_reasoning', label: 'pattern' },
  ];
  const low = query.toLowerCase();
  const hit_keywords: string[] = [];
  let mode: Mode | null = null;
  for (const k of KEYWORDS) {
    const hit = k.kw.filter((w) => low.includes(w));
    if (hit.length >= 2 || (hit.length >= 1 && scene === 'critical')) {
      if (!mode) mode = k.mode;
      hit_keywords.push(k.label);
    }
  }
  // 候选过滤（2.4.4：scene 候选集内裁决；critical 禁极简）
  if (mode && !table.modes.includes(mode)) mode = null;
  if (!mode && isMinimalCandidate(query)) mode = table.modes.includes('minimal') ? 'minimal' : table.defaultMode;
  if (!mode) mode = table.defaultMode;
  return { mode, hit_keywords };
}

/** §3 排序：pinned 置顶（R3）→ score 降序 → confidence 次级降序 */
export function sortHits(hits: RetrievalHit[]): RetrievalHit[] {
  return [...hits].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    return b.confidence - a.confidence;
  });
}

/** §3.1/17.5 freshness = 0.5^(age/half_life)，下限 0.05 */
export function freshness(ageDays: number, halfLifeDays: number): number {
  const hl = Math.max(1, halfLifeDays);
  return Math.max(0.05, Math.pow(0.5, ageDays / hl));
}

/** 15.3 温度徽标（与生命周期页口径一致：hot≥0.5 / warm≥0.2） */
export function decayClass(ageDays: number, halfLifeDays: number): DecayClass {
  const f = freshness(ageDays, halfLifeDays);
  if (f >= 0.5) return 'hot';
  if (f >= 0.2) return 'warm';
  return 'cold';
}

/** R9 预算三档：≤1500 ok / ≤2000 trim / ≤3000 warn / >3000 breach（硬熔断） */
export function budgetLevel(payload: number): BudgetLevel {
  if (payload <= 1500) return 'ok';
  if (payload <= 2000) return 'trim';
  if (payload <= 3000) return 'warn';
  return 'breach';
}

/** §7.1 query 校验：trim 非空 + 极简提示信号（不阻止提交） */
export function validateQuery(query: string): { error: string | null; minimalHint: boolean } {
  const q = query.trim();
  if (!q) return { error: '查询内容不能为空', minimalHint: false };
  return { error: null, minimalHint: isMinimalCandidate(q) };
}
