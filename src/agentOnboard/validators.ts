// Agent 接入配置校验器 (REQ-003 §6 校验规则 R1-R6 / §7 边界约束 R1-R10 / T9)
// 纯函数。把规格里的"红线"收敛为统一、可复用、可单测的校验函数。
//
// 每个 check 返回 { rule, ok, msg }；validateOnboard 汇总为 { ok, violations }。

import type { AgentCardCandidate } from '../types/agentOnboard.ts';

export interface Violation {
  rule: string;
  ok: boolean;
  msg: string;
}

/** R1 租户禁手填：enterprise_id/team_id 仅全局注入 */
export function checkR1_tenantNotHandFilled(card: AgentCardCandidate): Violation {
  return {
    rule: 'R1',
    ok: card.tenantManual !== true,
    msg: card.tenantManual ? '租户 ID 仅全局注入，前端禁手填（R1）' : '',
  };
}

/** R2 记忆读写必带 project_id（跨 Agent 共享锚） */
export function checkR2_projectIdRequired(card: AgentCardCandidate): Violation {
  const t = card.mcpTools ?? {};
  const bad: string[] = [];
  if (t.recall_memory && !t.recall_memory.project_id) bad.push('recall_memory');
  if (t.write_memory && !t.write_memory.project_id) bad.push('write_memory');
  return {
    rule: 'R2',
    ok: bad.length === 0,
    msg: bad.length ? `记忆读写须带 project_id：缺 ${bad.join(', ')}（R2）` : '',
  };
}

/** R3 scene=critical 时 mode 不得 minimal（16.5） */
export function checkR3_criticalNoMinimal(card: AgentCardCandidate): Violation {
  const r = card.mcpTools?.recall_memory;
  const violate = !!(r && r.scene === 'critical' && r.mode === 'minimal');
  return {
    rule: 'R3',
    ok: !violate,
    msg: violate ? 'critical 禁极简，已回落 null（R3）' : '',
  };
}

/** R4 双通道至少开一（记忆库需可采集） */
export function checkR4_dualChannelAtLeastOne(card: AgentCardCandidate): Violation {
  const c = card.channels ?? { webhook: false, apiPull: false };
  const ok = c.webhook === true || c.apiPull === true;
  return { rule: 'R4', ok, msg: ok ? '' : '双通道至少开一（R4）' };
}

/** R5 密钥不回流：界面恒脱敏，不回显明文 */
export function checkR5_keyNotReflected(card: AgentCardCandidate): Violation {
  const leak = card.apiKeyPlaintext !== undefined && card.apiKeyPlaintext !== null;
  return { rule: 'R5', ok: !leak, msg: leak ? '密钥不回流：界面恒脱敏（R5）' : '' };
}

/** R6 熔断联动：熔断 OPEN 时状态须为 DEGRADED（UI 显示降级而非报错） */
export function checkR6_circuitDegrade(card: AgentCardCandidate): Violation {
  const open = card.circuit === 'OPEN';
  const ok = !open || card.status === 'DEGRADED';
  return { rule: 'R6', ok, msg: !ok ? '熔断 OPEN 应降级 DEGRADED（R6）' : '' };
}

/** R7 每家 Agent 测试必记 request_id 审计（18.2-E） */
export function checkR7_requestIdAudit(card: AgentCardCandidate): Violation {
  const violate = card.tested === true && !card.requestId;
  return { rule: 'R7', ok: !violate, msg: violate ? '测试必记 request_id 审计（R7）' : '' };
}

/** R8 一键自动绑定默认只开只读召回；P2 写须用户确认 */
export function checkR8_oneClickReadOnly(card: AgentCardCandidate): Violation {
  const oc = card.oneClick;
  if (oc?.enabled && oc.defaultReadOnly !== true) {
    return { rule: 'R8', ok: false, msg: '一键自动绑定默认只开只读召回（R8）' };
  }
  if (oc?.enabled && oc.p2Write === true && oc.p2Confirm !== true) {
    return { rule: 'R8', ok: false, msg: 'P2 兜底 Agent 开启写入需确认（R8）' };
  }
  return { rule: 'R8', ok: true, msg: '' };
}

/** R9 每个自动绑定可一键撤销（审计 unbound） */
export function checkR9_autoBindRevocable(card: AgentCardCandidate): Violation {
  const oc = card.oneClick;
  const ok = !oc?.enabled || oc.bindRevocable === true;
  return { rule: 'R9', ok, msg: ok ? '' : '每个自动绑定可一键撤销（R9）' };
}

/** R10 发现范围限本机用户授权，不跨机器/不爬公网 */
export function checkR10_discoverLocalOnly(card: AgentCardCandidate): Violation {
  const d = card.discover;
  const violate = d?.enabled === true && d.crossMachine === true;
  return { rule: 'R10', ok: !violate, msg: violate ? '发现范围限本机，不跨机器（R10）' : '' };
}

const CHECKS = [
  checkR1_tenantNotHandFilled,
  checkR2_projectIdRequired,
  checkR3_criticalNoMinimal,
  checkR4_dualChannelAtLeastOne,
  checkR5_keyNotReflected,
  checkR6_circuitDegrade,
  checkR7_requestIdAudit,
  checkR8_oneClickReadOnly,
  checkR9_autoBindRevocable,
  checkR10_discoverLocalOnly,
];

/** 汇总校验整张卡片。 */
export function validateOnboard(card: AgentCardCandidate = {}): { ok: boolean; violations: Violation[] } {
  const violations = CHECKS.map((fn) => fn(card));
  return { ok: violations.every((v) => v.ok), violations };
}