// MCP 客户端接入配方（批次15）：单一真源。
// 所有 Agent 共用同一个 streamable-http 端点（127.0.0.1:8204/mcp）与数据根 mcp-token.txt；
// 本文件只描述「每个客户端把端点写在哪、格式是什么、能否安全回写」，纯数据 + 纯函数（浏览器可用）。
// 不读取令牌、不落盘、不猜未知客户端的内部格式：未知一律 configPath=null，由 UI 如实标注「需手工添加」。

import type { BadgeClass } from '../types/agentOnboard.ts';

/** 标准 MCP streamable-http 端点（与 src/electron/main.ts 的 MCP_HTTP_PORT 一致） */
export const MCP_ENDPOINT = 'http://127.0.0.1:8204/mcp';

export type McpClientId =
  | 'qoder-cn'
  | 'claude-code'
  | 'codex'
  | 'cursor'
  | 'gemini-cli'
  | 'qwen-code'
  | 'trae-cn'
  | 'workbuddy'
  | 'zcode'
  | 'deepseek-harness';

export type McpConfigFormat = 'json' | 'toml' | 'unknown';
/** 条目字段风格：type+url（Qoder/Claude）/ url（Cursor）/ httpUrl（Gemini 系） */
export type McpEntryStyle = 'type+url' | 'url' | 'httpUrl';

export interface McpClientSpec {
  id: McpClientId;
  name: string;
  badge: BadgeClass;
  /** JSON 的 mcpServers 键；TOML 的 [mcp_servers.<serverKey>] */
  serverKey: string;
  format: McpConfigFormat;
  entryStyle: McpEntryStyle;
  /** 配置文件（相对 home；null = 无稳定可写路径，只给手工接入说明） */
  configPath: string | null;
  /** 安装痕迹（相对 home）；用于区分「已安装未配置」与「未安装」 */
  installMarkers: string[];
  /** 该客户端读取的触发规则文件（展示用；服务端提示行与折叠明细对所有客户端一致） */
  rulesHint: string;
  /** 接通指引：在客户端里具体去哪里配置（设置菜单 / 配置文件） */
  connectHint: string;
  /** 是否允许一键写入（已知结构；写前备份 + 原子替换） */
  writable: boolean;
  /** 批次28-B：宿主继承 —— 本客户端无独立 MCP 配置面，随宿主客户端的 mcpServers 下发
   *  （deepseek harness ← Qoder Desktop）。宿主已接入即本客户端已接入；
   *  一键接入委托给宿主配方真实写入。 */
  inheritsFrom?: McpClientId;
  note?: string;
}

