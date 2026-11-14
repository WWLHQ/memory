// recallModes.ts — 召回模式调度层（§2.4.3 模式定义 + §2.4.4 自动分流，直译单一真源）
//
// 设计要点（见 specs/召回模式设计与实现方案.md）：
//   顶层开关只有两个——「自动」与「手动」：
//     · 自动（auto / null）：由本模块按 scene × 关键词 自动分配 5 种模式之一；
//     · 手动：调用方显式指定 5 种具体模式之一（顶层洞察/事实优先/事件复盘/模式推理/极简），
//            未指定具体模式视为非法（边界校验在 API 边界做，本模块只认 concrete mode）。
//
// 本模块职责：
//   1) 模式配置表（权重向量 / 选取优先级 / 裁剪顺序 / 冲突规则 / 会话预加载）；
//   2) resolveMode()：按「自动/手动」解析出生效模式 + 次模式 + 命中词。
// 不读存储、不调 LLM，纯函数，便于单测与 7.2 自生长引擎热更词表。

import type { RecallMode, Scene } from './types.ts';

/** 权重分量（§2.4.3 元组 (w_f, w_i, w_c, w_a)）：f=新鲜度(freshness) i=重要性(importance) c=可信度(confidence) a=召回热度(access_boost) */
export interface ModeWeights { f: number; i: number; c: number; a: number; }

export type LayerKey = 'L2' | 'L3' | 'L4' | 'L5';

/** 5 种具体模式（不含 auto / null） */
export type ConcreteMode = Exclude<RecallMode, null | 'auto'>;

export interface RecallModeSpec {
  id: ConcreteMode;
  /** 中文名 */
  name: string;
  /** 选取优先级（高→低）；裁剪/组装时先取高排位层 */
  selectPriority: LayerKey[];
  /** 裁剪删除顺序（先删→后删） */
  trimOrder: LayerKey[];
  /** 会话初始化预加载层；null = 无 */
  preload: LayerKey | null;
  /** 核心冲突规则（人话，模式内高排位层约束低排位层） */
  conflictRule: string;
  /** 权重向量（和=1） */
  weights: ModeWeights;
  /** 最佳适用场景 */
  bestFor: string;
  /** 禁用的叙事层（极简禁 L2/L5） */
  disabledLayers: LayerKey[];
  /** 是否极简（不含 cold/archived/dormant 背景、无次模式降级） */
  isMinimal: boolean;
}

/** §2.4.3 五模式表（权威定义，单一真源） */
export const RECALL_MODE_SPECS: Record<ConcreteMode, RecallModeSpec> = {
  top_insight: {
    id: 'top_insight', name: '顶层洞察优先',
    selectPriority: ['L5', 'L4', 'L3', 'L2'],
    trimOrder: ['L2', 'L3', 'L4', 'L5'],
    preload: 'L5',
    conflictRule: '顶层原则约束下层事实：高排位层（L5/L4）的结论不可被低层个案推翻，除非低层证据明确标注「本场景例外」。',
    weights: { f: 0.20, i: 0.40, c: 0.10, a: 0.30 },
    bestFor: '架构设计、项目长期规划、制定规范',
    disabledLayers: [], isMinimal: false,
  },
  fact_first: {
    id: 'fact_first', name: '事实优先',
    selectPriority: ['L3', 'L4', 'L2', 'L5'],
    trimOrder: ['L5', 'L2', 'L4', 'L3'],
    preload: null,
    conflictRule: 'L3 真实事实优先：模式/洞察不得推翻已核实的事实；事实证据不足时方可降格引用 L4/L5 作参考，并显式标注「待核实」。',
    weights: { f: 0.10, i: 0.20, c: 0.40, a: 0.30 },
    bestFor: '调试排错、历史问题复盘、核对历史记录',
    disabledLayers: [], isMinimal: false,
  },
  event_replay: {
    id: 'event_replay', name: '事件复盘',
    selectPriority: ['L2', 'L3', 'L4', 'L5'],
    trimOrder: ['L5', 'L4', 'L3', 'L2'],
    preload: null,
    conflictRule: '事件时序上下文优先：以 L2 事件原貌为骨架，L3/L4 作为「当时为什么」的注脚，不得为归纳而裁剪时序细节。',
    weights: { f: 0.40, i: 0.15, c: 0.15, a: 0.30 },
    bestFor: '完整会话还原、bug 复现、回顾一整套操作流程',
    disabledLayers: [], isMinimal: false,
  },
  pattern_reasoning: {
    id: 'pattern_reasoning', name: '模式推理',
    selectPriority: ['L4', 'L3', 'L2', 'L5'],
    trimOrder: ['L5', 'L2', 'L3', 'L4'],
    preload: null,
    conflictRule: '通用模式优先：L4 跨事件规律作骨架，L3 个案作为「模式下的特例」并列呈现，不得用高 trust 的 L4 压过 L3 反例。',
    weights: { f: 0.15, i: 0.25, c: 0.10, a: 0.40 },
    bestFor: '同类问题批量处理、标准化流程、举一反三预判问题',
    disabledLayers: [], isMinimal: false,
  },
  minimal: {
    id: 'minimal', name: '极简轻量',
    selectPriority: ['L3', 'L4'],
    trimOrder: ['L4', 'L3'],
    preload: null,
    conflictRule: '仅事实+模式：禁用 L2 事件摘要与 L5 顶层洞察，不做次模式降级注入；低 token、低幻觉。',
    weights: { f: 0.10, i: 0.20, c: 0.35, a: 0.35 },
    bestFor: '高频短查询、小代码修改，追求低 token、低幻觉',
    disabledLayers: ['L2', 'L5'], isMinimal: true,
  },
};

