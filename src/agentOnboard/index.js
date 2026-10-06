// REQ-003 Agent 接入逻辑核心统一出口
export { AgentStatus, transition } from './stateMachine.js';
export {
  validateOnboard,
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
} from './validators.js';