export const MCP_CLIENT_SPECS: McpClientSpec[] = [
  {
    id: 'qoder-cn', name: 'Qoder CN', badge: 'p3',
    serverKey: 'MultiAgent Memory', format: 'json', entryStyle: 'type+url',
    configPath: '~/.qoder-cn/settings.json', installMarkers: ['~/.qoder-cn'],
    rulesHint: '工作区 AGENTS.md（Qoder 会加载）',
    connectHint: 'Qoder CN → 设置 → MCP 服务器（或编辑 ~/.qoder-cn/settings.json 的 mcpServers）',
    writable: true,
    note: '已验证可用（批次13/14 实机回显提示行 + 四段折叠明细）',
  },
  {
    id: 'claude-code', name: 'Claude Code', badge: 'p1',
    serverKey: 'memagent', format: 'json', entryStyle: 'type+url',
    configPath: '~/.claude.json', installMarkers: ['~/.claude.json', '~/.claude'],
    rulesHint: '仓库根 CLAUDE.md（@AGENTS.md）',
    connectHint: 'Claude Code → 编辑 ~/.claude.json 的 mcpServers（或运行 claude mcp add）',
    writable: true,
    note: '已有同名条目时只补齐/修正 Authorization 头，不新增重复条目',
  },
  {
    id: 'codex', name: 'Codex', badge: 'p2',
    serverKey: 'multiagent_memory', format: 'toml', entryStyle: 'url',
    configPath: '~/.codex/config.toml', installMarkers: ['~/.codex'],
    rulesHint: '工作区 AGENTS.md',
    connectHint: 'Codex → 编辑 ~/.codex/config.toml 的 [mcp_servers.multiagent_memory] 段',
    writable: true,
    note: '自动写入 TOML 段（写前备份；已有同名段只补齐 Authorization，其它段保留）',
  },
  {
    id: 'cursor', name: 'Cursor', badge: 'p3',
    serverKey: 'MultiAgent Memory', format: 'json', entryStyle: 'url',
    configPath: '~/.cursor/mcp.json', installMarkers: ['~/.cursor'],
    rulesHint: '仓库根 AGENTS.md（或粘贴到 .cursor/rules）',
    connectHint: 'Cursor → 设置 → MCP → Add new MCP server（或编辑 ~/.cursor/mcp.json）',
    writable: true,
    note: '字段以 Cursor 当前版本为准（url + headers）',
  },
  {
    id: 'gemini-cli', name: 'Gemini CLI', badge: 'p3',
    serverKey: 'MultiAgent Memory', format: 'json', entryStyle: 'httpUrl',
    configPath: '~/.gemini/settings.json', installMarkers: ['~/.gemini'],
    rulesHint: '工作区 AGENTS.md',
    connectHint: 'Gemini CLI → 编辑 ~/.gemini/settings.json 的 mcpServers（httpUrl + headers）',
    writable: true,
    note: '自动写入 mcpServers 条目（httpUrl + headers；写前备份，保留其它配置）',
  },
  {
    id: 'qwen-code', name: 'Qwen Code', badge: 'p3',
    serverKey: 'MultiAgent Memory', format: 'json', entryStyle: 'httpUrl',
    configPath: '~/.qwen/settings.json', installMarkers: ['~/.qwen'],
    rulesHint: '工作区 AGENTS.md',
    connectHint: 'Qwen Code → 编辑 ~/.qwen/settings.json 的 mcpServers（httpUrl + headers）',
    writable: true,
    note: 'Gemini CLI 分支，自动写入 mcpServers 条目（写前备份）',
  },
  {
    id: 'trae-cn', name: 'Trae Code CN', badge: 'p3',
    serverKey: 'MultiAgent Memory', format: 'json', entryStyle: 'url',
    configPath: '%APPDATA%/Trae CN/User/mcp.json', installMarkers: ['~/.trae-cn', '~/.trae'],
    rulesHint: '工作区 AGENTS.md（若客户端支持）',
    connectHint: 'Trae CN → 设置 → MCP → 添加服务器（或编辑 %APPDATA%/Trae CN/User/mcp.json 的 mcpServers）',
    writable: true,
    note: '2026-10-31 实机确认稳定配置路径（mcpServers JSON）；本服务写 url + Authorization 头，写前备份，保留其它条目',
  },
  {
    id: 'workbuddy', name: 'WorkBuddy', badge: 'p0',
    serverKey: 'MultiAgent Memory', format: 'json', entryStyle: 'type+url',
    configPath: '~/.workbuddy/mcp.json',
    installMarkers: ['~/.workbuddy'],
    rulesHint: '工作区 AGENTS.md（若客户端支持）',
    connectHint: 'WorkBuddy → 设置 → MCP 服务管理 → 添加/编辑（配置文件 ~/.workbuddy/mcp.json，应用内编辑器可直接改）；本面板「一键接入」可自动合并写入（写前备份，保留其它条目）',
    writable: true,
    note: '2026-10-31 用户实测确认稳定配置 ~/.workbuddy/mcp.json（mcpServers JSON，type+url+headers，应用内编辑器直显该路径）；本服务写前备份、幂等合并；若 WorkBuddy 云同步在其它设备覆盖改动，重新一键适配即可',
  },
  {
    id: 'zcode', name: 'Zcode', badge: 'p3',
    serverKey: 'MultiAgent Memory', format: 'unknown', entryStyle: 'type+url',
    configPath: null, installMarkers: ['~/.zcode'],
    rulesHint: '工作区 AGENTS.md（若客户端支持）',
    connectHint: 'Zcode → 设置 → MCP 服务器 → 添加/编辑，两种方式任选：① 表单——类型 HTTP、URL 填 http://127.0.0.1:8204/mcp、请求头 {"Authorization": "Bearer <mcp-token>"}；② JSON——直接粘贴 {"MultiAgent Memory": {"type": "http", "url": "http://127.0.0.1:8204/mcp", "headers": {"Authorization": "Bearer <mcp-token>"}}}（令牌见数据根 mcp-token.txt 或接入页「复制片段」），保存即接通',
    writable: false,
    note: '2026-10-31 用户实测确认应用内「表单 / JSON」两种配置方式；配置存应用内部存储（IndexedDB），无稳定配置文件可合并 → 不代写，客户端内一次配置即接通',
  },
  {
    id: 'deepseek-harness', name: 'deepseek harness', badge: 'p0',
    serverKey: 'multiagent_memory', format: 'unknown', entryStyle: 'type+url',
    configPath: null, installMarkers: ['~/.dsh'],
    rulesHint: '工作区 AGENTS.md',
    connectHint: 'deepseek harness 无独立 MCP 配置文件：随宿主（Qoder Desktop）的 mcpServers 下发，宿主接入即生效；宿主未接入时对本客户端点「一键接入」会自动写入宿主配置',
    inheritsFrom: 'qoder-cn',
    writable: true,
    note: '批次28-B：宿主继承检测 + 一键接入委托宿主（qoder-cn）真实写入；本机 2026-10-31 实测 recall_memory 经宿主配置走通',
  },
];

