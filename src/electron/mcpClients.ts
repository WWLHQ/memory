// MCP 客户端配置读写 · node 层（批次15，仅 Electron 主进程使用）。
// 只做三件事：① 读已知客户端配置判断接入状态；② 生成含令牌的配置片段（仅返回给受信渲染层，绝不写日志）；
// ③ 对已知结构的 JSON/TOML 客户端做「备份 + 合并 + 原子替换」；未知格式只读或只给片段。
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import {
  MCP_CLIENT_HEADER_NAME, MCP_CLIENT_SPECS, MCP_ENDPOINT, mergeMcpJsonConfig, mergeMcpTomlConfig,
  mergeMcpYamlConfig,
  normalizeConfigText, probeClientConfig, renderMcpSnippet, specOfMcpClient,
  type McpClientSpec, type McpStdioTarget, type McpTransport, type McpWireState,
} from '../agentOnboard/mcpClients.ts';
import type { BadgeClass } from '../types/agentOnboard.ts';
import type { LiveProbeFields } from './mcpProbe.ts';

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

/** 备份 + 临时文件 + rename 原子替换（一键接入与一键打开共用同一条写入路径）。
 *  失败时清掉半成品临时文件；令牌只存在于配置文本里，绝不进返回值或日志。 */
function writeConfigAtomically(
  path: string, text: string, now: number,
): { ok: true; backupPath?: string } | { ok: false; error: string } {
  const existed = existsSync(path);
  let backupPath: string | undefined;
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    if (existed) {
      const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
      backupPath = `${path}.bak-${stamp}`;
      copyFileSync(path, backupPath);
    }
    writeFileSync(tmp, text, 'utf8');
    renameSync(tmp, path);
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* 已不存在或被占用：忽略 */ }
    return { ok: false, error: `写入失败：${String((e as Error)?.message ?? e)}` };
  }
  pruneOldBackups(path);
  return { ok: true, ...(backupPath ? { backupPath } : {}) };
}

export interface McpClientStatus extends LiveProbeFields {
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
  /** 安装依据：config=配置文件真存在；marker=只剩安装痕迹目录（可能已卸载/残留）；none=未安装 */
  installEvidence: 'config' | 'marker' | 'none';
  state: McpWireState;
  hasAuth: boolean;
  /** 条目承载方式：stdio=配置里只有启动命令（令牌零维护）/ http=令牌抄在配置里（轮换需重写） */
  transport?: McpTransport;
  /** 批次41-X：配置里是否带显式身份头 `X-Memagent-Client`。
   *  `false` = 条目已接入但缺身份头（41-X 之前写入的老配置）→ 可点「补身份头」重新写入；
   *  `undefined` = 无从判定（无稳定配置文件、审计升级来的）。 */
  hasClientId?: boolean;
  /** 条目里实际读到、但与本客户端 id 不符的身份头值（2026-11-28：Zcode 配置里曾写成 deepseek-harness，
   *  服务端会把调用记到别的客户端名下）——UI 据此显示「不符」而不是笼统的「缺失」。不含凭据。 */
  foundClientId?: string;
  /** 配置文件原本带 BOM/JSONC 注释/尾逗号，读取时无损规范化后才能解析。
   *  `true` = 一键接入会把规范化结果固化写回（自动备份原文件），用户不用手工改。 */
  repairable?: boolean;
  /** 客户端应用内把本服务标成已禁用：只有读到显式布尔 true 才为 true。
   *  独立维度，不改 state 七态；UI 必须优先用它判「开关关了」，不能只看 wired。 */
  disabled?: boolean;
  /** 客户端软件当前是否在运行（T6 新增）：仅对有稳定桌面进程的客户端给布尔值；
   *  CLI（Claude/Codex/Gemini/Qwen）与无稳定进程的客户端缺省（undefined）→ UI 不显示，避免误报。 */
  running?: boolean;
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
  /** 2026-11-18 实测连通汇总（主进程探活后回填；浏览器/未探测时缺省） */
  live?: {
    at: number;
    /** 实际探了哪些客户端（同令牌去重后仍按客户端计数） */
    checked: number;
    /** 探不通的数量（401/超时/连接失败） */
    failed: number;
    /** 用当前 mcp-token.txt 探服务端本身的结果 */
    server?: import('./mcpProbe.ts').McpLiveProbe;
  };
}

