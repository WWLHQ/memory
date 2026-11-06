// Agent 接入真实后端（REQ-003 接真实后端 · T13）
// node:http + node:fs。把 AgentOnboardService 暴露为 HTTP 服务 + JSON 文件持久化。
// 业务内核（校验/状态机/审计）全部复用 AgentOnboardService，不重复实现。
//
// 端点：
//   POST   /agents                     configure
//   POST   /agents/:name/test          testConnect
//   POST   /agents/:name/rotate-key    rotateKey（需管理员会话）
//   POST   /agents/:name/revoke-key    revokeKey（需管理员会话）
//   POST   /discover                   oneClickOnboard
//   DELETE /agents/:name               revokeBind（需管理员会话）
//   GET    /audit                      getAudit（出站脱敏本机路径）
//   GET    /agents                     getCards（初始加载即显示已有卡片）
// 信任边界（批次26-A P0-5）：写端点要求 x-session-id 真实会话（getSession 校验；缺省会话真源=fail-closed 全拒）。
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentOnboardService, type AgentProbe, type AuditEntry, type DiscoverInput } from './service.ts';
import { createHostAgentProbe } from './probe.ts';
import { createOriginPolicy, rejectUntrustedOrigin, rejectUntrustedHost, applyCorsHeaders } from '../shared/localOrigin.ts';
import type { AgentCard, AgentCardInput, Form } from '../types/agentOnboard.ts';
import type { TenantContext } from '../types/home.ts';

// CJS bundle 下 __dirname 是 Node 全局；ESM 下用 import.meta.url 计算
const _dirname = typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_FILE = join(_dirname, '..', '..', '.data', 'agent-onboard.json');

interface PersistedState {
  cards: Record<string, AgentCard>;
  audit: AuditEntry[];
}

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * 密钥脱敏：任何出站/落盘卡片都不得携带明文。
 * 兼容旧账本：若发现历史明文，改为保存哈希 + 尾号（并在启动时重写文件，清除磁盘明文）。
 */
function sanitizeCard(card: AgentCard): AgentCard {
  if (typeof card.apiKeyPlaintext === 'string' && card.apiKeyPlaintext) {
    if (!card.keyHash) card.keyHash = sha256Hex(card.apiKeyPlaintext);
    if (!card.keyTail) card.keyTail = card.apiKeyPlaintext.slice(-4);
  }
  if (card.apiKeyPlaintext !== undefined) card.apiKeyPlaintext = null;
  return card;
}

/** /audit 出站脱敏（批次26-A P0-5）：本机安装路径不外泄（probe 失败 reason 可能含盘符路径） */
const WIN_PATH_RE = /[A-Za-z]:\\[^\s"',}\]}，；、）]+/g;
const UNIX_PATH_RE = /(^|[^A-Za-z0-9/.~])(\/(?:home|Users|usr\/local|opt|var\/lib)\/[^\s"',}\]}，；、）]+)/g;
function sanitizeText(v: string): string {
  return v.replace(WIN_PATH_RE, '<本机路径>').replace(UNIX_PATH_RE, (_m, pre: string) => `${pre}<本机路径>`);
}
function sanitizeAuditEntries(entries: AuditEntry[]): AuditEntry[] {
  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === 'string') return sanitizeText(v);
    if (Array.isArray(v) && depth < 4) return v.map((x) => walk(x, depth + 1));
    if (v && typeof v === 'object' && depth < 4) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x, depth + 1)]));
    }
    return v;
  };
  return entries.map((e) => walk(e, 0) as AuditEntry);
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
 * @param opts.allowedOrigins 额外放行的浏览器来源（Electron 静态服务端口、E2E 静态服务端口）
 * @param opts.allowDevOrigins 是否放行 Vite dev server 源（仅本地开发入口开启）
 * @param opts.maxBodyBytes 请求体上限（字节），缺省 1 MiB
 * @param opts.probe 真实拨测（缺省 = 本机安装痕迹探测；测试可注入 fake）
 */
