// MCP 客户端配置读写 · node 层（批次15，仅 Electron 主进程使用）。
// 只做三件事：① 读已知客户端配置判断接入状态；② 生成含令牌的配置片段（仅返回给受信渲染层，绝不写日志）；
// ③ 对已知结构的 JSON/TOML 客户端做「备份 + 合并 + 原子替换」；未知格式只读或只给片段。
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import {
  MCP_CLIENT_SPECS, MCP_ENDPOINT, mergeMcpJsonConfig, mergeMcpTomlConfig, probeClientConfig,
  renderMcpSnippet, specOfMcpClient, type McpClientSpec, type McpWireState,
} from '../agentOnboard/mcpClients.ts';
import type { BadgeClass } from '../types/agentOnboard.ts';

/** 单文件读取上限：超过视为异常配置（.claude.json 正常可达数 MB） */
const MAX_CONFIG_BYTES = 8 * 1024 * 1024;

/** 批次26-B P2-15：每个配置文件最多保留的备份份数（备份含明文令牌，不能无限累积） */
const MAX_BACKUPS_PER_CONFIG = 3;

/** 清理旧备份（按文件名时间戳倒序，保留最新 MAX_BACKUPS_PER_CONFIG 份）；失败只静默，不影响写入 */
function pruneOldBackups(path: string): void {
  try {
    const base = basename(path);
    const stale = readdirSync(dirname(path))
      .filter((f) => f.startsWith(`${base}.bak-`))
      .sort()
      .reverse()
      .slice(MAX_BACKUPS_PER_CONFIG);
    for (const f of stale) rmSync(join(dirname(path), f), { force: true });
  } catch {
    /* 清理失败不影响本次写入 */
  }
}

export interface McpClientStatus {
  id: string;
  name: string;
  badge: BadgeClass;
  format: McpClientSpec['format'];
  writable: boolean;
  /** 配置文件的展示路径（~ 开头）；null = 该客户端无稳定路径 */
  displayPath: string | null;
  /** 展开后的真实路径（local），仅本机展示/写回用 */
  path: string | null;
  installed: boolean;
  state: McpWireState;
  hasAuth: boolean;
  foundUrl?: string;
  rulesHint: string;
  note?: string;
  error?: string;
}

export interface McpClientsScan {
  endpoint: string;
  home: string;
  scannedAt: number;
  clients: McpClientStatus[];
}

export interface McpWireResult {
  ok: boolean;
  changed?: boolean;
  path?: string;
  backupPath?: string;
  state?: McpWireState;
  error?: string;
}

/** ~ → home；%APPDATA%/ → Roaming；其它相对路径按 home 拼接 */
export function expandHome(
  rel: string,
  home = homedir(),
  appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming'),
): string {
  if (rel === '~') return home;
  if (rel.startsWith('~/')) return join(home, rel.slice(2));
  if (rel.startsWith('%APPDATA%/')) return join(appData, rel.slice('%APPDATA%/'.length));
  return join(home, rel);
}

function readConfig(path: string): { text: string | null; error?: string } {
  try {
    const text = readFileSync(path, 'utf8');
    if (Buffer.byteLength(text, 'utf8') > MAX_CONFIG_BYTES) return { text: null, error: '配置文件超过 8 MiB，拒绝读取/写入' };
    return { text };
  } catch (e) {
    if ((e as { code?: string }).code === 'ENOENT') return { text: null };
    return { text: null, error: String((e as Error)?.message ?? e) };
  }
}

/** 从配置文本提取本服务条目里存的 Bearer 令牌（不返回给渲染层，仅用于与当前令牌比对）；取不到返回 null */
function extractStoredBearer(format: McpClientSpec['format'], text: string | null, serverKey: string): string | null {
  if (text === null) return null;
  if (format === 'json') {
    try {
      const parsed = JSON.parse(text) as { mcpServers?: Record<string, { headers?: Record<string, unknown> }> };
      const headers = parsed.mcpServers?.[serverKey]?.headers;
      const v = headers?.Authorization ?? headers?.authorization;
      return typeof v === 'string' ? v.replace(/^Bearer\s+/i, '').trim() : null;
    } catch {
      return null;
    }
  }
  if (format === 'toml') {
    const esc = serverKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sec = new RegExp(`\\[mcp_servers\\.${esc}\\]([\\s\\S]*?)(?=\\n\\[|$)`).exec(text)?.[1] ?? '';
    return /Authorization\s*=\s*"Bearer\s+([^"]+)"/i.exec(sec)?.[1]?.trim() ?? null;
  }
  return null;
}

/** 批次30：召回审计证据 —— configPath 为 null（配置存应用内部，如 Zcode）或文件扫不到的客户端，
 *  只要有「以本客户端身份真实调用过 MCP」的审计行，即如实升级为已接入（能带着有效令牌成功召回 = 真接通）。 */
