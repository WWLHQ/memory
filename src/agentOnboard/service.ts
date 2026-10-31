// Agent 接入服务层(REQ-003 T11 集成 / T12 E2E 链路)
// 把 stateMachine + validators + 审计 串成"卡片 -> 校验 -> 状态机 -> 审计"闭环。
// 真实后端接入时，把本类的卡片存储/审计替换为 API 调用即可，校验与状态机不变。

import { AgentStatus, transition } from './stateMachine.ts';
import { ulid } from '../core/memagent/ulid.ts';
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
  /** 一次性明文密钥：仅本次响应返回，服务端只保存 keyHash/keyTail */
  key?: string;
  reason?: string;
}

/** 单家 Agent 的真实探测结果（失败原因必填，供 UI 如实展示） */
export interface ProbeResult {
  ok: boolean;
  /** 失败原因 / 通过证据（如「命中安装证据（cli）：…」） */
  reason: string;
  /** 可选溯源（真实安装路径 / 命令 / 卸载项） */
  evidence?: string;
}

/**
 * 真实拨测（批量签名：一次扫描回答多家，避免一键接入逐家重复扫描）。
 * 缺省不注入 = 无法验证 → 测试一律不得报 CONNECTED（Phase C 验收）。
 */
export type AgentProbe = (agentNames: string[]) => Map<string, ProbeResult>;

export interface OnboardServiceOptions {
  /** 真实拨测（桌面壳注入本机安装痕迹探测；测试注入 fake） */
  probe?: AgentProbe;
  /** 密钥哈希（服务端注入 SHA-256；浏览器侧不注入 → 只存尾号，不存明文） */
  keyHasher?: (key: string) => string;
}

