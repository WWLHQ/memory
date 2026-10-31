// REQ-003 T1 交付物：Agent 接入页领域类型 / 数据契约（单一事实来源的"类型基线"）
// TS 内核（规格 T1 原定 `npx tsc --noEmit`）——由 tsconfig.json 的 strict 门禁执行，
// 不再依赖运行时的 assertShape 兜底。
//
// ⚠ 严格对齐 design/ui/Agent接入页_原型.html：UiAgentCard 与原型 AGENTS 元素同构，
// UI 层禁止自创字段名，偏离原型须用户显式批准。

/* ============ 枚举（对应原型 badge/label 与状态点） ============ */
export const AgentStatus = {
  ONBOARD: 'ONBOARD',
  CONFIGURED: 'CONFIGURED',
  CONNECTED: 'CONNECTED',
  DEGRADED: 'DEGRADED',
} as const;
export type AgentStatus = (typeof AgentStatus)[keyof typeof AgentStatus];

export const PriorityBadge = {
  P0: 'MVP·P0', // deepseek harness
  P1: 'MVP·P1', // Claude Code
  P2: '兜底·P2', // Codex
  P3: '扩展·P3', // Cursor
} as const;
export type Priority = keyof typeof PriorityBadge;
export type BadgeClass = 'p0' | 'p1' | 'p2' | 'p3';

export const CircuitState = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
} as const;
export type CircuitState = (typeof CircuitState)[keyof typeof CircuitState];

export type Form = 'desktop' | 'web' | 'mobile' | 'mac' | 'linux' | 'cli';

/* ============ 服务层卡片（specs/tasks/AGENT-ONBOARD.md T1 类型） ============ */
export interface RecallMemoryTool {
  project_id: string;
  scene?: string | null;
  mode?: string | null;
  top_k?: number;
}
export interface WriteMemoryTool {
  project_id: string;
  category?: string;
}
export interface UserPreferencesTool {
  user_id: string;
}
export interface McpTools {
  recall_memory?: RecallMemoryTool;
  write_memory?: WriteMemoryTool;
  get_user_preferences?: UserPreferencesTool;
}
export interface Channels {
  webhook: boolean;
  apiPull: boolean;
}
export interface OneClickFlags {
  enabled: boolean;
  defaultReadOnly: boolean;
  p2Write: boolean;
  p2Confirm: boolean;
  bindRevocable: boolean;
}
export interface DiscoverFlags {
  enabled: boolean;
  crossMachine: boolean;
}

/** 接入卡片（服务/校验/后端交换结构，对应规格 §0/§1/§3/§4） */
export interface AgentCard {
  agent_name: string;
  priority: Priority;
  status: AgentStatus;
  circuit: CircuitState;
  /** R1：是否手填租户（禁） */
  tenantManual?: boolean;
  enterprise_id?: string;
  team_id?: string;
  accessMode?: string;
  mcpTools?: McpTools;
  channels?: Channels;
  /** R5：明文密钥字段仅允许为 null；轮换生成的明文只在当次响应顶层一次性返回，绝不入库/回显 */
  apiKeyPlaintext?: string | null;
  /** 密钥 SHA-256（服务端保存，用于校验；界面与 GET /agents 不下发明文） */
  keyHash?: string;
  /** 密钥尾 4 位（审计与界面展示用） */
  keyTail?: string;
  keyRotatedAt?: number;
  keyGraceUntil?: number;
  keyRevoked?: boolean;
  requestId?: string | null;
  tested?: boolean;
  /** 最近一次真实拨测结果：失败原因如实落盘，UI 不得回退成「已连通」 */
  lastTest?: { ok: boolean; reason: string; at: number; durationMs?: number };
  oneClick?: OneClickFlags;
  discover?: DiscoverFlags;
  form?: Form;
}

/**
 * 递归 DeepPartial：嵌套对象同样视为不可信。
 * 注意用NonNullable —— 可选属性的 T[K] 含 undefined，会让 `extends object` 判断落空而停止递归。
 */
export type DeepPartial<T> = {
  [K in keyof T]?: NonNullable<T[K]> extends object ? DeepPartial<NonNullable<T[K]>> : T[K];
};

/**
 * 校验器的入参形状：**不可信输入**。
 * 校验器存在的意义就是接收"可能缺字段/类型不对"的候选卡片并报出violations，
 * 因此这里对所有字段（含嵌套）做 DeepPartial，而非复用合法的 AgentCard。
 */
export type AgentCardCandidate = DeepPartial<AgentCard>;

/**
 * configure 的入参：status 由服务层在校验通过后自行落定（CONFIGURED），
 * 故调用方不需（也不应）预设状态。
 */
export type AgentCardInput = Omit<AgentCard, 'status'> & { status?: AgentStatus };

/* ============ 原型 UI 形状（严格对齐 Agent接入页_原型.html 的 AGENTS） ============ */

/** 原型用 `pref:false` 表示"该工具未启用"（布尔），其余为对象 —— 这是刻意与规格不同的原型事实，勿"修正"。 */
export type ToolToggle = { on: boolean };
export type ToolToggleOrFalse = ToolToggle | false;