/** §2.4.2 公共不变基础规则（所有模式共用，模式不得覆盖；模式只定义「变」的部分） */
export const COMMON_INVARIANTS: string[] = [
  'L0/L1 一律禁止进入在线召回上下文（加密原始层不解密、不回灌、不进 prompt）。',
  'dormant 默认不召回；仅用户显式「找回」或单项相关性 ≥0.9 放行（唤醒，15.3）。',
  'token 超限按当前模式裁剪顺序从最低价值层级逐条裁剪（层级内按分数降序，先删最低分）。',
  '冲突仲裁按当前模式的核心冲突规则执行；「高优先级层级」指该模式内排位更高的层。',
  'critical scene 禁用极简（16.5 硬规则）；合规/资金场景最低召回深度 L3+L4+L2 占位符。',
];

// ---------- §2.4.4 自动分流（仅「自动」开关走这里） ----------

export interface ModeDispatchConfig {
  /** 中文短查询阈值（含 CJK < 此值视为短） */
  minLenZh: number;
  /** 英文短查询阈值（词数 < 此值视为短） */
  minLenEn: number;
  /** 特征词命中阈值（≥ 此值算命中该模式） */
  hitThreshold: number;
}

export const DEFAULT_DISPATCH_CONFIG: ModeDispatchConfig = { minLenZh: 30, minLenEn: 12, hitThreshold: 2 };

interface FeatureWords {
  /** 普通特征词：命中数 ≥ hitThreshold 算命中该模式 */
  words: string[];
  /** 高置信单字词：命中 1 即算命中（计 hitThreshold 分） */
  highConf: string[];
}

/** 模式特征词表（YAML 可热更新，7.2 自生长引擎可自动补词；此处为直译基线） */
export const MODE_FEATURE_WORDS: Record<ConcreteMode, FeatureWords> = {
  top_insight: { words: ['架构', '规范', '原则', '顶层设计', '长期规划', '选型', '纲领', '红线'], highConf: [] },
  fact_first: { words: ['报错', '堆栈', '日志', '核对', '验证', '是否', '对不对', '实际值', 'trace', 'exception'], highConf: ['事故', '故障'] },
  event_replay: { words: ['复现', '重现', '回顾', '流程梳理', '时间线', '从头', '经过', '步骤还原'], highConf: ['复盘'] },
  pattern_reasoning: { words: ['同类', '批量', '通用', '举一反三', '套路', '规律', '模板', '范式'], highConf: ['归纳'] },
  minimal: { words: [], highConf: [] },
};

/** 每个 scene 的候选模式 + 零命中默认模式 + 是否允许极简（极简只能由短查询触发） */
const SCENE_PLAN: Record<Scene, { candidates: ConcreteMode[]; default: ConcreteMode; allowMinimal: boolean }> = {
  // A10：default 原先只有 [minimal, fact_first]，另外 3 套模式的词表在缺省场景永远选不出来。
  // 扩到 5 套后由「命中分数 + MODE_PRECEDENCE」裁决，零命中/短查询的极简兜底逻辑不变。
  default:         { candidates: ['top_insight', 'pattern_reasoning', 'event_replay', 'fact_first', 'minimal'], default: 'minimal', allowMinimal: true },
  task_start:      { candidates: ['top_insight', 'pattern_reasoning', 'fact_first'], default: 'top_insight', allowMinimal: true },
  history_query:   { candidates: ['event_replay', 'fact_first'], default: 'event_replay', allowMinimal: false },
  critical:        { candidates: ['pattern_reasoning', 'top_insight', 'fact_first'], default: 'fact_first', allowMinimal: false },
};