/** MCP 接入状态（按真实配置文件内容判定，不伪造「已接入」） */
export type McpWireState =
  | 'wired'          // 端点正确 + Authorization 头齐全
  | 'missing_auth'   // 端点正确但缺令牌（调用会 401）
  | 'missing_entry'  // 配置文件存在，但没有本服务的条目
  | 'conflict'       // 同名条目指向别的端点（拒绝自动覆盖）
  | 'invalid'        // 配置文件不是合法 JSON/无法解析（拒绝自动写入）
  | 'no_config'      // 配置文件不存在（可新建）
  | 'manual';        // 该客户端暂无稳定可写配置（只给手工说明）

export interface McpConfigProbe {
  state: McpWireState;
  /** 命中的端点（不含令牌；用于解释 conflict） */
  foundUrl?: string;
  hasAuth: boolean;
  error?: string;
}

export function specOfMcpClient(id: string): McpClientSpec {
  const spec = MCP_CLIENT_SPECS.find((s) => s.id === id);
  if (!spec) throw new Error(`未知 MCP 客户端：${id}`);
  return spec;
}

/** 生成单个客户端条目（含真实令牌；仅用于「复制配置」/一键写入，绝不写日志） */
export function buildMcpEntry(spec: McpClientSpec, endpoint: string, token: string): Record<string, unknown> {
  const headers = { Authorization: `Bearer ${token}` };
  if (spec.entryStyle === 'httpUrl') return { httpUrl: endpoint, headers };
  if (spec.entryStyle === 'url') return { url: endpoint, headers };
  return { type: 'http', url: endpoint, headers };
}

/** 可复制的配置片段（JSON / TOML / 手工说明） */
export function renderMcpSnippet(spec: McpClientSpec, endpoint: string, token: string): string {
  if (spec.format === 'json') {
    return `${JSON.stringify({ mcpServers: { [spec.serverKey]: buildMcpEntry(spec, endpoint, token) } }, null, 2)}\n`;
  }
  if (spec.format === 'toml') {
    return `[mcp_servers.${spec.serverKey}]\nurl = "${endpoint}"\nhttp_headers = { Authorization = "Bearer ${token}" }\n`;
  }
  return `端点：${endpoint}\n请求头：Authorization: Bearer ${token}\n（${spec.note ?? '请在客户端设置中手工添加'}）\n`;
}

/** 判断 JSON 配置里本服务的接入状态（不返回令牌） */
export function probeJsonConfig(text: string | null, spec: McpClientSpec, endpoint: string): McpConfigProbe {
  if (text === null) return { state: 'no_config', hasAuth: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { state: 'invalid', hasAuth: false, error: String((e as Error)?.message ?? e) };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { state: 'invalid', hasAuth: false, error: '配置文件顶层不是对象' };
  }
  const servers = (parsed as { mcpServers?: unknown }).mcpServers;
  const entry = servers && typeof servers === 'object'
    ? (servers as Record<string, unknown>)[spec.serverKey]
    : undefined;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return { state: 'missing_entry', hasAuth: false };
  }
  const e = entry as Record<string, unknown>;
  const url = typeof e.url === 'string' ? e.url : typeof e.httpUrl === 'string' ? e.httpUrl : undefined;
  if (url !== endpoint) return { state: 'conflict', foundUrl: url, hasAuth: false };
  const headers = e.headers;
  const auth = headers && typeof headers === 'object'
    ? ((headers as Record<string, unknown>).Authorization ?? (headers as Record<string, unknown>).authorization)
    : undefined;
  const hasAuth = typeof auth === 'string' && /^Bearer\s+\S+/i.test(auth.trim());
  return { state: hasAuth ? 'wired' : 'missing_auth', foundUrl: url, hasAuth };
}

