// Agent 接入服务层(REQ-003 T11 集成 / T12 E2E 链路)
// 把 stateMachine + validators + 审计 串成"卡片 -> 校验 -> 状态机 -> 审计"闭环。
// 真实后端接入时，把本类的卡片存储/审计替换为 API 调用即可，校验与状态机不变。

import { AgentStatus, transition } from './stateMachine.ts';
import { validateOnboard, type Violation } from './validators.ts';
import type { AgentCard, AgentCardInput, Form, Priority } from '../types/agentOnboard.ts';

/** 可注入后端（如 AgentOnboardClient）；为空则走零依赖内存实现（向后兼容）。 */
export interface OnboardBackend {
  cards: Map<string, AgentCard>;
  configure(input: AgentCardInput): Promise<ConfigureResult> | ConfigureResult;
  testConnect(name: string): Promise<TestResult> | TestResult;
  rotateKey(name: string): Promise<RotateResult> | RotateResult;
  revokeKey(name: string): Promise<{ ok: boolean }> | { ok: boolean };
  oneClickOnboard(agents: DiscoverInput[], form?: Form): Promise<OneClickResult> | OneClickResult;
  revokeBind(name: string): Promise<{ ok: boolean }> | { ok: boolean };
  getAudit(): Promise<AuditEntry[]> | AuditEntry[];
  getCards(): Promise<AgentCard[]> | AgentCard[];
}

export interface ConfigureResult {
  ok: boolean;
  card?: AgentCard;
  violations?: Violation[];
}
export interface TestResult {
  ok: boolean;
  card?: AgentCard;
  requestId?: string;
  reason?: string;
}
export interface RotateResult {
  ok: boolean;
  card?: AgentCard;
}
export interface OneClickResult {
  ok: boolean;
  cards: AgentCard[];
}
export interface AuditEntry {
  ts: number;
  action: string;
  agent?: string;
  [k: string]: unknown;
}
export interface DiscoverInput {
  name: string;
  priority: Priority;
  signal: string;
}

function rid(): string {
  return 'req_' + Math.random().toString(36).slice(2, 10);
}

/**
 * 接入服务。
 *
 * 泛型 `B` 决定返回形态：`B = null`（内存实现）→ 全部**同步**；
 * `B = OnboardBackend`（注入 HTTP 客户端）→ 全部 **async**。
 * 这样调用方（含测试）无需自行断言同步/异步，类型即文档。
 */
export class AgentOnboardService<B extends OnboardBackend | null = null> {
  backend: B;
  cards: Map<string, AgentCard>;
  audit: AuditEntry[] = [];

  /** B=null 时同步，B=OnboardBackend 时异步 */
  private _wrap<R>(sync: () => R, asyncFn: () => Promise<R>): R | Promise<R> {
    return this.backend ? asyncFn() : sync();
  }

  constructor(backend?: B) {
    this.backend = (backend ?? null) as B;
    if (this.backend) {
      this.cards = (this.backend as unknown as OnboardBackend).cards;
    } else {
      this.cards = new Map<string, AgentCard>();
    }
  }

  _audit(action: string, detail: Record<string, unknown>): void {
    this.audit.push({ ts: Date.now(), action, ...detail });
  }

  getAudit(): B extends null ? AuditEntry[] : Promise<AuditEntry[]> {
    return this._wrap(
      () => this.audit,
      () => Promise.resolve((this.backend as unknown as OnboardBackend).getAudit()),
    ) as unknown as B extends null ? AuditEntry[] : Promise<AuditEntry[]>;
  }

  getCards(): B extends null ? AgentCard[] : Promise<AgentCard[]> {
    return this._wrap(
      () => [...this.cards.values()],
      () => Promise.resolve((this.backend as unknown as OnboardBackend).getCards()),
    ) as unknown as B extends null ? AgentCard[] : Promise<AgentCard[]>;
  }

