// Agent 接入 HTTP 客户端（REQ-003 接真实后端 · T14）
// 与 AgentOnboardService 同接口，走 fetch 调 T13 服务。本地维护 cards 镜像 Map 供渲染层读取。
import type { AgentCard, AgentCardInput, Form } from '../types/agentOnboard.ts';
import type {
  AuditEntry, ConfigureResult, DiscoverInput, OnboardBackend,
  OneClickResult, RotateResult, TestResult,
} from './service.ts';

export class AgentOnboardClient implements OnboardBackend {
  baseUrl: string;
  /** 本地镜像，随每次响应更新 */
  cards: Map<string, AgentCard>;
  private _fetch: typeof globalThis.fetch;

  constructor(baseUrl: string, fetchImpl: typeof globalThis.fetch = globalThis.fetch) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    // 必须绑定到 globalThis：浏览器 fetch 要求 this 为 Window，
    // 若以 this._fetch(...) 调用（this=本实例）会报 "Illegal invocation"。
    this._fetch = fetchImpl.bind(globalThis);
    this.cards = new Map<string, AgentCard>();
  }

  async configure(input: AgentCardInput): Promise<ConfigureResult> {
    const out = await this._post('/agents', input);
    if (out.ok && out.card) this.cards.set(input.agent_name, out.card);
    return out;
  }

  async testConnect(name: string): Promise<TestResult> {
    const out = await this._post(`/agents/${enc(name)}/test`);
    if (out.ok && out.card) this.cards.set(name, out.card);
    return out;
  }

  async rotateKey(name: string): Promise<RotateResult> {
    const out = await this._post(`/agents/${enc(name)}/rotate-key`);
    if (out.ok && out.card) this.cards.set(name, out.card);
    return out;
  }

  async revokeKey(name: string): Promise<{ ok: boolean }> {
    const out = await this._post(`/agents/${enc(name)}/revoke-key`);
    if (out.ok) {
      const c = this.cards.get(name);
      if (c) { c.apiKeyPlaintext = null; c.keyRevoked = true; }
    }
    return out;
  }

  async oneClickOnboard(agents: DiscoverInput[], form: Form = 'desktop'): Promise<OneClickResult> {
    const out = await this._post('/discover', { agents, form });
    if (out.ok && Array.isArray(out.cards)) {
      for (const c of out.cards) this.cards.set(c.agent_name, c);
    }
    return out;
  }

  async revokeBind(name: string): Promise<{ ok: boolean }> {
    const out = await this._del(`/agents/${enc(name)}`);
    if (out.ok) this.cards.delete(name);
    return out;
  }

  async getAudit(): Promise<AuditEntry[]> {
    const out = await this._get('/audit');
    return out.ok ? out.audit : [];
  }

  async getCards(): Promise<AgentCard[]> {
    const out = await this._get('/agents');
    if (out.ok && Array.isArray(out.cards)) {
      for (const c of out.cards) this.cards.set(c.agent_name, c);
    }
    return [...this.cards.values()];
  }

  private async _post(path: string, body: unknown = {}): Promise<any> {
    const r = await this._fetch(this.baseUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return r.json();
  }

  private async _del(path: string): Promise<any> {
    const r = await this._fetch(this.baseUrl + path, { method: 'DELETE' });
    return r.json();
  }

  private async _get(path: string): Promise<any> {
    const r = await this._fetch(this.baseUrl + path);
    return r.json();
  }
}

function enc(name: string): string {
  return encodeURIComponent(name);
}