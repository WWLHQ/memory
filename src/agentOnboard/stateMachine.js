// Agent 接入卡片状态机 (REQ-003 §0 页面状态 / T2)
// 纯函数、零依赖，便于单测与在任意端（桌面/Web/CLI）复用。
//
// 状态流转（规格 §0）：
//   ONBOARD(未配置) --CONFIGURE(填密钥+选通道)--> CONFIGURED(已配置)
//   CONFIGURED --TEST_PASS(测试通过)--> CONNECTED(连通)
//   CONFIGURED --TEST_FAIL(测试失败)--> DEGRADED(降级，仅补偿通道可用)
//   任意态 --CIRCUIT_OPEN(主通道熔断 OPEN)--> DEGRADED（R5/R6：自动降级不丢数据）
//   DEGRADED --CIRCUIT_CLOSE(熔断恢复)--> CONNECTED

export const AgentStatus = Object.freeze({
  ONBOARD: 'ONBOARD',
  CONFIGURED: 'CONFIGURED',
  CONNECTED: 'CONNECTED',
  DEGRADED: 'DEGRADED',
});

/**
 * 计算一次事件后的卡片状态。
 * @param {string} status 当前状态（AgentStatus 之一）
 * @param {string} event 事件名：CONFIGURE | TEST_PASS | TEST_FAIL | CIRCUIT_OPEN | CIRCUIT_HALF_OPEN | CIRCUIT_CLOSE
 * @returns {string} 新状态（未知事件原样返回，幂等安全）
 */
export function transition(status, event) {
  switch (event) {
    case 'CONFIGURE':
      // 仅在未配置态可进入已配置；已配置/已连通不回退
      return status === AgentStatus.ONBOARD ? AgentStatus.CONFIGURED : status;
    case 'TEST_PASS':
      // 已配置或降级态测试通过 → 连通
      return status === AgentStatus.CONFIGURED || status === AgentStatus.DEGRADED
        ? AgentStatus.CONNECTED
        : status;
    case 'TEST_FAIL':
      // 已配置态测试失败 → 降级（仅补偿通道）
      return status === AgentStatus.CONFIGURED ? AgentStatus.DEGRADED : status;
    case 'CIRCUIT_OPEN':
      // 主通道熔断 OPEN → 强制降级（R5/R6），无论当前态
      return AgentStatus.DEGRADED;
    case 'CIRCUIT_HALF_OPEN':
      // 半开仍视为降级，待恢复
      return AgentStatus.DEGRADED;
    case 'CIRCUIT_CLOSE':
      // 熔断恢复：降级 → 连通
      return status === AgentStatus.DEGRADED ? AgentStatus.CONNECTED : status;
    default:
      // 未知事件：保持现状（不抛错，便于前端忽略脏事件）
      return status;
  }
}