export interface McpRecallEvidence {
  ts: number;
  /** recall 审计 detail.client（如 `zcode/0.16.9`、`dsh-mcp-client/0.0.1`）；非字符串忽略 */
  client?: unknown;
}

/** 审计证据升级（纯函数，原地修改 clients）：只升级 manual / no_config / missing_entry /
 *  missing_auth 四态；conflict / invalid 表示配置文件真实存在但内容有错——审计不能替代修复，保持原状。 */
export function applyRecallEvidence(clients: McpClientStatus[], recalls: readonly McpRecallEvidence[]): void {
  if (recalls.length === 0) return;
  const counts = new Map<string, { n: number; last: number }>();
  for (const r of recalls) {
    const name = typeof r.client === 'string' ? r.client.split('/')[0].trim().toLowerCase() : '';
    if (!name) continue;
    const cur = counts.get(name) ?? { n: 0, last: 0 };
    cur.n++;
    cur.last = Math.max(cur.last, r.ts);
    counts.set(name, cur);
  }
  for (const c of clients) {
    if (c.state === 'wired' || c.state === 'conflict' || c.state === 'invalid') continue;
    const spec = MCP_CLIENT_SPECS.find((s) => s.id === c.id);
    if (!spec) continue;
    const ids = [spec.id, ...(spec.auditClientIds ?? [])].map((s) => s.toLowerCase());
    const ev = ids.map((id) => counts.get(id)).find((v) => v && v.n > 0);
    if (!ev) continue;
    const last = new Date(ev.last).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
    c.state = 'wired';
    c.hasAuth = true;
    c.error = undefined;
    c.note = `审计检测到真实调用 ${ev.n} 次（最近 ${last}，UTC+08:00）——配置存应用内部无法读取文件，以审计为准`;
  }
}

/** 只读扫描：真实读取每个已知客户端的配置文件，按内容判定接入状态（不返回令牌）。
 *  传入 currentToken 时，「已接入」还要求配置里的令牌与当前 mcp-token.txt 一致——
 *  令牌轮换/数据根迁移后旧配置会静默 401，此处降级为 missing_auth 让一键适配可修复。 */
export function scanMcpClients(options: {
  home?: string; appData?: string; endpoint?: string; currentToken?: string;
  recallEvidence?: readonly McpRecallEvidence[];
} = {}): McpClientsScan {
  const home = options.home ?? homedir();
  const appData = options.appData ?? process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
  const endpoint = options.endpoint ?? MCP_ENDPOINT;
  const clients: McpClientStatus[] = MCP_CLIENT_SPECS.map((spec) => {
    const path = spec.configPath ? expandHome(spec.configPath, home, appData) : null;
    const installed = path !== null && existsSync(path)
      || spec.installMarkers.some((m) => existsSync(expandHome(m, home, appData)));
    const base = {
      id: spec.id, name: spec.name, badge: spec.badge, format: spec.format, writable: spec.writable,
      displayPath: spec.configPath ?? null, path, installed, rulesHint: spec.rulesHint,
      ...(spec.note ? { note: spec.note } : {}),
    };
    if (!path) return { ...base, state: 'manual' as const, hasAuth: false };
    const read = readConfig(path);
    if (read.error) return { ...base, state: 'invalid' as const, hasAuth: false, error: read.error };
    const probe = probeClientConfig(spec, read.text, endpoint);
    let state = probe.state;
    let note = spec.note;
    if (state === 'wired' && options.currentToken) {
      const stored = extractStoredBearer(spec.format, read.text, spec.serverKey);
      if (stored !== null && stored !== options.currentToken.trim()) {
        state = 'missing_auth';
        note = `${spec.note ? `${spec.note}；` : ''}配置中的令牌与当前 mcp-token.txt 不一致（可能已轮换），一键适配可自动补齐`;
      }
    }
    return {
      ...base,
      state,
      hasAuth: probe.hasAuth,
      ...(note !== undefined ? { note } : {}),
      ...(probe.foundUrl ? { foundUrl: probe.foundUrl } : {}),
      ...(probe.error ? { error: probe.error } : {}),
    };
  });
  // 批次28-B：宿主继承 —— 无独立 MCP 配置面的客户端随宿主 mcpServers 下发（如 deepseek harness 随 Qoder），
  // 接入状态如实取宿主扫描结果；宿主未接入时给出「一键适配宿主即自动接通」的指引，不伪造已接入。
  const byId = new Map(clients.map((c) => [c.id, c]));
  for (const spec of MCP_CLIENT_SPECS) {
    if (!spec.inheritsFrom) continue;
    const host = byId.get(spec.inheritsFrom);
    const self = byId.get(spec.id);
    if (!host || !self) continue;
    if (host.state === 'wired') {
      self.state = 'wired';
      self.hasAuth = true;
      self.error = undefined;
      self.note = `MCP 由宿主 ${host.name} 下发（宿主已接入，配置 ${host.displayPath ?? '宿主配置'}）——宿主接通即生效`;
    } else {
      self.note = `宿主 ${host.name} 尚未接入本服务 —— 对宿主执行一键接入后，本客户端自动接通（无需单独配置）`;
    }
  }
  // 批次30：召回审计证据升级 —— 文件扫不到但真实调用过的客户端（如 Zcode 配置存应用内部）如实显示已接入
  applyRecallEvidence(clients, options.recallEvidence ?? []);
  return { endpoint, home, scannedAt: Date.now(), clients };
}