export interface UiRecallTool extends ToolToggle {
  topk: number;
  scene: string;
  mode: string;
}
export interface UiIso {
  projShare: boolean;
  prefCross: boolean;
}
export interface UiChan {
  webhook: boolean;
  api: boolean;
  recon: string;
}
export interface UiKey {
  mask: string;
  last: string;
  grace: number;
  /** 轮换后置true：脱敏值后缀「（新）」（对齐原型 act('rotate') 行为） */
  rotated?: boolean;
}
/** 原型 state：连通 / 降级（仅补偿）/ 未配置 */
export type UiState = 'connected' | 'degraded' | 'onboard';

/** 卡片真实统计（来自接入后端审计 GET /audit + 本地测速 RTT；无数据时字段缺省 → UI 显「—」） */
export interface AgentRealStats {
  /** 连通尝试累计次数（test + auto_bind） */
  tests: number;
  /** 通过（status=CONNECTED / result=pass）次数 */
  passed: number;
  lastTestAt?: number;
  lastRotateAt?: number;
  /** 最近一次连通尝试的真实耗时（ms） */
  lastRtt?: number;
  /** 历史连通尝试的平均真实耗时（ms；无样本 → 缺省） */
  avgRtt?: number;
}

export interface UiAgentCard {
  name: string;
  badge: BadgeClass;
  label: string;
  method: string;
  conn: number;
  circuit: string;
  latency: number;
  fail: number;
  recover: number;
  tenant: string;
  tools: {
    recall: UiRecallTool;
    write: ToolToggle;
    pref: ToolToggleOrFalse;
  };
  iso: UiIso;
  chan: UiChan;
  key: UiKey;
  state: UiState;
}

/** 本机已安装 Agent（主进程五路安装痕迹：CLI/安装目录 exe/开始菜单/配置/注册表卸载项） */
export interface InstalledAgent {
  agent: string;
  via: 'cli' | 'app' | 'startmenu' | 'config' | 'uninstall';
  source: string;
  version?: string;
  badge: BadgeClass;
  label: string;
}

/** 一键接入发现结果（对齐原型 DISCOVERED） */
export interface DiscoveredAgent {
  name: string;
  badge: BadgeClass;
  label: string;
  signal: string;
  bound: boolean;
  ok: boolean;
  /** 数据来源：host=宿主真扫 / kernel=内核模拟降级 */
  source?: 'host' | 'kernel';
}

/** 效果证据（对齐原型 GAINS） */
export interface Gain {
  icon: string;
  title: string;
  big: string;
  desc: string;
  src: string;
}

/* ============ 契约常量（保留运行时可见，供测试与校验复用） ============ */
export const AgentCardShape = Object.freeze({
  required: ['agent_name', 'priority', 'status', 'circuit'] as const,
  enums: {
    status: Object.values(AgentStatus),
    priority: Object.keys(PriorityBadge),
    circuit: Object.values(CircuitState),
  },
  // 租户 ID 仅全局注入，前端禁手填（R1）
  tenantInjectedOnly: ['enterprise_id', 'team_id'] as const,
});

export const McpToolConfigShape = Object.freeze({
  tools: ['recall_memory', 'write_memory', 'get_user_preferences'] as const,
  recall_memory: { required: ['project_id'], optional: ['scene', 'mode', 'top_k'] },
  write_memory: { required: ['project_id'], optional: ['category'] },
  get_user_preferences: { required: ['user_id'] },
});

export const ChannelConfigShape = Object.freeze({
  required: ['webhook', 'apiPull'] as const,
  idempotent: 'SHA-256', // 不可关（R4/R5）
});

export const KeyMgmtShape = Object.freeze({
  desensitize: true, // 恒 [API_KEY:service]，不回显明文
  rotateGraceHours: 24, // 可配 0–72h
});

/**
 * 轻量运行时结构断言。TS 已提供编译期保证，这里保留给「运行时来源不可信」的边界
 * （如HTTP 入参、JSON 持久化文件）做二次兜底。
 */
export function assertShape(card: AgentCardCandidate = {}): { ok: boolean; violations: string[] } {
  const v: string[] = [];
  for (const k of AgentCardShape.required) {
    if (!(k in card)) v.push(`missing ${k}`);
  }
  if (card.status && !AgentCardShape.enums.status.includes(card.status)) v.push(`bad status ${card.status}`);
  if (card.priority && !AgentCardShape.enums.priority.includes(card.priority)) v.push(`bad priority ${card.priority}`);
  if (card.circuit && !AgentCardShape.enums.circuit.includes(card.circuit)) v.push(`bad circuit ${card.circuit}`);
  if (card.mcpTools?.recall_memory && !card.mcpTools.recall_memory.project_id) v.push('recall_memory.project_id 必填(R2)');
  if (card.mcpTools?.write_memory && !card.mcpTools.write_memory.project_id) v.push('write_memory.project_id 必填(R2)');
  return { ok: v.length === 0, violations: v };
}