/** 转义正则元字符（TOML 段名可能含点/短横线） */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 判断 TOML 配置里本服务的接入状态（只读，不做 TOML 反序列化） */
export function probeTomlConfig(text: string | null, spec: McpClientSpec, endpoint: string): McpConfigProbe {
  if (text === null) return { state: 'no_config', hasAuth: false };
  const startRe = new RegExp(`^\\s*\\[mcp_servers\\.${escapeRe(spec.serverKey)}\\]\\s*$`, 'm');
  const start = startRe.exec(text);
  if (!start) return { state: 'missing_entry', hasAuth: false };
  const rest = text.slice(start.index + start[0].length);
  // 收集本段直到下一个「不属于本服务」的 [section]；子表 [mcp_servers.<key>.http_headers] 仍属于本段
  const ownSectionRe = new RegExp(`^\\s*\\[mcp_servers\\.${escapeRe(spec.serverKey)}(?:\\.|\\])`);
  const body: string[] = [];
  for (const line of rest.split(/\r?\n/)) {
    if (/^\s*\[/.test(line) && !ownSectionRe.test(line)) break;
    body.push(line);
  }
  const section = body.join('\n');
  const url = /\b(?:url|http_url)\s*=\s*"([^"]*)"/.exec(section)?.[1];
  if (url !== endpoint) return { state: 'conflict', foundUrl: url, hasAuth: false };
  const auth = /\bAuthorization\s*=\s*"([^"]*)"/i.exec(section)?.[1];
  const hasAuth = typeof auth === 'string' && /^Bearer\s+\S+/i.test(auth.trim());
  return { state: hasAuth ? 'wired' : 'missing_auth', foundUrl: url, hasAuth };
}

/** 按配置格式探测；manual = 该客户端没有任何可读配置面（批次28-B：动态配置面 configPath=null 但有 glob，按格式正常探测） */
export function probeClientConfig(
  spec: McpClientSpec, text: string | null, endpoint: string,
): McpConfigProbe {
  if (spec.format === 'unknown') return { state: 'manual', hasAuth: false };
  if (spec.format === 'toml') return probeTomlConfig(text, spec, endpoint);
  return probeJsonConfig(text, spec, endpoint);
}

/**
 * 把本服务条目并入 JSON 配置（保留其它键与其它 MCP 服务器；同名条目只合并不替换）。
 * 仅允许 writable 的 JSON 客户端；conflict / invalid 由调用方先行拒绝。
 */
export function mergeMcpJsonConfig(
  text: string | null, spec: McpClientSpec, endpoint: string, token: string,
): { text: string; changed: boolean } {
  if (spec.format !== 'json' || !spec.writable) throw new Error(`E_UNSUPPORTED_CLIENT: ${spec.id}`);
  let parsed: unknown = {};
  if (text !== null) {
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error(`E_CONFIG_INVALID: ${String((e as Error)?.message ?? e)}`);
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('E_CONFIG_INVALID: 顶层不是对象');
  const obj = parsed as Record<string, unknown>;
  const serversRaw = obj.mcpServers;
  const servers = serversRaw && typeof serversRaw === 'object' && !Array.isArray(serversRaw)
    ? { ...(serversRaw as Record<string, unknown>) }
    : {};
  const existing = servers[spec.serverKey];
  let nextEntry = buildMcpEntry(spec, endpoint, token);
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    const old = existing as Record<string, unknown>;
    const url = typeof old.url === 'string' ? old.url : typeof old.httpUrl === 'string' ? old.httpUrl : undefined;
    if (url !== undefined && url !== endpoint) throw new Error('E_CONFIG_CONFLICT: 同名条目指向其它端点');
    const oldHeaders = old.headers && typeof old.headers === 'object' && !Array.isArray(old.headers)
      ? (old.headers as Record<string, unknown>)
      : {};
    // 保留条目上的其它字段（如 qoder_url）与其它请求头，只覆盖本服务需要的字段
    nextEntry = { ...old, ...nextEntry, headers: { ...oldHeaders, ...(nextEntry.headers as Record<string, unknown>) } };
  }
  // 只比较目标条目：未变化时原样返回，避免无意义地重排整个配置文件
  if (existing !== undefined && JSON.stringify(existing) === JSON.stringify(nextEntry)) {
    return { text: text ?? '', changed: false };
  }
  servers[spec.serverKey] = nextEntry;
  obj.mcpServers = servers;
  return { text: `${JSON.stringify(obj, null, 2)}\n`, changed: true };
}

