// A5：agentOnboard 本机服务跨源闸门——任意网页不得撤销密钥 / 改卡 / 一键接入
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type RunningServer } from '../server.ts';
import type { TenantContext } from '../../types/home.ts';

const ALLOWED = 'http://localhost:8125';
const EVIL = 'http://evil.example';
// 批次26 P0-5：白名单 Origin 也必须带真实会话才能写
const ADMIN_SID = 'sid-admin';
const getSession = (sid: string | undefined) =>
  sid === ADMIN_SID
    ? ({ enterprise_id: 'e1', team_id: 't1', user_id: 'admin-1', perspective: 'team', session_id: ADMIN_SID, role: 'admin' } satisfies TenantContext)
    : null;

const VALID = {
  agent_name: 'a1',
  priority: 'P0',
  tenantManual: false,
  mcpTools: {
    recall_memory: { project_id: 'p1' },
    write_memory: { project_id: 'p1' },
    get_user_preferences: { user_id: 'u1' },
  },
  channels: { webhook: true, apiPull: true },
  apiKeyPlaintext: null,
  circuit: 'CLOSED',
};

let tmp: string;
let h: RunningServer;

describe('A5 跨源闸门（agentOnboard server）', () => {
  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'ab-origin-'));
    h = await createServer({ port: 0, dataFile: join(tmp, 'agent-onboard.json'), allowedOrigins: [ALLOWED], getSession });
  });
  afterEach(async () => {
    h.server.closeAllConnections?.();
    await h.stop();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('非白名单 Origin 的写操作 → 403，且卡表未被改动', async () => {
    const r = await fetch(`${h.url}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: EVIL },
      body: JSON.stringify(VALID),
    });
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: string }).error).toBe('origin_not_allowed');
    expect(r.headers.get('access-control-allow-origin')).toBeNull();

    const cards = (await (await fetch(`${h.url}/agents`)).json()) as { cards: unknown[] };
    expect(cards.cards).toEqual([]);
  });

  it('白名单 Origin：ACAO 精确回显 + 写操作正常放行（绝不为 *；无会话仍 401）', async () => {
    // 同源但无会话 → 仍然拒绝（Origin 白名单不是鉴权）
    const noSid = await fetch(`${h.url}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED },
      body: JSON.stringify(VALID),
    });
    expect(noSid.status).toBe(401);

    const r = await fetch(`${h.url}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ALLOWED, 'x-session-id': ADMIN_SID },
      body: JSON.stringify(VALID),
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('access-control-allow-origin')).toBe(ALLOWED);
    expect(r.headers.get('access-control-allow-origin')).not.toBe('*');
    expect(r.headers.get('vary')).toContain('Origin');

    const cards = (await (await fetch(`${h.url}/agents`)).json()) as { cards: Array<{ agent_name: string }> };
    expect(cards.cards.map((c) => c.agent_name)).toEqual(['a1']);
  });

  it('Origin: null 与非白名单 OPTIONS → 403；白名单 OPTIONS → 204', async () => {
    const nullOrigin = await fetch(`${h.url}/agents/a1/revoke-key`, {
      method: 'POST',
      headers: { Origin: 'null' },
    });
    expect(nullOrigin.status).toBe(403);

    const evilOptions = await fetch(`${h.url}/agents`, { method: 'OPTIONS', headers: { Origin: EVIL } });
    expect(evilOptions.status).toBe(403);

    const okOptions = await fetch(`${h.url}/agents`, { method: 'OPTIONS', headers: { Origin: ALLOWED } });
    expect(okOptions.status).toBe(204);
    expect(okOptions.headers.get('access-control-allow-origin')).toBe(ALLOWED);
  });
});