/**
 * A10：scene 归一化的内核唯一真源（Web 侧 logic.normalizeScene 是另一层的输入回落，不参与内核裁决）。
 * 非法/空值一律回落 default；`undefined` 是合法缺省，不算非法。
 * agent.ts 与 resolveMode 共用它，避免 API 边界与纯函数各写一套判定。
 */
export function normalizeScene(s: unknown): { scene: Scene; invalid: boolean } {
  if (s === undefined || (typeof s === 'string' && Object.prototype.hasOwnProperty.call(SCENE_PLAN, s))) {
    return { scene: (s ?? 'default') as Scene, invalid: false };
  }
  return { scene: 'default', invalid: true };
}

/** 候选集内多模式命中时的优先级（数值大者胜，用于裁决次模式与同分） */
const MODE_PRECEDENCE: Record<ConcreteMode, number> = {
  top_insight: 4, fact_first: 3, event_replay: 2, pattern_reasoning: 1, minimal: 0,
};

export interface ResolveModeInput {
  query: string;
  scene?: Scene;
  /**
   * 顶层开关结果：
   *   - 'auto' / null / 缺省 → 走自动分流（Agent 自动分配）；
   *   - 5 种 ConcreteMode 之一 → 手动模式（用户/宿主显式指定，强制采用，不做自动分流）。
   */
  explicitMode?: RecallMode;
  config?: ModeDispatchConfig;
}

export interface ResolvedMode {
  /** 生效模式（ConcreteMode，不含 auto/null） */
  mode: ConcreteMode;
  /** 次模式（降级注入用）；极简恒为 undefined */
  secondary?: ConcreteMode;
  /** 自动分流命中的特征词（审计 action=mode_dispatch 的 hit_keywords） */
  hitKeywords: string[];
  /** 分流依据（人话，供审计 reason 与 UI 透明展示） */
  reason: string;
  /** 是否走了兜底（解析失败/无候选） */
  viaFallback?: boolean;
}

interface QueryLen { cjk: number; latinWords: number; isShort: boolean; }

/**
 * 短查询判定（§2.4.4「中文<30字 / 英文<12词」按语言分别判定）：
 *   · 纯中文且 CJK < minLenZh → 短；
 *   · 纯英文且词数 < minLenEn → 短；
 *   · 中英混排（含拉丁词）→ 视为真实问题，**不触发极简**（避免 dev 场景里的 bug/API 等长尾词误判极简）。
 * 这是规格书长度规则与「零命中→极简」落点的保守取舍：混排问题一律走 scene 默认模式。
 */
function measureQuery(query: string, cfg: ModeDispatchConfig): QueryLen {
  const cjk = (query.match(/[一-鿿]/g) ?? []).length;
  const latinWords = (query.match(/[A-Za-z]+/g) ?? []).length;
  let isShort = false;
  if (cjk > 0 && latinWords === 0) isShort = cjk < cfg.minLenZh;
  else if (latinWords > 0 && cjk === 0) isShort = latinWords < cfg.minLenEn;
  return { cjk, latinWords, isShort };
}

function scoreMode(mode: ConcreteMode, query: string, cfg: ModeDispatchConfig): { score: number; hits: string[] } {
  const fw = MODE_FEATURE_WORDS[mode];
  // A10：英文日志类查询（Exception / TRACE）原先因大小写不匹配全部漏命中。
  // 词表本身是小写基线，统一把 query 与特征词都归一化到小写再比较；中文不受影响。
  const q = query.toLowerCase();
  const hits: string[] = [];
  let score = 0;
  for (const w of fw.words) {
    if (q.includes(w.toLowerCase())) { score += 1; hits.push(w); }
  }
  for (const w of fw.highConf) {
    if (q.includes(w.toLowerCase())) { score += cfg.hitThreshold; hits.push(w); } // 高置信单字：命中 1 即算命中（计满阈值分）
  }
  return { score, hits };
}

/** 判断显式模式是否为「手动」具体模式（而非 auto/null）；只判别「非自动」，不做枚举收窄 */
export function isManualMode(m: RecallMode | undefined): m is ConcreteMode {
  return m !== undefined && m !== null && m !== 'auto';
}

/**
 * 严格枚举校验：是否为 5 个具体模式之一。
 * `isManualMode('manual')` 会返回 true（它只排除 auto/null），但 'manual' 不是合法模式——
 * 拿它去查 RECALL_MODE_SPECS 会拿到 undefined。API 边界必须用本函数，非法值明确报错而不是静默降级。
 */