/** TOML 字符串转义（令牌/端点理论上不含引号，仍按规范转义） */
function tomlQuote(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * 把本服务条目并入 TOML 配置（批次23：Codex 等 [mcp_servers.<key>] 客户端）。
 * 保留其它段与其它请求头；已有同名段只补齐/修正 Authorization；同名段指向其它端点 → 拒绝覆盖。
 * 支持两种写法：段内 `http_headers = { Authorization = "..." }`，或子表 `[mcp_servers.<key>.http_headers]`。
 */
export function mergeMcpTomlConfig(
  text: string | null, spec: McpClientSpec, endpoint: string, token: string,
): { text: string; changed: boolean } {
  if (spec.format !== 'toml' || !spec.writable) throw new Error(`E_UNSUPPORTED_CLIENT: ${spec.id}`);
  const source = text ?? '';
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  const headerRe = new RegExp(`^\\s*\\[mcp_servers\\.${escapeRe(spec.serverKey)}\\]\\s*$`);
  const ownRe = new RegExp(`^\\s*\\[mcp_servers\\.${escapeRe(spec.serverKey)}(?:\\.|\\])`);
  const headerIdx = lines.findIndex((l) => headerRe.test(l));
  const authValue = `Bearer ${token}`;
  const authAssignment = `Authorization = "${tomlQuote(authValue)}"`;

  if (headerIdx === -1) {
    const block = [
      `[mcp_servers.${spec.serverKey}]`,
      `url = "${tomlQuote(endpoint)}"`,
      `http_headers = { ${authAssignment} }`,
    ].join(eol);
    const base = source.trimEnd();
    return { text: `${base.length > 0 ? `${base}${eol}${eol}` : ''}${block}${eol}`, changed: true };
  }

  let sectionEnd = lines.length;
  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    if (/^\s*\[/.test(lines[i]) && !ownRe.test(lines[i])) { sectionEnd = i; break; }
  }

  const bodyText = lines.slice(headerIdx + 1, sectionEnd).join('\n');
  const url = /\b(?:url|http_url)\s*=\s*"([^"]*)"/.exec(bodyText)?.[1];
  if (url !== endpoint) throw new Error('E_CONFIG_CONFLICT: 同名条目指向其它端点');

  // 形式一：子表 [mcp_servers.<key>.http_headers]
  const childRe = new RegExp(`^\\s*\\[mcp_servers\\.${escapeRe(spec.serverKey)}\\.http_headers\\]\\s*$`);
  const childIdx = lines.findIndex((l, i) => i > headerIdx && i < sectionEnd && childRe.test(l));
  if (childIdx !== -1) {
    let childEnd = sectionEnd;
    for (let i = childIdx + 1; i < sectionEnd; i += 1) {
      if (/^\s*\[/.test(lines[i])) { childEnd = i; break; }
    }
    for (let i = childIdx + 1; i < childEnd; i += 1) {
      const m = /^(\s*)(Authorization|authorization)\s*=\s*"([^"]*)"\s*$/.exec(lines[i]);
      if (m) {
        if (m[3] === authValue) return { text: source, changed: false };
        lines[i] = `${m[1]}Authorization = "${tomlQuote(authValue)}"`;
        return { text: lines.join(eol), changed: true };
      }
    }
    lines.splice(childEnd, 0, authAssignment);
    return { text: lines.join(eol), changed: true };
  }

  // 形式二：段内内联表 http_headers = { ... }
  const inlineIdx = lines.findIndex(
    (l, i) => i > headerIdx && i < sectionEnd && /\bhttp_headers\s*=\s*\{/.test(l),
  );
  if (inlineIdx !== -1) {
    const line = lines[inlineIdx];
    const open = line.indexOf('{');
    const close = line.lastIndexOf('}');
    if (open !== -1 && close > open) {
      const inner = line.slice(open + 1, close);
      const authRe = /(Authorization|authorization)\s*=\s*"([^"]*)"/;
      const m = authRe.exec(inner);
      if (m) {
        if (m[2] === authValue) return { text: source, changed: false };
        lines[inlineIdx] = `${line.slice(0, open + 1)}${inner.replace(authRe, () => authAssignment)}${line.slice(close)}`;
        return { text: lines.join(eol), changed: true };
      }
      const trimmed = inner.trimEnd();
      const sep = trimmed.trim().length === 0 ? ' ' : trimmed.endsWith(',') ? ' ' : ', ';
      lines[inlineIdx] = `${line.slice(0, open + 1)}${trimmed}${sep}${authAssignment}${line.slice(close)}`;
      return { text: lines.join(eol), changed: true };
    }
  }

  // 形式三：段内没有 http_headers → 紧跟 url 行补一行
  const urlIdx = lines.findIndex((l, i) => i > headerIdx && i < sectionEnd && /\b(?:url|http_url)\s*=/.test(l));
  const insertAt = urlIdx === -1 ? headerIdx + 1 : urlIdx + 1;
  lines.splice(insertAt, 0, `http_headers = { ${authAssignment} }`);
  return { text: lines.join(eol), changed: true };
}
