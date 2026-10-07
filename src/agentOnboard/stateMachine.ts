// Agent 接入卡片状态机 (REQ-003 §0 页面状态 / T2)
// 纯函数、无依赖，便于单测与在任意端（桌面/Web/CLI）复用。
//
// 状态流转（规格 §0）：
//   ONBOARD(未配置) --CONFIGURE(填密钥+选通道)--> CONFIGURED(已配置)
//   CONFIGURED --TEST_PASS(测试通过)--> CONNECTED(连通)
//   CONFIGURED --TEST_FAIL(测试失败)--> DEGRADED(降级，仅补偿通道可用)
//   任意态 --CIRCUIT_OPEN(主通道熔断 OPEN)--> DEGRADED（R5/R6：自动降级不丢数据）
//   DEGRADED --CIRCUIT_CLOSE(熔断恢复)--> CONNECTED

import { AgentStatus } from '../types/agentOnboard.ts';

export { AgentStatus };

/** 卡片可触发的事件 */
export type CardEvent =
  | 'CONFIGURE'
  | 'TEST_PASS'
  | 'TEST_FAIL'
  | 'CIRCUIT_OPEN'
  | 'CIRCUIT_HALF_OPEN'
  | 'CIRCUIT_CLOSE';

type TransitionTable = Partial<Record<AgentStatus, Partial<Record<CardEvent, AgentStatus>>>>;

/**
 * 状态转移表（对应规格 §0 状态图；表驱动，便于扩展与审阅）。
 * 键=当前态，值={事件: 下一态}；未列出的事件→保持原态（幂等安全）。
 */
export const TRANSITIONS: TransitionTable = Object.freeze({
  ONBOARD: { CONFIGURE: 'CONFIGURED' },
  CONFIGURED: {
    TEST_PASS: 'CONNECTED',
    TEST_FAIL: 'DEGRADED', // 测试失败→降级（仅补偿通道）
    CIRCUIT_HALF_OPEN: 'DEGRADED',
  },
  DEGRADED: {
    CIRCUIT_CLOSE: 'CONNECTED', // 熔断恢复→连通
    TEST_PASS: 'CONNECTED',
    TEST_FAIL: 'DEGRADED',
    CIRCUIT_HALF_OPEN: 'DEGRADED',
    CONFIGURE: 'CONFIGURED',
  },
});

/**
 * 计算一次事件后的卡片状态。
 * @param status 当前状态
 * @param event 事件名
 * @returns 新状态（未知事件原样返回，幂等安全）
 */
export function transition(status: AgentStatus, event: CardEvent): AgentStatus {
  // 规格 §0：主通道熔断 OPEN 时，无论当前态一律强制降级（R5/R6 自动降级不丢数据）。
  if (event === 'CIRCUIT_OPEN') return AgentStatus.DEGRADED;
  const next = TRANSITIONS[status]?.[event];
  return next ?? status; // 未定义事件：保持现状（不抛错，前端可忽略脏事件）
}