  /**
   * 配置一家 Agent 卡片。校验通过 → CONFIGURED，否则返回 violations（R1–R10）。
   * 对应 AC-003.1/AC-003.5/AC-003.6/AC-003.7/AC-003.9。
   */
  private _configure(input: AgentCardInput): ConfigureResult {
    const card: AgentCard = { ...input, status: AgentStatus.ONBOARD };
    const { ok, violations } = validateOnboard(card);
    if (!ok) return { ok: false, violations };
    card.status = AgentStatus.CONFIGURED;
    this.cards.set(input.agent_name, card);
    this._audit('configure', { agent: input.agent_name });
    return { ok: true, card };
  }

  configure(input: AgentCardInput): B extends null ? ConfigureResult : Promise<ConfigureResult> {
    return this._wrap(
      () => this._configure(input),
      () => Promise.resolve((this.backend as unknown as OnboardBackend).configure(input)),
    ) as unknown as B extends null ? ConfigureResult : Promise<ConfigureResult>;
  }

  private _testConnect(agentName: string): TestResult {
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

  /**
   * 测试连通：必记 request_id（R7）；熔断 OPEN → DEGRADED，否则 TEST_PASS → CONNECTED。
   * 对应 AC-003.3 / AC-003.8。
   */
  testConnect(agentName: string): B extends null ? TestResult : Promise<TestResult> {
    return this._wrap(
      () => this._testConnect(agentName),
      () => Promise.resolve((this.backend as unknown as OnboardBackend).testConnect(agentName)),
    ) as unknown as B extends null ? TestResult : Promise<TestResult>;
  }

  private _rotateKey(agentName: string): RotateResult {
    const card = this.cards.get(agentName);
    if (!card) return { ok: false };
    card.keyRotatedAt = Date.now();
    card.keyGraceUntil = Date.now() + 24 * 3600 * 1000; // 24h 宽限（§4/R6）
    this._audit('rotate', { agent: agentName });
    return { ok: true, card };
  }

  rotateKey(agentName: string): B extends null ? RotateResult : Promise<RotateResult> {
    return this._wrap(
      () => this._rotateKey(agentName),
      () => Promise.resolve((this.backend as unknown as OnboardBackend).rotateKey(agentName)),
    ) as unknown as B extends null ? RotateResult : Promise<RotateResult>;
  }

  revokeKey(agentName: string): B extends null ? { ok: boolean } : Promise<{ ok: boolean }> {
    return this._wrap(
      () => this._revokeKey(agentName),
      () => Promise.resolve((this.backend as unknown as OnboardBackend).revokeKey(agentName)),
    ) as unknown as B extends null ? { ok: boolean } : Promise<{ ok: boolean }>;
  }

  private _revokeKey(agentName: string): { ok: boolean } {
    const card = this.cards.get(agentName);
    if (!card) return { ok: false };
    card.apiKeyPlaintext = null;
    card.keyRevoked = true; // R5/R6 立即失效
    this._audit('revoke', { agent: agentName });
    return { ok: true };
  }

  /**
   * 一键全量接入：发现 → 打标 → 绑定默认值 → 测通（AC-003.4 / R8 / R9 / R10）。
   */
  oneClickOnboard(agents: DiscoverInput[], form: Form = 'desktop'): B extends null ? OneClickResult : Promise<OneClickResult> {
    return this._wrap(
      () => this._oneClick(agents, form),
      () => Promise.resolve((this.backend as unknown as OnboardBackend).oneClickOnboard(agents, form)),
    ) as unknown as B extends null ? OneClickResult : Promise<OneClickResult>;
  }

  private _oneClick(agents: DiscoverInput[], form: Form): OneClickResult {
    const result: AgentCard[] = [];
    for (const a of agents) {
      // R8 默认只读召回；P2 写须确认（未确认则禁写）
      const p2 = a.priority === 'P2';
      const card: AgentCard = {
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
  revokeBind(agentName: string): B extends null ? { ok: boolean } : Promise<{ ok: boolean }> {
    return this._wrap(
      () => {
        const existed = this.cards.delete(agentName);
        if (existed) this._audit('unbound', { agent: agentName });
        return { ok: existed };
      },
      () => Promise.resolve((this.backend as unknown as OnboardBackend).revokeBind(agentName)),
    ) as unknown as B extends null ? { ok: boolean } : Promise<{ ok: boolean }>;
  }
}