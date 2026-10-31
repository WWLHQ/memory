// A5：跨源策略纯函数单测（不启服务，覆盖白名单归一化 / null / 通配符禁止）
import { describe, it, expect } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  DEV_ORIGINS,
  createOriginPolicy,
  rejectUntrustedOrigin,
  applyCorsHeaders,
} from '../localOrigin.ts';

function req(headers: Record<string, string> = {}): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

function res() {
  const headers: Record<string, string> = {};
  let status = 200;
  let body = '';
  const r = {
    writeHead(code: number, h?: Record<string, string>) {
      status = code;
      Object.assign(headers, h ?? {});
      return r;
    },
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = v;
    },
    end(b?: string) {
      body = b ?? '';
    },
    get status() {
      return status;
    },
    get headers() {
      return headers;
    },
    get body() {
      return body;
    },
  };
  return r as typeof r & ServerResponse;
}

const policy = createOriginPolicy(['http://localhost:8123/', 'http://localhost:8123'], { allowDev: true });

describe('A5 createOriginPolicy', () => {
  it('allowDev 显式开启才并入 dev server 源；额外来源去重并去掉尾斜杠', () => {
    for (const o of DEV_ORIGINS) expect(policy.allowed.has(o)).toBe(true);
    expect([...policy.allowed].filter((o) => o === 'http://localhost:8123').length).toBe(1);
  });

  it('生产默认不含 dev server 源（只放行显式来源）', () => {
    const prod = createOriginPolicy(['http://localhost:8123']);
    expect(prod.allowed.has('http://localhost:8123')).toBe(true);
    for (const o of DEV_ORIGINS) expect(prod.allowed.has(o)).toBe(false);
    expect(rejectUntrustedOrigin(req({ origin: 'http://127.0.0.1:5180' }), res(), prod)).toBe(true);
  });
});

describe('A5 rejectUntrustedOrigin', () => {
  it('无 Origin（本机 CLI / 单测）放行', () => {
    const r = res();
    expect(rejectUntrustedOrigin(req(), r, policy)).toBe(false);
    expect(r.status).toBe(200);
  });

  it('白名单 Origin 放行（含尾斜杠归一化）', () => {
    expect(rejectUntrustedOrigin(req({ origin: 'http://localhost:8123' }), res(), policy)).toBe(false);
    expect(rejectUntrustedOrigin(req({ origin: 'http://localhost:8123/' }), res(), policy)).toBe(false);
    expect(rejectUntrustedOrigin(req({ origin: 'http://127.0.0.1:5180' }), res(), policy)).toBe(false);
  });

  it('Origin: null / 非白名单 → 403 + origin_not_allowed', () => {
    for (const origin of ['null', 'http://evil.example', 'http://localhost:9999']) {
      const r = res();
      expect(rejectUntrustedOrigin(req({ origin }), r, policy)).toBe(true);
      expect(r.status).toBe(403);
      expect(JSON.parse(r.body)).toEqual({ ok: false, error: 'origin_not_allowed' });
    }
  });
});

describe('A5 applyCorsHeaders', () => {
  it('白名单回显 ACAO 并带 Vary: Origin', () => {
    const r = res();
    applyCorsHeaders(req({ origin: 'http://localhost:8123' }), r, policy);
    expect(r.headers['access-control-allow-origin']).toBe('http://localhost:8123');
    expect(r.headers.vary).toBe('Origin');
  });

  it('非白名单 / null / 无 Origin 一律不回显（绝不使用 *）', () => {
    const cases: Array<Record<string, string>> = [{ origin: 'http://evil.example' }, { origin: 'null' }, {}];
    for (const headers of cases) {
      const r = res();
      applyCorsHeaders(req(headers), r, policy);
      expect(r.headers['access-control-allow-origin']).toBeUndefined();
    }
  });
});

// ── 批次26-B P2-16：Host 头绑定（防 DNS rebinding） ──
import { rejectUntrustedHost } from '../localOrigin.ts';

describe('批次26-B P2-16 rejectUntrustedHost', () => {
  it('回环主机名 + 指定端口放行（大小写不敏感）', () => {
    for (const h of ['127.0.0.1:8201', 'localhost:8201', '[::1]:8201', 'LOCALHOST:8201']) {
      expect(rejectUntrustedHost(req({ host: h }), res(), [8201])).toBe(false);
    }
  });

  it('无 Host（HTTP/1.0 CLI / 部分单测客户端）放行', () => {
    expect(rejectUntrustedHost(req(), res(), [8201])).toBe(false);
  });

  it('恶意域名 / 错误端口 → 403 host_not_allowed', () => {
    for (const h of ['evil.example', '127.0.0.1:9999', 'localhost:8202', '127.0.0.1.evil.example:8201']) {
      const r = res();
      expect(rejectUntrustedHost(req({ host: h }), r, [8201])).toBe(true);
      expect(r.status).toBe(403);
      expect(JSON.parse(r.body)).toEqual({ ok: false, error: 'host_not_allowed' });
    }
  });
});