export interface McpWireResult {
  ok: boolean;
  changed?: boolean;
  path?: string;
  backupPath?: string;
  state?: McpWireState;
  /** 一键接入时自动修复了配置格式（BOM/注释/尾逗号）并固化写回 */
  repaired?: boolean;
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

/**
 * 读取配置文本，并在严格 JSON.parse 失败时尝试**无损规范化**：
 * UTF-8 BOM / JSONC 注释 / 尾逗号是客户端与编辑器常见写法，JSON.parse 不接受但语义无损，
 * 规范化后能解析成功即视为可一键修复（返回 normalized 文本 + 标记，不在此处写盘）。
 * 真语法错误（如 `{bad`）规范化不会改变文本 → 仍返回原文，probe 如实判 invalid。
 * TOML 不做此变换（probeTomlConfig 是正则式读取，BOM 不影响段匹配）。
 */
function readConfig(path: string, format: McpClientSpec['format']): {
  text: string | null; error?: string; normalized?: boolean;
} {
  try {
    const text = readFileSync(path, 'utf8');
    if (Buffer.byteLength(text, 'utf8') > MAX_CONFIG_BYTES) return { text: null, error: '配置文件超过 8 MiB，拒绝读取/写入' };
    if (format === 'json' && text) {
      try {
        JSON.parse(text);
      } catch {
        const fixed = normalizeConfigText(text);
        if (fixed.changed) {
          try {
            JSON.parse(fixed.text);
            return { text: fixed.text, normalized: true };
          } catch { /* 规范化后仍不合法 → 保持原文，交 probe 判 invalid */ }
        }
      }
    }
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
  if (format === 'yaml') {
    // 插件式 YAML（deepseek harness）：令牌可能写成 `Authorization: Bearer <token>`，也可能是
    // `Bearer` 换行 + 缩进令牌——两种都认，取到即返回（只用于与当前令牌比对，不外传）
    const m = /Authorization:\s*Bearer\s+([^\s#]+)/.exec(text);
    return m?.[1]?.trim() ?? null;
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
    const configExists = path !== null && existsSync(path);
    const markerExists = spec.installMarkers.some((m) => existsSync(expandHome(m, home, appData)));
    const installed = configExists || markerExists;
    // 只有残留目录也算 installed（保留旧口径），但标出依据：UI 据此把「仅痕迹」与「有配置」分组，
    // 不再让一个没装客户端的残留目录混进「已安装客户端」列表。
    const installEvidence: McpClientStatus['installEvidence'] = configExists ? 'config' : markerExists ? 'marker' : 'none';
    const base = {
      id: spec.id, name: spec.name, badge: spec.badge, format: spec.format, writable: spec.writable,
      displayPath: spec.configPath ?? null, path, installed, installEvidence, rulesHint: spec.rulesHint,
      ...(spec.note ? { note: spec.note } : {}),
    };
    if (!path) return { ...base, state: 'manual' as const, hasAuth: false };
    const read = readConfig(path, spec.format);
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
    // 批次41-X：已接入但缺显式身份头 —— 调用能通，但服务端只能按「UA → 同 UA 最近一次
    // initialize 自报名」归并识别调用方，通用 UA（Node/Electron 都是 `node`）下会跨客户端串号。
    // 状态仍是 wired（不骗「未接入」），只补一条可修复的说明。
    if (state === 'wired' && probe.hasClientId === false) {
      const wrong = probe.foundClientId
        ? `配置里写的是 ${MCP_CLIENT_HEADER_NAME}: ${probe.foundClientId}（不是本客户端 id，服务端会把调用记到别的客户端名下）`
        : `缺显式身份头 ${MCP_CLIENT_HEADER_NAME}`;
      note = `${spec.note ? `${spec.note}；` : ''}${wrong}——点「补身份头」按本客户端 id 重写`;
    }
    // stdio 零维护形态：令牌不在配置里，轮换后无需重写（这类客户端没有「令牌过期」这一说）
    if (state === 'wired' && probe.transport === 'stdio') {
      note = `${spec.note ? `${spec.note}；` : ''}stdio 零维护形态：配置里只有启动命令，令牌由桥接脚本每次现读——令牌轮换不用重写配置`;
    }
    if (read.normalized) {
      state = state === 'invalid' ? 'missing_entry' : state;
      note = `${note ? `${note}；` : ''}配置含 UTF-8 BOM/JSONC 注释/尾逗号（读取已无损规范化）：点「一键修复并接入」自动写回干净 JSON，无需手工改`;
    }
    return {
      ...base,
      state,
      hasAuth: probe.hasAuth,
      ...(read.normalized ? { repairable: true } : {}),
      ...(probe.transport ? { transport: probe.transport } : {}),
      ...(probe.hasClientId !== undefined ? { hasClientId: probe.hasClientId } : {}),
      ...(probe.foundClientId ? { foundClientId: probe.foundClientId } : {}),
      ...(probe.disabled === true ? { disabled: true } : {}),
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
      self.hasClientId = host.hasClientId;
      // 宿主怎么接的，本客户端就怎么接（宿主改 stdio，随宿主下发的客户端同样是零维护形态）
      if (host.transport) self.transport = host.transport;
      self.note = `MCP 由宿主 ${host.name} 下发（宿主已接入，配置 ${host.displayPath ?? '宿主配置'}）——宿主接通即生效`
        + (host.hasClientId === false ? `；宿主配置缺显式身份头 ${MCP_CLIENT_HEADER_NAME}，对本客户端点「补身份头」即写宿主配置` : '');
    } else {
      self.note = `宿主 ${host.name} 尚未接入本服务 —— 对宿主执行一键接入后，本客户端自动接通（无需单独配置）`;
    }
  }
  // 批次30：召回审计证据升级 —— 文件扫不到但真实调用过的客户端（如 Zcode 配置存应用内部）如实显示已接入
  applyRecallEvidence(clients, options.recallEvidence ?? []);
  // 客户端开关优先于审计证据：审计记的是「关闭之前」的真实调用，不能拿它把
  // 「现在已禁用」这件事冲掉。放在最后统一追加，宿主继承/证据升级都盖不掉。
  for (const c of clients) {
    if (c.disabled !== true) continue;
    c.note = `${c.note ? `${c.note}；` : ''}客户端开关已关闭：配置条目与令牌都在，但客户端不会挂载本服务的工具`;
  }
  return { endpoint, home, scannedAt: Date.now(), clients };
}

/** 生成片段（调用方必须是受信渲染层；本函数不写日志、不落盘）。
 *  传 stdio 时输出**不含令牌**的启动命令片段（可安全转发给同事/贴进工单）。 */
export function snippetForClient(
  id: string, token: string, endpoint = MCP_ENDPOINT, stdio?: McpStdioTarget,
): string {
  const spec = specOfMcpClient(id);
  return renderMcpSnippet(spec, endpoint, token, stdio);
}

/** 宿主继承关系（无独立配置面、随宿主下发，如 deepseek harness ← Qoder CN）；未知 id 返回 undefined。
 *  main.ts 用它给「实测连通」标口径（宿主的令牌 ⇒ via='host'）。 */
export function inheritedHostOf(id: string): string | undefined {
  try {
    return specOfMcpClient(id).inheritsFrom;
  } catch {
    return undefined;
  }
}

/**
 * 读某客户端配置里存的令牌（2026-11-18，实测连通列用）。
 * **仅主进程内部使用**：令牌只用来打一次 tools/list，绝不进 IPC 返回值、绝不落日志。
 * 无稳定配置文件（configPath=null）→ 宿主继承客户端返回宿主的令牌（deepseek harness ← Qoder，
 * 用它实测才等价于「经宿主下发后能不能调通」）；纯手工客户端（Zcode）仍返回 null，
 * UI 那时用现役令牌实测并在口径上标「片段令牌」，不冒充它自己的配置。
 */
export function readStoredToken(
  id: string, options: { home?: string; appData?: string } = {},
): string | null {
  let spec: McpClientSpec;
  try {
    spec = specOfMcpClient(id);
  } catch {
    return null;
  }
  // 无稳定配置文件：宿主继承客户端（deepseek harness ← Qoder）的令牌就是宿主的令牌，
  // 用它实测才等价于「本客户端经宿主下发后能不能调通」；纯手工客户端（Zcode）仍无令牌可读。
  if (!spec.configPath) {
    return spec.inheritsFrom ? readStoredToken(spec.inheritsFrom, options) : null;
  }
  const home = options.home ?? homedir();
  const appData = options.appData ?? process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
  const path = expandHome(spec.configPath, home, appData);
  const read = readConfig(path, spec.format);
  if (read.error) return null;
  const stored = extractStoredBearer(spec.format, read.text, spec.serverKey);
  return stored && stored.trim() ? stored.trim() : null;
}

/**
 * 一键接入/修复：支持已知结构的 JSON 与 TOML 客户端（批次23 起含 Codex / Gemini / Qwen）。
 *  · 先按真实内容判定；conflict/invalid 一律拒绝（不覆盖别人的条目、不改坏文件）
 *  · 已接入且已带显式身份头 → changed=false（不重写）；传 currentToken 时令牌过期也视为待修复（降级重写补齐）
 *  · 批次41-X：已接入但缺 X-Memagent-Client 也走合并补写该头（「补身份头」按钮的真身）
 *  · 2026-11-18 mode='stdio'：改写为零维护形态（只写启动命令，不写令牌）。已是 stdio → changed=false；
 *    当前是 http → 合并改写成 stdio（清掉 url/headers），令牌从此不进客户端配置。
 *  · 需要写入 → 备份原文件（.bak-<ISO>）+ 临时文件 + rename 原子替换
 */
export function wireMcpClient(
  id: string, token: string,
  options: {
    home?: string; appData?: string; endpoint?: string; currentToken?: string; now?: number;
    /** 'stdio' = 零维护形态；缺省 'http'（既有行为逐字不变） */
    mode?: McpTransport;
    /** stdio 必填：桥接脚本绝对路径 + 引导指针路径（令牌由脚本运行时现读） */
    bridgePath?: string; pointerPath?: string;
  } = {},
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
  const wantStdio = options.mode === 'stdio';
  let stdio: McpStdioTarget | undefined;
  if (wantStdio) {
    if (!options.bridgePath || !options.pointerPath) {
      return { ok: false, error: 'stdio 接入缺少桥接脚本或引导指针路径（内部参数不全，未写入）' };
    }
    stdio = { bridgePath: options.bridgePath, pointerPath: options.pointerPath, endpoint };
  }
  const path = expandHome(spec.configPath, home, appData);
  const read = readConfig(path, spec.format);
  if (read.error) return { ok: false, error: read.error };
  const probe = probeClientConfig(spec, read.text, endpoint);
  if (probe.state === 'conflict') {
    return { ok: false, state: probe.state, error: `同名条目指向其它端点（${probe.foundUrl ?? '未填写'}），拒绝覆盖` };
  }
  // 真语法错误（规范化后仍不合法）依旧拒绝，绝不覆盖写坏用户配置；
  // 仅 BOM/注释/尾逗号这类无损格式问题已在 readConfig 规范化并标 normalized → 继续合并写回。
  if (probe.state === 'invalid') {
    return { ok: false, state: probe.state, error: `配置文件无法解析：${probe.error ?? '格式错误'}` };
  }
  if (probe.state === 'wired' && probe.hasClientId !== false && !read.normalized) {
    if (wantStdio) {
      // 已经是零维护形态 → 无需重写
      if (probe.transport === 'stdio') return { ok: true, changed: false, path, state: probe.state };
      // 当前是 http（令牌抄在配置里）→ 继续往下合并，改写成 stdio
    } else {
      // 批次27：传了 currentToken 且配置内的令牌已过期 → 不短路，继续走合并把令牌补成当前值
      const stale = options.currentToken !== undefined
        && extractStoredBearer(spec.format, read.text, spec.serverKey) !== options.currentToken.trim();
      if (!stale) return { ok: true, changed: false, path, state: probe.state };
    }
  }

  let merged: { text: string; changed: boolean };
  try {
    merged = spec.format === 'toml'
      ? mergeMcpTomlConfig(read.text, spec, endpoint, token, stdio)
      : spec.format === 'yaml'
        ? mergeMcpYamlConfig(read.text, spec, endpoint, token)
        : mergeMcpJsonConfig(read.text, spec, endpoint, token, stdio);
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
  // 已规范化（BOM/注释/尾逗号）即便条目内容没变也要写回：否则 BOM 留在磁盘上，下次扫描还要再规范化一遍
  if (!merged.changed && !read.normalized) return { ok: true, changed: false, path, state: probe.state };

  const written = writeConfigAtomically(path, merged.text, options.now ?? Date.now());
  if (!written.ok) return { ok: false, path, error: written.error };
  return {
    ok: true, changed: true, path,
    ...(written.backupPath ? { backupPath: written.backupPath } : {}),
    ...(read.normalized ? { repaired: true } : {}),
    state: 'wired',
  };
}

/**
 * 一键打开客户端开关（T2）：备份原配置 → 只删本服务条目的「已禁用」标记 → 原子替换。
 * 不改 url / headers / type / 条目上的其它字段 / 其它客户端条目 / 其它顶层键；不重建条目。
 * 只支持 JSON 配置（WorkBuddy 等）：TOML / 无稳定配置面如实拒绝并提示手动打开，不假装成功。
 * 客户端不会热重读配置，因此本函数只保证「下次启动 / 新会话」是打开的；提示话术由 UI 给出。
 */
export function enableMcpClient(
  id: string,
  options: { home?: string; appData?: string; endpoint?: string; now?: number } = {},
): McpWireResult {
  let spec: McpClientSpec;
  try {
    spec = specOfMcpClient(id);
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
  if (!spec.configPath || !spec.writable) {
    return { ok: false, error: '该客户端不支持自动写入（请到设置中手动打开开关）' };
  }
  if (spec.format !== 'json') {
    return { ok: false, error: '该客户端配置不是 JSON，暂不支持自动打开开关（请到设置中手动打开）' };
  }
  const home = options.home ?? homedir();
  const appData = options.appData ?? process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
  const endpoint = options.endpoint ?? MCP_ENDPOINT;
  const path = expandHome(spec.configPath, home, appData);
  const read = readConfig(path, spec.format);
  if (read.error) return { ok: false, path, error: read.error };
  if (read.text === null) return { ok: false, path, error: '配置文件不存在，请先完成接入' };

  const probe = probeClientConfig(spec, read.text, endpoint);
  if (probe.state === 'invalid') {
    return { ok: false, path, error: `配置文件无法解析：${probe.error ?? '格式错误'}` };
  }
  if (probe.state === 'conflict') {
    return { ok: false, path, state: probe.state, error: `同名条目指向其它端点（${probe.foundUrl ?? '未填写'}），拒绝覆盖` };
  }
  // 幂等：没有禁用标记就不写盘、不产生备份（不能把「无需操作」伪装成「已打开」）
  if (probe.disabled !== true) return { ok: true, changed: false, path, state: probe.state };

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(read.text) as Record<string, unknown>;
  } catch (e) {
    return { ok: false, path, error: `配置文件无法解析：${String((e as Error)?.message ?? e)}` };
  }
  const serversRaw = parsed.mcpServers;
  const servers = serversRaw && typeof serversRaw === 'object' && !Array.isArray(serversRaw)
    ? (serversRaw as Record<string, unknown>)
    : null;
  const entry = servers?.[spec.serverKey];
  if (!servers || !entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return { ok: false, path, error: '配置里没有本服务条目，拒绝改写' };
  }
  const next = { ...(entry as Record<string, unknown>) };
  delete next.disabled;
  servers[spec.serverKey] = next;
  parsed.mcpServers = servers;

  const written = writeConfigAtomically(path, `${JSON.stringify(parsed, null, 2)}\n`, options.now ?? Date.now());
  if (!written.ok) return { ok: false, path, error: written.error };
  const after = probeClientConfig(spec, readConfig(path, spec.format).text, endpoint);
  return {
    ok: true, changed: true, path,
    ...(written.backupPath ? { backupPath: written.backupPath } : {}),
    ...(read.normalized ? { repaired: true } : {}),
    state: after.state,
  };
}

export { MCP_ENDPOINT };