/** 生成含令牌的片段（调用方必须是受信渲染层；本函数不写日志、不落盘） */
export function snippetForClient(id: string, token: string, endpoint = MCP_ENDPOINT): string {
  const spec = specOfMcpClient(id);
  return renderMcpSnippet(spec, endpoint, token);
}

/**
 * 一键接入/修复：支持已知结构的 JSON 与 TOML 客户端（批次23 起含 Codex / Gemini / Qwen）。
 *  · 先按真实内容判定；conflict/invalid 一律拒绝（不覆盖别人的条目、不改坏文件）
 *  · 已接入 → changed=false（不重写）；传 currentToken 时令牌过期也视为待修复（降级重写补齐）
 *  · 需要写入 → 备份原文件（.bak-<ISO>）+ 临时文件 + rename 原子替换
 */
export function wireMcpClient(
  id: string, token: string,
  options: { home?: string; appData?: string; endpoint?: string; currentToken?: string; now?: number } = {},
): McpWireResult {
  const spec = specOfMcpClient(id);
  // 批次28-B：宿主继承客户端（configPath=null + inheritsFrom）的一键接入 = 委托宿主真实写入，
  // 宿主配置文件接通后本客户端随宿主下发自动生效 —— 不让用户手工配置。
  if (!spec.configPath && spec.inheritsFrom) {
    return wireMcpClient(spec.inheritsFrom, token, options);
  }
  if (!spec.configPath || !spec.writable) {
    return { ok: false, error: '该客户端不支持自动写入（请复制配置片段后手工添加）' };
  }
  const home = options.home ?? homedir();
  const appData = options.appData ?? process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
  const endpoint = options.endpoint ?? MCP_ENDPOINT;
  const path = expandHome(spec.configPath, home, appData);
  const read = readConfig(path);
  if (read.error) return { ok: false, error: read.error };
  const probe = probeClientConfig(spec, read.text, endpoint);
  if (probe.state === 'conflict') {
    return { ok: false, state: probe.state, error: `同名条目指向其它端点（${probe.foundUrl ?? '未填写'}），拒绝覆盖` };
  }
  if (probe.state === 'invalid') {
    return { ok: false, state: probe.state, error: `配置文件无法解析：${probe.error ?? '格式错误'}` };
  }
  if (probe.state === 'wired') {
    // 批次27：传了 currentToken 且配置内的令牌已过期 → 不短路，继续走合并把令牌补成当前值
    const stale = options.currentToken !== undefined
      && extractStoredBearer(spec.format, read.text, spec.serverKey) !== options.currentToken.trim();
    if (!stale) return { ok: true, changed: false, path, state: probe.state };
  }

  let merged: { text: string; changed: boolean };
  try {
    merged = spec.format === 'toml'
      ? mergeMcpTomlConfig(read.text, spec, endpoint, token)
      : mergeMcpJsonConfig(read.text, spec, endpoint, token);
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
  if (!merged.changed) return { ok: true, changed: false, path, state: probe.state };

  const existed = existsSync(path);
  let backupPath: string | undefined;
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    if (existed) {
      const stamp = new Date(options.now ?? Date.now()).toISOString().replace(/[:.]/g, '-');
      backupPath = `${path}.bak-${stamp}`;
      copyFileSync(path, backupPath);
    }
    writeFileSync(tmp, merged.text, 'utf8');
    renameSync(tmp, path);
  } catch (e) {
    // 批次26-B P2-15：写入失败清掉半成品临时文件（残留的 .tmp 含合并结果，不留给调用方收拾）
    try { rmSync(tmp, { force: true }); } catch { /* 已不存在或被占用：忽略 */ }
    return { ok: false, path, error: `写入失败：${String((e as Error)?.message ?? e)}` };
  }
  pruneOldBackups(path);
  return { ok: true, changed: true, path, ...(backupPath ? { backupPath } : {}), state: 'wired' };
}

export { MCP_ENDPOINT };
