// Agent 接入真实后端（REQ-003 接真实后端 · T13）
// 零依赖：node:http + node:fs。把 AgentOnboardService 暴露为 HTTP 服务 + JSON 文件持久化。
// 业务内核（校验/状态机/审计）全部复用 AgentOnboardService，不重复实现。
//
// 端点：
//   POST   /agents                 configure
//   POST   /agents/:name/test      testConnect
//   POST   /agents/:name/rotate-key   rotateKey
//   POST   /agents/:name/revoke-key  revokeKey
//   POST   /discover               oneClickOnboard
//   DELETE /agents/:name           revokeBind
//   GET    /audit                  getAudit
import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentOnboardService } from './service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_FILE = join(__dirname, '..', '..', '.data', 'agent-onboard.json');

function loadState(dataFile) {
  try {
    if (existsSync(dataFile)) {
      const raw = JSON.parse(readFileSync(dataFile, 'utf-8'));
      return { cards: raw.cards || {}, audit: raw.audit || [] };
    }
  } catch {
    /* 损坏则忽略，从空开始 */
  }
  return { cards: {}, audit: [] };
}

/**
 * 创建 Agent 接入后端服务。
 * @param {{port?:number, dataFile?:string}} [opts]
 * @returns {Promise<{server: import('node:http').Server, service: AgentOnboardService, url: string, port: number, stop: () => Promise<void>}>}
 */
export function createServer({ port = 0, dataFile = DEFAULT_DATA_FILE } = {}) {
  const service = new AgentOnboardService();
  const saved = loadState(dataFile);
  for (const [k, v] of Object.entries(saved.cards)) service.cards.set(k, v);
  service.audit = saved.audit;

  const persist = () => {
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
    let body = {};
    if (req.method === 'POST' || req.method === 'DELETE') {
      try {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const text = Buffer.concat(chunks).toString('utf-8');
        if (text) body = JSON.parse(text);
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'invalid_json' }));
        return;
      }
    }

    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean); // ['agents', ':name', 'test']

    let out;
    try {
      if (req.method === 'POST' && parts[0] === 'agents' && parts.length === 1) {
        out = service.configure(body);
      } else if (req.method === 'POST' && parts[0] === 'agents' && parts[2] === 'test') {
        out = service.testConnect(decodeURIComponent(parts[1]));
      } else if (req.method === 'POST' && parts[0] === 'agents' && parts[2] === 'rotate-key') {
        out = service.rotateKey(decodeURIComponent(parts[1]));
      } else if (req.method === 'POST' && parts[0] === 'agents' && parts[2] === 'revoke-key') {
        out = service.revokeKey(decodeURIComponent(parts[1]));
      } else if (req.method === 'POST' && parts[0] === 'discover') {
        out = service.oneClickOnboard(body.agents || [], body.form);
      } else if (req.method === 'DELETE' && parts[0] === 'agents' && parts.length === 2) {
        out = service.revokeBind(decodeURIComponent(parts[1]));
      } else if (req.method === 'GET' && parts[0] === 'audit') {
        out = { ok: true, audit: service.getAudit() };
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ ok: false, error: 'not_found' }));
        return;
      }
    } catch (e) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
      return;
    }

    if (out && !out.ok && (out.violations || out.reason)) res.statusCode = 422;
    persist();
    res.end(JSON.stringify(out));
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      const addr = server.address();
      resolve({
        server,
        service,
        port: addr.port,
        url: `http://localhost:${addr.port}`,
        stop: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