/** 生成真实接入密钥（24 字节随机 → 48 hex，形如 mam_sk_<hex>）；界面恒脱敏，仅服务端持有明文 */
function newApiKey(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return 'mam_sk_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 安全调用探测：探测抛错 → 视为未通过（不让异常伪装成连通） */
function runProbe(probe: AgentProbe, names: string[]): Map<string, ProbeResult> {
  try {
    return probe(names);
  } catch (e) {
    const reason = `本机探测异常：${(e as Error)?.message ?? String(e)}`;
    return new Map(names.map((n) => [n, { ok: false, reason }]));
  }
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
  return 'req_' + ulid();
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
  /** 真实拨测；缺省 → 无法验证连通（测试只降级不谎报） */
  probe?: AgentProbe;
  /** 密钥哈希；缺省不保存哈希（只保留尾号） */
  keyHasher?: (key: string) => string;

  /** B=null 时同步，B=OnboardBackend 时异步 */
  private _wrap<R>(sync: () => R, asyncFn: () => Promise<R>): R | Promise<R> {
    return this.backend ? asyncFn() : sync();
  }

  constructor(backend?: B, options: OnboardServiceOptions = {}) {
    this.probe = options.probe;
    this.keyHasher = options.keyHasher;
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
    // 密钥字段只由 rotateKey 维护；客户端不得注入哈希/尾号
    card.apiKeyPlaintext = null;
    delete card.keyHash;
    delete card.keyTail;
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

    // 主通道熔断：直接降级（不再冒充测通）
    if (card.circuit === 'OPEN') {
      const reason = '主通道熔断 OPEN，已降级为仅补偿通道（circuit_open）';
      card.status = transition(card.status, 'CIRCUIT_OPEN');
      card.lastTest = { ok: false, reason, at: Date.now() };
      this._audit('test', { agent: agentName, requestId, status: card.status, result: 'fail', reason: 'circuit_open' });
      return { ok: false, card, requestId, reason };
    }

    // 未注入真实探测：无法验证 → 只降级，绝不谎报 CONNECTED
    if (!this.probe) {
      const reason = '未配置本机探测能力，无法验证连通（not_probed）';
      card.status = transition(card.status, 'TEST_FAIL');
      card.lastTest = { ok: false, reason, at: Date.now() };
      this._audit('test', { agent: agentName, requestId, status: card.status, result: 'fail', reason: 'not_probed' });
      return { ok: false, card, requestId, reason };
    }

    // 真实拨测：以本机安装/连接证据为唯一真相（记录真实探测耗时，供卡片「平均延时」）
    const probeStarted = Date.now();
    const probe = runProbe(this.probe, [agentName]).get(agentName)
      ?? { ok: false, reason: `探测未返回「${agentName}」的结果` };
    const durationMs = Date.now() - probeStarted;
    card.status = transition(card.status, probe.ok ? 'TEST_PASS' : 'TEST_FAIL');
    card.lastTest = { ok: probe.ok, reason: probe.reason, at: Date.now(), durationMs };
    this._audit('test', {
      agent: agentName, requestId, status: card.status,
      result: probe.ok ? 'pass' : 'fail', reason: probe.reason, durationMs,
    });
    return { ok: probe.ok, card, requestId, reason: probe.reason };
  }

  /**
   * 测试连通：必记 request_id（R7）；熔断 OPEN → DEGRADED；
   * 真实拨测失败 → TEST_FAIL → DEGRADED（已连通卡片同样回落，见状态机）。
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
    if (!card) return { ok: false, reason: 'no-card' };
    const now = Date.now();
    const key = newApiKey();
    // 明文只在本次响应一次性返回；卡片只存哈希与尾 4 位（旧实现把明文随 JSON 落盘 + GET 泄露）
    card.apiKeyPlaintext = null;
    card.keyHash = this.keyHasher ? this.keyHasher(key) : undefined;
    card.keyTail = key.slice(-4);
    card.keyRotatedAt = now;
    card.keyGraceUntil = now + 24 * 3600 * 1000; // 24h 宽限（§4/R6）
    card.keyRevoked = false; // 轮换即恢复可用（旧 Key 宽限期内有效）
    // 审计只记尾 4 位，绝不落明文
    this._audit('rotate', { agent: agentName, keyTail: card.keyTail });
    return { ok: true, card, key };
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
    card.keyHash = undefined; // 吊销后哈希不再可用
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
    // 一次扫描回答多家（避免逐家重复跑本机探测）；失败/缺省一律不得 CONNECTED
    const probeStarted = Date.now();
    const probeResults = this.probe ? runProbe(this.probe, agents.map((a) => a.name)) : null;
    // 批量探测耗时：作为本轮每条 auto_bind 的真实耗时样本（UI「平均延时」）
    const probeMs = probeResults ? Date.now() - probeStarted : undefined;
    for (const a of agents) {
      // R8 默认只读召回；P2 写须确认（未确认则禁写）
      const p2 = a.priority === 'P2';
      const probeResult: ProbeResult = probeResults?.get(a.name)
        ?? { ok: false, reason: this.probe ? `探测未返回「${a.name}」的结果` : '未配置本机探测能力，无法验证连通（not_probed）' };
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
        tested: probeResult.ok,
        requestId: probeResult.ok ? rid() : null,
        // 把本轮真实拨测耗时随卡片下发：/agents 回填时即使审计读取失败，UI 仍有真实延时样本
        lastTest: {
          ok: probeResult.ok, reason: probeResult.reason, at: Date.now(),
          ...(probeMs !== undefined ? { durationMs: probeMs } : {}),
        },
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
      // 真实探测通过 → CONNECTED；失败/无探测 → DEGRADED（不谎报已连通）
      card.status = transition(card.status, probeResult.ok ? 'TEST_PASS' : 'TEST_FAIL');
      this.cards.set(a.name, card);
      this._audit('auto_bind', {
        agent: a.name, signal: a.signal, form, priority: a.priority,
        status: card.status, result: probeResult.ok ? 'pass' : 'fail', reason: probeResult.reason,
        ...(probeMs !== undefined ? { durationMs: probeMs } : {}),
      });
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