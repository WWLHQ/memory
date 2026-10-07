// Agent 接入内存级服务（REQ-003 T11 集成 / T12 E2E 链路）
// 把 stateMachine + validators + 审计 串成"卡片 -> 校验 -> 状态机 -> 审计"闭环，纯内存、零依赖、可单测。
// 真实后端接入时，把本类的卡片存储/审计替换为 API 调用即可，校验与状态机不变。

import { AgentStatus, transition } from './stateMachine.js';
import { validateOnboard } from './validators.js';

function rid() {
  return 'req_' + Math.random().toString(36).slice(2, 10);
}

export class AgentOnboardService {
  /**
   * @param {object|null} [backend] 可选后端（如 AgentOnboardClient）。为空则走零依赖内存实现（向后兼容）。
   * 注入后端时，所有方法委托给 backend（天然异步），cards 复用 backend 的本地镜像 Map 供渲染。
   */
  constructor(backend = null) {
    this.backend = backend || null;
    if (this.backend) {
      this.cards = backend.cards; // 复用客户端本地镜像
    } else {
      /** @type {Map<string, object>} */
      this.cards = new Map();
      this.audit = [];
    }
  }

  _audit(action, detail) {
    this.audit.push({ ts: Date.now(), action, ...detail });
  }

  getAudit() {
    if (this.backend) return this.backend.getAudit(); // async
    return this.audit;
  }

  /**
   * 配置一家 Agent 卡片。校验通过 → CONFIGURED，否则返回 violations（R1–R10）。
   * 对应 AC-003.1/AC-003.5/AC-003.6/AC-003.7/AC-003.9。
   */
  configure(input) {
    if (this.backend) return this.backend.configure(input); // async
    const card = { ...input, status: AgentStatus.ONBOARD };
    const { ok, violations } = validateOnboard(card);
    if (!ok) return { ok: false, violations };
    card.status = AgentStatus.CONFIGURED;
    this.cards.set(input.agent_name, card);
    this._audit('configure', { agent: input.agent_name });
    return { ok: true, card };
  }

  /**
   * 测试连通：必记 request_id（R7）；熔断 OPEN → DEGRADED，否则 TEST_PASS → CONNECTED。
   * 对应 AC-003.3 / AC-003.8。
   */
  testConnect(agentName) {
    if (this.backend) return this.backend.testConnect(agentName); // async
    const card = this.cards.get(agentName);
    if (!card) return { ok: false, reason: 'no-card' };
    const requestId = rid();
    card.requestId = requestId;
    card.tested = true;
    card.status = card.circuit === 'OPEN'
      ? transition(card.status, 'CIRCUIT_OPEN')
      : transition(card.status, 'TEST_PASS');
    this._audit('test', { agent: agentName, requestId, status: card.status });
    return { ok: true, card, requestId };
  }

  rotateKey(agentName) {
    if (this.backend) return this.backend.rotateKey(agentName); // async
    const card = this.cards.get(agentName);
    if (!card) return { ok: false };
    card.keyRotatedAt = Date.now();
    card.keyGraceUntil = Date.now() + 24 * 3600 * 1000; // 24h 宽限（§4/R6）
    this._audit('rotate', { agent: agentName });
    return { ok: true, card };
  }

  revokeKey(agentName) {
    if (this.backend) return this.backend.revokeKey(agentName); // async
    const card = this.cards.get(agentName);
    if (!card) return { ok: false };
    card.apiKeyPlaintext = null;
    card.keyRevoked = true; // R5/R6 立即失效
    this._audit('revoke', { agent: agentName });
    return { ok: true };
  }

  /**
   * 一键全量接入：发现 → 打标 → 绑定默认值 → 测通（AC-003.4 / R8 / R9 / R10）。
   * agents: [{name, priority:'P0'|'P1'|'P2', signal}]
   * form: 当前端（审计记 form，19.11）
   */
  oneClickOnboard(agents, form = 'desktop') {
    if (this.backend) return this.backend.oneClickOnboard(agents, form); // async
    const result = [];
    for (const a of agents) {
      // R8 默认只读召回；P2 写须确认（未确认则禁写）
      const p2 = a.priority === 'P2';
      const card = {
        agent_name: a.name,
        priority: a.priority,
        status: AgentStatus.CONFIGURED,
        tenantManual: false, // R1
        mcpTools: {
          recall_memory: { project_id: 'p1', scene: 'default', mode: null }, // R2 带 project_id
          write_memory: { project_id: 'p1' },
          get_user_preferences: { user_id: 'u1' },
        },
        channels: { webhook: true, apiPull: true }, // R4 双通道至少一
        apiKeyPlaintext: null, // R5 脱敏
        circuit: 'CLOSED',
        tested: true,
        requestId: rid(),
        oneClick: {
          enabled: true,
          defaultReadOnly: true, // R8 默认只读召回
          p2Write: false, // R8 敏感写入默认关，P2 须用户确认后才开
          p2Confirm: !p2, // P2 未确认；P0/P1 视为已放行
          bindRevocable: true, // R9 可撤销
        },
        discover: { enabled: true, crossMachine: false }, // R10 限本机
        form,
      };
      card.status = transition(card.status, 'TEST_PASS'); // 测通 → CONNECTED
      this.cards.set(a.name, card);
      this._audit('auto_bind', { agent: a.name, signal: a.signal, form, priority: a.priority });
      result.push(card);
    }
    return { ok: true, cards: result };
  }

  /** 撤销自动绑定（R9 / 审计 unbound） */
  revokeBind(agentName) {
    if (this.backend) return this.backend.revokeBind(agentName); // async
    const existed = this.cards.delete(agentName);
    if (existed) this._audit('unbound', { agent: agentName });
    return { ok: existed };
  }
}
