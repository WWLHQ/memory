// Agent 接入 HTTP 客户端（REQ-003 接真实后端 · T14）
// 与 AgentOnboardService 同接口，走 fetch 调 T13 服务。本地维护 cards 镜像 Map 供渲染层读取。
import type { AgentCard, AgentCardInput, Form } from '../types/agentOnboard.ts';
import type {
  AuditEntry, ConfigureResult, DiscoverInput, OnboardBackend,
  OneClickResult, RevokeBindResult, RevokeKeyResult, RotateResult, TestResult,
} from './service.ts';

export class AgentOnboardClient implements OnboardBackend {
  baseUrl: string;
  /** 本地镜像，随每次响应更新 */
  cards: Map<string, AgentCard>;
  private _fetch: typeof globalThis.fetch;
  /** 会话提供者（批次26-A P0-5）：有登录会话时所有请求带 x-session-id（写端点服务端强制校验） */
  private _getSession?: () => string | null | undefined;

  constructor(baseUrl: string, fetchImpl: typeof globalThis.fetch = globalThis.fetch, getSession?: () => string | null | undefined) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    // 必须绑定到 globalThis：浏览器 fetch 要求 this 为 Window，
    // 若以 this._fetch(...) 调用（this=本实例）会报 "Illegal invocation"。
    this._fetch = fetchImpl.bind(globalThis);
    this._getSession = getSession;
    this.cards = new Map<string, AgentCard>();
  }

  async configure(input: AgentCardInput): Promise<ConfigureResult> {
    const out = await this._post('/agents', input);
    if (out.ok && out.card) this._mirror(out.card, input.agent_name);
    return out;
  }

  async testConnect(name: string, expectedRev?: number): Promise<TestResult> {
    const out = await this._post(`/agents/${enc(name)}/test${revQuery(expectedRev)}`);
    if (out.ok && out.card) this._mirror(out.card, name);
    return out;
  }

  async rotateKey(name: string, expectedRev?: number): Promise<RotateResult> {
    const out = await this._post(`/agents/${enc(name)}/rotate-key${revQuery(expectedRev)}`);
    // out.key 是一次性明文；本地镜像只缓存脱敏卡片，绝不缓存明文
    if (out.ok && out.card) this._mirror(out.card, name);
    return out;
  }

  async revokeKey(name: string, expectedRev?: number): Promise<RevokeKeyResult> {
    const out = await this._post(`/agents/${enc(name)}/revoke-key${revQuery(expectedRev)}`);
    if (out.ok) {
      const c = this.cards.get(name);
      if (c) { c.apiKeyPlaintext = null; c.keyHash = undefined; c.keyRevoked = true; }
    }
    return out;
  }

  async oneClickOnboard(agents: DiscoverInput[], form: Form = 'desktop'): Promise<OneClickResult> {
    const out = await this._post('/discover', { agents, form });
    if (out.ok && Array.isArray(out.cards)) {
      // A29 重复发现：按归一化名更新同一条镜像，不新增第二行
      for (const c of out.cards) this._mirror(c, c.agent_name);
    }
    return out;
  }

  async revokeBind(name: string, expectedRev?: number): Promise<RevokeBindResult> {
    const out = await this._del(`/agents/${enc(name)}${revQuery(expectedRev)}`);
    if (out.ok) {
      const key = normName(name);
      for (const k of Array.from(this.cards.keys())) {
        if (normName(k) === key) this.cards.delete(k);
      }
    }
    return out;
  }

  /** 镜像写入：按归一化名合并（大小写/空白不同不产生第二行） */
  private _mirror(card: AgentCard, requestedName: string): void {
    const key = normName(requestedName);
    for (const k of this.cards.keys()) {
      if (normName(k) === key && k !== card.agent_name) this.cards.delete(k);
    }
    this.cards.set(card.agent_name, card);
  }

  async getAudit(): Promise<AuditEntry[]> {
    const out = await this._get('/audit');
    return out.ok ? out.audit : [];
  }

  async getCards(): Promise<AgentCard[]> {
    const out = await this._get('/agents');
    if (out.ok && Array.isArray(out.cards)) {
      for (const c of out.cards) this._mirror(c, c.agent_name);
    }
    return [...this.cards.values()];
  }

  private _headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    const sid = this._getSession?.();
    if (sid) h['x-session-id'] = sid;
    return h;
  }

  private async _post(path: string, body: unknown = {}): Promise<any> {
    const r = await this._fetch(this.baseUrl + path, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(body),
    });
    return r.json();
  }

  private async _del(path: string): Promise<any> {
    const r = await this._fetch(this.baseUrl + path, { method: 'DELETE', headers: this._headers() });
    return r.json();
  }

  private async _get(path: string): Promise<any> {
    const r = await this._fetch(this.baseUrl + path, { headers: this._headers() });
    return r.json();
  }
}

function enc(name: string): string {
  return encodeURIComponent(name);
}

/** A29 并发版本校验参数（缺省不带，保持旧行为） */
function revQuery(expectedRev?: number): string {
  return expectedRev === undefined ? '' : `?rev=${encodeURIComponent(String(expectedRev))}`;
}

function normName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}