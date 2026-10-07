// Agent 接入真实后端（REQ-003 接真实后端 · T13）
// node:http + node:fs。把 AgentOnboardService 暴露为 HTTP 服务 + JSON 文件持久化。
// 业务内核（校验/状态机/审计）全部复用 AgentOnboardService，不重复实现。
//
// 端点：
//   POST   /agents                     configure
//   POST   /agents/:name/test          testConnect
//   POST   /agents/:name/rotate-key    rotateKey
//   POST   /agents/:name/revoke-keyrevokeKey
//   POST   /discover                   oneClickOnboard
//   DELETE /agents/:name               revokeBind
//   GET    /audit                      getAudit
//   GET    /agents                     getCards（初始加载即显示已有卡片）
import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentOnboardService, type AuditEntry, type DiscoverInput } from './service.ts';
import type { AgentCard, AgentCardInput, Form } from '../types/agentOnboard.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_FILE = join(__dirname, '..', '..', '.data', 'agent-onboard.json');

interface PersistedState {
  cards: Record<string, AgentCard>;
  audit: AuditEntry[];
}

function loadState(dataFile: string): PersistedState {
  try {
    if (existsSync(dataFile)) {
      const raw = JSON.parse(readFileSync(dataFile, 'utf-8')) as Partial<PersistedState>;
      return { cards: raw.cards || {}, audit: raw.audit || [] };
    }
  } catch {
    /* 损坏则忽略，从空开始 */
  }
  return { cards: {}, audit: [] };
}

export interface RunningServer {
  server: http.Server;
  service: AgentOnboardService;
  url: string;
  port: number;
  stop: () => Promise<void>;
}

/**
 * 创建 Agent 接入后端服务。
 * @param opts.port 监听端口（0 = 随机）
 * @param opts.dataFile JSON 持久化文件路径
 */
export function createServer({ port = 0, dataFile = DEFAULT_DATA_FILE }: { port?: number; dataFile?: string } = {}): Promise<RunningServer> {
  const service = new AgentOnboardService();
  const saved = loadState(dataFile);
  for (const [k, v] of Object.entries(saved.cards)) service.cards.set(k, v);
  service.audit = saved.audit;

  const persist = (): void => {
    mkdirSync(dirname(dataFile), { recursive: true });
    writeFileSync(dataFile, JSON.stringify(
      { cards: Object.fromEntries(service.cards.entries()), audit: service.audit },
      null, 2,
    ));
  };

  const server = http.createServer(async (req, res) => {
    // CORS：前端静态页（另一端口/源）需跨域调本服务；预检 OPTIONS 直接放行。
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    let body: Record<string, unknown> = {};
    if (req.method === 'POST' || req.method === 'DELETE') {
      try {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const text = Buffer.concat(chunks).toString('utf-8');
        if (text) body = JSON.parse(text);
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'invalid_json' }));
        return;
      }
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean); // ['agents', ':name', 'test']

    let out: any;
    try {
      if (req.method === 'POST' && parts[0] === 'agents' && parts.length === 1) {
        out = service.configure(body as unknown as AgentCardInput);
      } else if (req.method === 'POST' && parts[0] === 'agents' && parts[2] === 'test') {
        out = service.testConnect(decodeURIComponent(parts[1]));
      } else if (req.method === 'POST' && parts[0] === 'agents' && parts[2] === 'rotate-key') {
        out = service.rotateKey(decodeURIComponent(parts[1]));
      } else if (req.method === 'POST' && parts[0] === 'agents' && parts[2] === 'revoke-key') {
        out = service.revokeKey(decodeURIComponent(parts[1]));
      } else if (req.method === 'POST' && parts[0] === 'discover') {
        out = service.oneClickOnboard((body.agents ?? []) as DiscoverInput[], body.form as Form);
      } else if (req.method === 'DELETE' && parts[0] === 'agents' && parts.length === 2) {
        out = service.revokeBind(decodeURIComponent(parts[1]));
      } else if (req.method === 'GET' && parts[0] === 'audit') {
        out = { ok: true, audit: service.getAudit() };
      } else if (req.method === 'GET' && parts[0] === 'agents' && parts.length === 1) {
        out = { ok: true, cards: [...service.cards.values()] };
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ ok: false, error: 'not_found' }));
        return;
      }
    } catch (e) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) }));
      return;
    }

    if (out && !out.ok && (out.violations || out.reason)) res.statusCode = 422;
    persist();
    res.end(JSON.stringify(out));
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      const addr = server.address() as { port: number };
      resolve({
        server,
        service,
        port: addr.port,
        url: `http://localhost:${addr.port}`,
        stop: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}