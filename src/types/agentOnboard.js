// REQ-003 T1 交付物：Agent 接入页领域类型 / 数据契约（单一事实来源的"类型基线"）
// 纯 ESM、零依赖。validators / service / render 隐式使用的形状在此集中定义，供全模块复用。
// 验收（零依赖、可跑）：`node --test src/types/__tests__/types.test.js`
//
// 设计说明：任务原稿 T1 写的是 `npx tsc --noEmit`（TS）。本项目务实采用纯 ESM JS +
// Node 内置 node:test，故用 assertShape 做轻量运行时结构校验替代 tsc，保持零依赖可跑通。

export const AgentStatus = Object.freeze({
  ONBOARD: 'ONBOARD',
  CONFIGURED: 'CONFIGURED',
  CONNECTED: 'CONNECTED',
  DEGRADED: 'DEGRADED',
});

export const PriorityBadge = Object.freeze({
  P0: 'MVP·P0', // deepseek harness / workbuddy
  P1: 'MVP·P1', // Claude Code
  P2: '兜底·P2', // Codex
  P3: '扩展·P3',
});

export const CircuitState = Object.freeze({
  CLOSED: 'CLOSED',
  OPEN: 'OPEN', // 严重：连续失败≥5，停主通道
  HALF_OPEN: 'HALF_OPEN',
});

// 卡片字段契约（对应规格 §1 卡片头；§0 状态；§7 R1 租户只读）
export const AgentCardShape = Object.freeze({
  required: ['agent_name', 'priority', 'status', 'circuit'],
  enums: {
    status: Object.values(AgentStatus),
    priority: Object.keys(PriorityBadge),
    circuit: Object.values(CircuitState),
  },
  // 租户 ID 仅全局注入，前端禁手填（R1）
  tenantInjectedOnly: ['enterprise_id', 'team_id'],
});

// MCP 工具配置契约（§3 / R2 project_id 必填）
export const McpToolConfigShape = Object.freeze({
  tools: ['recall_memory', 'write_memory', 'get_user_preferences'],
  recall_memory: { required: ['project_id'], optional: ['scene', 'mode', 'top_k'] },
  write_memory: { required: ['project_id'], optional: ['category'] },
  get_user_preferences: { required: ['user_id'] },
});

// 采集通道契约（§3 / R4 双通道至少开一）
export const ChannelConfigShape = Object.freeze({
  required: ['webhook', 'apiPull'],
  idempotent: 'SHA-256', // 不可关（R4/R5）
});

// 密钥管理契约（§4 / R5 脱敏 / R6 轮换宽限）
export const KeyMgmtShape = Object.freeze({
  desensitize: true, // 恒 [API_KEY:service]，不回显明文
  rotateGraceHours: 24, // 可配 0–72h
});

/**
 * 轻量运行时结构断言（零依赖验收，替代 tsc）。
 * @param {object} card
 * @returns {{ ok: boolean, violations: string[] }}
 */
export function assertShape(card = {}) {
  const v = [];
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
