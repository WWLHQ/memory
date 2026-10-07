// Agent 接入 HTTP 客户端（REQ-003 接真实后端 · T14）
// 与 AgentOnboardService 同接口：configure/testConnect/rotateKey/revokeKey/oneClickOnboard/revokeBind/getAudit，
// 走 fetch 调 T13 服务。本地维护 cards 镜像 Map 供渲染层直接读取（与内存实现一致）。
// 默认无后端时由 AgentOnboardService 走内存实现；本类用于"前端/客户端改调真实后端"。
export class AgentOnboardClient {
  constructor(baseUrl, fetchImpl = globalThis.fetch) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this._fetch = fetchImpl;
    /** @type {Map<string, object>} 本地镜像，随每次响应更新 */
    this.cards = new Map();
  }

  async configure(input) {
    const out = await this._post('/agents', input);
    if (out.ok && out.card) this.cards.set(input.agent_name, out.card);
    return out;
  }

  async testConnect(name) {
    const out = await this._post(`/agents/${enc(name)}/test`);
    if (out.ok && out.card) this.cards.set(name, out.card);
    return out;
  }

  async rotateKey(name) {
    const out = await this._post(`/agents/${enc(name)}/rotate-key`);
    if (out.ok && out.card) this.cards.set(name, out.card);
    return out;
  }

  async revokeKey(name) {
    const out = await this._post(`/agents/${enc(name)}/revoke-key`);
    if (out.ok) {
      const c = this.cards.get(name);
      if (c) { c.apiKeyPlaintext = null; c.keyRevoked = true; }
    }
    return out;
  }

  async oneClickOnboard(agents, form = 'desktop') {
    const out = await this._post('/discover', { agents, form });
    if (out.ok && Array.isArray(out.cards)) {
      for (const c of out.cards) this.cards.set(c.agent_name, c);
    }
    return out;
  }

  async revokeBind(name) {
    const out = await this._del(`/agents/${enc(name)}`);
    if (out.ok) this.cards.delete(name);
    return out;
  }

  async getAudit() {
    const out = await this._get('/audit');
    return out.ok ? out.audit : [];
  }

  async getCards() {
    const out = await this._get('/agents');
    if (out.ok && Array.isArray(out.cards)) {
      for (const c of out.cards) this.cards.set(c.agent_name, c);
    }
    return [...this.cards.values()];
  }

  async _post(path, body = {}) {
    const r = await this._fetch(this.baseUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return r.json();
  }

  async _del(path) {
    const r = await this._fetch(this.baseUrl + path, { method: 'DELETE' });
    return r.json();
  }

  async _get(path) {
    const r = await this._fetch(this.baseUrl + path);
    return r.json();
  }
}

function enc(name) { return encodeURIComponent(name); }