export function isConcreteMode(m: unknown): m is ConcreteMode {
  return typeof m === 'string' && Object.prototype.hasOwnProperty.call(RECALL_MODE_SPECS, m);
}

/**
 * 解析生效模式（自动/手动 唯一入口）。
 * 规则：手动（concrete mode）> 自动分流；16.5 硬规则 critical 禁极简。
 */
export function resolveMode(input: ResolveModeInput): ResolvedMode {
  const cfg = input.config ?? DEFAULT_DISPATCH_CONFIG;
  // A10：非法 scene（含空串）原先让 SCENE_PLAN[scene] 变成 undefined，抛原生 TypeError。
  // 统一走 normalizeScene 回落 default，并在 reason 里如实标注，不静默吞掉。
  const { scene, invalid: sceneInvalid } = normalizeScene(input.scene);
  const plan = SCENE_PLAN[scene];
  // A10：非法 scene 的回落必须在**所有**返回路径（含零命中/短查询）里如实可见，
  // 因此统一在出口包装，而不是只给手动分支加标注。
  const finish = (r: ResolvedMode): ResolvedMode => ({
    ...r,
    reason: sceneInvalid ? `非法 scene「${String(input.scene)}」已回落 default · ${r.reason}` : r.reason,
    ...(r.viaFallback || sceneInvalid ? { viaFallback: true } : {}),
  });

  // 1) 手动优先（用户指定 > 自动分流）；用严格枚举校验，非法值不当作手动模式
  if (isConcreteMode(input.explicitMode)) {
    const mode = input.explicitMode;
    // 16.5 硬规则：critical 禁极简。降级本身是内核裁决（viaFallback=true），
    // 回显必须据此说明，不能把降级结果写成「用户指定」。
    if (scene === 'critical' && mode === 'minimal') {
      return finish({
        mode: 'fact_first', hitKeywords: [],
        reason: '手动选极简但 critical scene 禁用（16.5 硬规则）→ 降为事实优先',
        viaFallback: true,
      });
    }
    return finish({ mode, hitKeywords: [], reason: `手动指定 ${RECALL_MODE_SPECS[mode].name}` });
  }

  // 2) 自动分流：只在候选集内计分词
  const scored = plan.candidates
    .map((m) => {
      const { score, hits } = scoreMode(m, input.query, cfg);
      return { mode: m, score, hits };
    })
    .filter((s) => s.score >= cfg.hitThreshold);

  const len = measureQuery(input.query, cfg);

  // 极简触发：长度短（纯中文/纯英文；混排不触发）+ 该 scene 允许极简 + 无其他模式命中
  const minimalTriggered = plan.allowMinimal && len.isShort && scored.length === 0;

  if (scored.length === 0) {
    if (minimalTriggered) {
      const unit = len.cjk > 0 ? `${len.cjk} 中文字` : `${len.latinWords} 词`;
      return finish({
        mode: 'minimal',
        hitKeywords: [],
        reason: `自动分流：${scene} 零命中 + 短查询（${unit}）<${cfg.minLenZh}/${cfg.minLenEn} 触发极简`,
      });
    }
    return finish({ mode: plan.default, hitKeywords: [], reason: `自动分流：${scene} 零命中 → 默认 ${RECALL_MODE_SPECS[plan.default].name}` });
  }

  // 取最高分；同分按 MODE_PRECEDENCE（高者胜）
  scored.sort((a, b) => (b.score - a.score) || (MODE_PRECEDENCE[b.mode] - MODE_PRECEDENCE[a.mode]));
  const top = scored[0];
  const runnerUp = scored[1];
  const secondary = runnerUp && !RECALL_MODE_SPECS[top.mode].isMinimal ? runnerUp.mode : undefined;
  return finish({
    mode: top.mode,
    secondary,
    hitKeywords: top.hits,
    reason: `自动分流：${scene} 命中 ${RECALL_MODE_SPECS[top.mode].name}${top.hits.length ? `（${top.hits.join('、')}）` : ''}${secondary ? `，次模式 ${RECALL_MODE_SPECS[secondary].name} 降级注入` : ''}`,
  });
}

/** 取某模式的权重向量（用于 17.8 打分接入，wiring 阶段透传给 scoreMemory） */
export function modeWeights(mode: ConcreteMode): ModeWeights {
  return RECALL_MODE_SPECS[mode].weights;
}

/** 取某模式配置 */
export function modeSpec(mode: ConcreteMode): RecallModeSpec {
  return RECALL_MODE_SPECS[mode];
}