export function createServer({
  port = 0,
  dataFile = DEFAULT_DATA_FILE,
  allowedOrigins = [],
  allowDevOrigins = false,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  probe,
  onLog,
  getSession,
}: {
  port?: number;
  dataFile?: string;
  allowedOrigins?: string[];
  allowDevOrigins?: boolean;
  maxBodyBytes?: number;
  probe?: AgentProbe;
  /** 动作日志回调（批次7）：主进程写入 actions.log；缺省静默。绝不记录请求体（含密钥） */
  onLog?: (scope: string, action: string, detail?: Record<string, unknown>) => void;
  /** 会话真源（批次26-A P0-5）：写端点以 x-session-id 校验；缺省=无法校验 → 写端点一律拒绝（fail-closed） */
  getSession?: (sid: string | undefined) => TenantContext | null;
} = {}): Promise<RunningServer> {
  const log = onLog ?? (() => {});
  const service = new AgentOnboardService(null, { probe: probe ?? createHostAgentProbe(), keyHasher: sha256Hex });
  const saved = loadState(dataFile);
  let legacyPlaintext = false;
  for (const [k, raw] of Object.entries(saved.cards)) {
    if (typeof raw.apiKeyPlaintext === 'string' && raw.apiKeyPlaintext) legacyPlaintext = true;
    service.cards.set(k, sanitizeCard(raw));
  }
  service.audit = saved.audit;

  const persist = (): void => {
    mkdirSync(dirname(dataFile), { recursive: true });
    writeFileSync(dataFile, JSON.stringify(
      {
        cards: Object.fromEntries([...service.cards.entries()].map(([k, c]) => [k, sanitizeCard(c)])),
        audit: service.audit,
      },
      null, 2,
    ));
  };
  // 旧账本含明文 → 立即重写，清除磁盘上的历史明文（哈希/尾号已迁移）
  if (legacyPlaintext) persist();

  const originPolicy = createOriginPolicy(allowedOrigins, { allowDev: allowDevOrigins });
  const server = http.createServer(async (req, res) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      log('onboarding', 'http', {
        method: req.method ?? '?',
        path: (req.url ?? '/').split('?')[0],
        status: res.statusCode,
        ms: Date.now() - startedAt,
      });
    });
    // CORS：仅回显白名单来源；带 Origin 的非白名单请求 403（防任意网页撤销密钥/改卡）
    applyCorsHeaders(req, res, originPolicy);
    if (rejectUntrustedOrigin(req, res, originPolicy)) {
      // 批次22：记录被拒来源，排查「指标不刷新」实为来源白名单拦截
      log('onboarding', 'origin_rejected', {
        origin: req.headers.origin ?? 'null',
        method: req.method ?? '?',
        path: (req.url ?? '/').split('?')[0],
      });
      return;
    }
    // 批次26-B P2-16：Host 头绑定 —— Host 必须是本机回环地址 + 本服务实际端口（防 DNS rebinding）
    const addr = server.address();
    const hostPort = addr && typeof addr === 'object' ? addr.port : port;
    if (rejectUntrustedHost(req, res, [hostPort])) {
      log('onboarding', 'host_rejected', {
        host: req.headers.host ?? 'none',
        method: req.method ?? '?',
        path: (req.url ?? '/').split('?')[0],
      });
      return;
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-id');
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
        let size = 0;
        for await (const c of req) {
          const buf = c as Buffer;
          size += buf.length;
          if (size > maxBodyBytes) {
            res.statusCode = 413;
            res.end(JSON.stringify({ ok: false, error: 'payload_too_large' }));
            return;
          }
          chunks.push(buf);
        }
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

    // 批次26-A P0-5：写端点会话闸门（x-session-id 经 home server 会话真源校验；不信任渲染层自报角色）。
    // 未接会话真源（getSession 缺省）= 无法校验 → 写端点一律拒绝（fail-closed，绝不退回匿名可写）。
    let requestCtx: TenantContext | null = null;
    if (req.method === 'POST' || req.method === 'DELETE') {
      const sidHeader = req.headers['x-session-id'];
      const sid = Array.isArray(sidHeader) ? sidHeader[0] : sidHeader;
      const ctx = getSession ? getSession(sid) : null;
      requestCtx = ctx;
      const destructive = req.method === 'DELETE'
        || (req.method === 'POST' && parts[0] === 'agents' && (parts[2] === 'rotate-key' || parts[2] === 'revoke-key'));
      if (!ctx) {
        log('onboarding', 'auth_rejected', { path: url.pathname, method: req.method, reason: 'no_session' });
        res.statusCode = 401;
        res.end(JSON.stringify({ ok: false, error: '需要登录后操作（会话缺失或已过期）' }));
        return;
      }
      if (destructive && ctx.role !== 'admin') {
        log('onboarding', 'auth_rejected', { path: url.pathname, method: req.method, reason: 'admin_required', user_id: ctx.user_id });
        res.statusCode = 403;
        res.end(JSON.stringify({ ok: false, error: '轮换/撤销密钥与删除卡片需管理员账号' }));
        return;
      }
    }

    // A29：租户归属随会话写入卡片与审计（请求处理内先设置，避免跨请求串租户）
    service.setTenant(requestCtx
      ? { enterprise_id: requestCtx.enterprise_id, team_id: requestCtx.team_id }
      : undefined);
    // A29 并发版本校验：body.expectedRev 或 ?rev= 显式传入才校验（旧调用方不受影响）
    const revRaw = body.expectedRev ?? url.searchParams.get('rev');
    const revNum = revRaw === undefined || revRaw === null || revRaw === '' ? NaN : Number(revRaw);
    const revArg = Number.isFinite(revNum) ? revNum : undefined;

    let out: any;
    try {
      if (req.method === 'POST' && parts[0] === 'agents' && parts.length === 1) {
        out = service.configure({
          ...(body as unknown as AgentCardInput),
          ...(revArg !== undefined ? { expectedRev: revArg } : {}),
        });
      } else if (req.method === 'POST' && parts[0] === 'agents' && parts[2] === 'test') {
        out = service.testConnect(decodeURIComponent(parts[1]), revArg);
      } else if (req.method === 'POST' && parts[0] === 'agents' && parts[2] === 'rotate-key') {
        out = service.rotateKey(decodeURIComponent(parts[1]), revArg);
      } else if (req.method === 'POST' && parts[0] === 'agents' && parts[2] === 'revoke-key') {
        out = service.revokeKey(decodeURIComponent(parts[1]), revArg);
      } else if (req.method === 'POST' && parts[0] === 'discover') {
        out = service.oneClickOnboard((body.agents ?? []) as DiscoverInput[], body.form as Form);
      } else if (req.method === 'DELETE' && parts[0] === 'agents' && parts.length === 2) {
        out = service.revokeBind(decodeURIComponent(parts[1]), revArg);
      } else if (req.method === 'GET' && parts[0] === 'audit') {
        // 批次26-A P0-5：出站前脱敏（probe 失败 reason 可能含本机安装路径）
        out = { ok: true, audit: sanitizeAuditEntries(service.getAudit()) };
      } else if (req.method === 'GET' && parts[0] === 'agents' && parts.length === 1) {
        out = { ok: true, cards: [...service.cards.values()].map(sanitizeCard) };
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

    if (out && !out.ok && out.reason === 'version_conflict') res.statusCode = 409;
    else if (out && !out.ok && (out.violations || out.reason)) res.statusCode = 422;
    persist();
    res.end(JSON.stringify(out));
  });

  return new Promise((resolve, reject) => {
    server.on('error', (err: NodeJS.ErrnoException) => {
      // EADDRINUSE：端口被占 → 不静默挂起（旧 bug：promise 永不 settle，bootstrap 卡死），
      // 上抛给 bootstrap 的 catch 走诊断日志。
      reject(new Error(`agentOnboard server port ${port}: ${err.message} (${err.code})`));
    });
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
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