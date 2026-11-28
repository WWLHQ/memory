// MCP 客户端接入配方（批次15）：单一真源。
// 所有 Agent 共用同一个 streamable-http 端点（127.0.0.1:8204/mcp）与数据根 mcp-token.txt；
// 本文件只描述「每个客户端把端点写在哪、格式是什么、能否安全回写」，纯数据 + 纯函数（浏览器可用）。
// 不读取令牌、不落盘、不猜未知客户端的内部格式：未知一律 configPath=null，由 UI 如实标注「需手工添加」。

import type { BadgeClass } from '../types/agentOnboard.ts';

/** 标准 MCP streamable-http 端点（与 src/electron/main.ts 的 MCP_HTTP_PORT 一致） */
export const MCP_ENDPOINT = 'http://127.0.0.1:8204/mcp';

/**
 * stdio 桥接脚本文件名（2026-11-18 用户要求「客户端配置改成 stdio launcher 现读令牌，轮换零维护」）。
 * 单一真源放这里：electron/mcpBridgeScript.ts 生成它、本文件生成/识别引用它的配置条目、探测函数认它。
 */
export const MCP_BRIDGE_FILE_NAME = 'mcp-bridge.cjs';

/** stdio 接入时客户端配置里必须出现的最小形态（令牌**不在其中**，由桥接脚本每次现读） */
export const MCP_STDIO_COMMAND = 'node';

/** 配置条目承载的传输方式：http=把令牌抄进配置（轮换需重写）/ stdio=只写启动命令（轮换零维护） */
export type McpTransport = 'http' | 'stdio';

/**
 * stdio 接入的三个路径参数（都必须是**指针或稳定路径**，不能写死数据根里的易变位置）：
 *  · bridgePath  = 桥接脚本绝对路径（落在引导指针同目录，数据根搬家也不动）
 *  · pointerPath = 引导指针 data-root.json（桥接脚本运行时据此现查数据根 → keys/mcp-token.txt）
 *  · endpoint    = 本机 MCP 端点
 */
export interface McpStdioTarget {
  bridgePath: string;
  pointerPath: string;
  endpoint: string;
}

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

/** yaml = 插件式 YAML（deepseek harness 的 `~/.dsh/profiles/desktop/cordis.patch.yml`：
 *  不是一个 mcpServers 表，而是一条 `- insert: - id: memagent-mcp / name: @deepseek-ai/dsh-mcp-client /
 *  config: {serverName, transport, url, headers}` 的插件声明）。2026-11-28 实机确认该路径存在且可写。 */
export type McpConfigFormat = 'json' | 'toml' | 'yaml' | 'unknown';
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
  /** 批次30：审计证据匹配用的调用方名（recall 审计 detail.client 的首段）——
   *  默认用 id 本身匹配；客户端自报名与 id 不同时在此显式列出。 */
  auditClientIds?: string[];
  /** format='yaml' 专用：插件名（写进 `- insert:` 的 `name:`，如 @deepseek-ai/dsh-mcp-client） */
  pluginName?: string;
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
    // 2026-11-28 实机更正：Zcode 有稳定配置文件 `~/.zcode/mcp.json`（本机是指向
    // D:/Work Folder/Agnet/Zcode/.zcode 的软链接目录），内容是 mcpServers JSON（type+url+headers），
    // 因此可代写、可自动注入身份头。serverKey 用文件里既有的 `multiagent-memory`，避免同一服务被写成两条。
    serverKey: 'multiagent-memory', format: 'json', entryStyle: 'type+url',
    configPath: '~/.zcode/mcp.json', installMarkers: ['~/.zcode'],
    rulesHint: '工作区 AGENTS.md（若客户端支持）',
    connectHint: 'Zcode → 设置 → MCP 服务器（或直接改 ~/.zcode/mcp.json 的 mcpServers）',
    writable: true,
    note: '2026-11-28 实机确认稳定配置文件 ~/.zcode/mcp.json（mcpServers JSON，type+url+headers）：'
      + '写前备份、幂等合并、自动补 X-Memagent-Client 身份头；其它条目与其它请求头（如 X-Memagent-Render）原样保留',
  },
  {
    id: 'deepseek-harness', name: 'deepseek harness', badge: 'p0',
    // 2026-11-28 实机更正：DSH 有独立 MCP 配置文件（不是「随宿主下发」）——
    // `~/.dsh/profiles/desktop/cordis.patch.yml` 里一条插件声明
    // `- insert: - id: memagent-mcp / name: @deepseek-ai/dsh-mcp-client / config:{serverName,transport,url,headers}`。
    // 因此可代写、可自动注入身份头；serverKey 是插件的 serverName。
    serverKey: 'memagent', format: 'yaml', entryStyle: 'type+url',
    configPath: '~/.dsh/profiles/desktop/cordis.patch.yml', installMarkers: ['~/.dsh'],
    rulesHint: '工作区 AGENTS.md',
    connectHint: 'deepseek harness → 编辑 ~/.dsh/profiles/desktop/cordis.patch.yml 的 memagent-mcp 插件条目（一键接入可代写）',
    auditClientIds: ['dsh-mcp-client'],
    pluginName: '@deepseek-ai/dsh-mcp-client',
    writable: true,
    note: '2026-11-28 实机确认：DSH 的 MCP 客户端是 cordis.patch.yml 里的 memagent-mcp 插件（transport: streamable-http）；'
      + '一键接入只改该插件的 url / Authorization / X-Memagent-Client 三处，其余插件与注释原样保留，写前备份',
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
  /** 条目是哪种传输形态：stdio=只写启动命令（令牌由桥接脚本现读）/ http=令牌抄在配置里。
   *  缺省 undefined = 没读到条目（no_config / missing_entry 等），不代表 http。 */
  transport?: McpTransport;
  /** 批次41-X：条目里是否已带显式身份头 `X-Memagent-Client`，且值**等于本客户端 id**
   *  （缺 ≠ 坏，老配置照常工作，只是身份仍靠归并；值不符同样按「缺」处理——服务端会把它记到别的客户端名下） */
  hasClientId?: boolean;
  /** 条目里实际读到（却没对上）的身份头值，仅用于向用户解释为什么还要补；不含任何凭据 */
  foundClientId?: string;
  /** 客户端应用内的「已禁用」标记：仅当配置条目显式为布尔 true 时才带此字段。
   *  缺省 = 本次没读到禁用标记，不代表客户端一定已启用（无从判定时 UI 应显示「未知」）。
   *  不改 McpWireState 七态契约：开关是独立维度，配置是否接通过仍然是 state。 */
  disabled?: boolean;
  error?: string;
}

export function specOfMcpClient(id: string): McpClientSpec {
  const spec = MCP_CLIENT_SPECS.find((s) => s.id === id);
  if (!spec) throw new Error(`未知 MCP 客户端：${id}`);
  return spec;
}

/**
 * 由规格推导「接入形态」（2026-11-28，用户要求「不能只显示形态未定」）。
 * 只在**读不到配置文件**时兜底：本服务写进任何 JSON 客户端的条目都是 `type/url/httpUrl + headers`
 * （见 buildMcpEntry），所以「可粘贴的片段就是 HTTP 直连」是确定的，不是猜测。
 * 宿主继承客户端（deepseek harness ← Qoder）随宿主的形态走。
 * 无稳定形态（format=unknown 且不继承）才返回 undefined，UI 那时才允许说「形态未定」。
 */
export function impliedTransport(spec: McpClientSpec): McpTransport | undefined {
  // JSON / TOML / YAML 三条写入路径产出的条目都是 url + headers（见 buildMcpEntry / mergeMcpTomlConfig /
  // mergeMcpYamlConfig），即「HTTP 直连」形态，与配置里读到的 transport 同义。
  if (spec.format === 'json' || spec.format === 'toml' || spec.format === 'yaml') return 'http';
  if (spec.inheritsFrom) {
    try {
      return impliedTransport(specOfMcpClient(spec.inheritsFrom));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** 批次41-X：显式身份请求头。值固定为本配方的规范 id（`spec.id`），由服务端 8204 逐次读取，
 *  用来替代「同 UA 最近一次 initialize 的自报名」那条会跨客户端串号的归并（AGENTS §9 批次41-S 残留）。
 *  注意：这是**身份**不是**凭据**——令牌仍是唯一鉴权，缺这个头的老配置照常工作（落到原有归并链）。 */
export const MCP_CLIENT_HEADER_NAME = 'X-Memagent-Client';

/** 本服务需要的请求头（批次41-X：令牌 + 显式身份头），JSON/TOML 两条写入路径共用同一真源 */
export function mcpHeaderPairs(spec: McpClientSpec, token: string): Array<{ key: string; value: string }> {
  return [
    { key: 'Authorization', value: `Bearer ${token}` },
    { key: MCP_CLIENT_HEADER_NAME, value: spec.id },
  ];
}

/** 生成单个客户端条目（含真实令牌；仅用于「复制配置」/一键写入，绝不写日志） */
export function buildMcpEntry(spec: McpClientSpec, endpoint: string, token: string): Record<string, unknown> {
  const headers: Record<string, string> = {};
  for (const pair of mcpHeaderPairs(spec, token)) headers[pair.key] = pair.value;
  if (spec.entryStyle === 'httpUrl') return { httpUrl: endpoint, headers };
  if (spec.entryStyle === 'url') return { url: endpoint, headers };
  return { type: 'http', url: endpoint, headers };
}

/**
 * stdio 条目（零维护形态）：配置里**没有任何凭据**，只有一句
 * `node <bridge> <指针> <端点> <客户端 id>`。
 *  · 令牌：桥接脚本每次调用现读 `指针 → 数据根/keys/mcp-token.txt`，轮换后不用改任何配置；
 *  · 身份：客户端 id 走 argv，由桥接脚本作为 `X-Memagent-Client` 头带给服务端（比 http 形态更准）。
 * 不写 env：多数客户端支持，但 env 是「值要跟着令牌走」的老路，这里一律不放凭据。
 */
export function buildStdioMcpEntry(spec: McpClientSpec, target: McpStdioTarget): Record<string, unknown> {
  return {
    command: MCP_STDIO_COMMAND,
    args: [target.bridgePath, target.pointerPath, target.endpoint, spec.id],
  };
}

/** 该条目是不是 stdio 桥接形态（只认「命令 + args 里有桥接脚本」，不认乱七八糟的同名 command） */
export function isStdioEntry(entry: Record<string, unknown>): boolean {
  if (typeof entry.command !== 'string' || !entry.command) return false;
  const args = Array.isArray(entry.args) ? entry.args : [];
  return args.some((a) => typeof a === 'string' && a.endsWith(MCP_BRIDGE_FILE_NAME));
}

/** 可复制的配置片段（JSON / TOML / 手工说明） */
export function renderMcpSnippet(
  spec: McpClientSpec, endpoint: string, token: string, stdio?: McpStdioTarget,
): string {
  if (stdio) {
    // stdio 片段**不含令牌**，可以随便复制/贴给别人看
    const entry = buildStdioMcpEntry(spec, stdio);
    if (spec.format === 'toml') {
      const args = (entry.args as string[]).map((a) => `"${tomlQuote(a)}"`).join(', ');
      return `[mcp_servers.${spec.serverKey}]\ncommand = "${MCP_STDIO_COMMAND}"\nargs = [${args}]\n`;
    }
    if (spec.format === 'json') {
      return `${JSON.stringify({ mcpServers: { [spec.serverKey]: entry } }, null, 2)}\n`;
    }
    return `启动命令：${MCP_STDIO_COMMAND} ${(entry.args as string[]).join(' ')}\n（stdio 启动型 MCP：配置里不含令牌，令牌由桥接脚本现读，轮换零维护）\n`;
  }
  const pairs = mcpHeaderPairs(spec, token);
  if (spec.format === 'yaml') {
    // 插件式 YAML：给出可直接贴进 cordis.patch.yml 的插件声明（与 mergeMcpYamlConfig 新建条目同构）
    return [
      '- insert:',
      `    - id: ${spec.serverKey}-mcp`,
      `      name: '${spec.pluginName ?? '@deepseek-ai/dsh-mcp-client'}'`,
      '      config:',
      `        serverName: ${spec.serverKey}`,
      '        transport: streamable-http',
      `        url: ${endpoint}`,
      '        headers:',
      ...pairs.map((p) => `          ${p.key}: ${p.value}`),
      '        failOnStartupError: false',
      '',
    ].join('\n');
  }
  if (spec.format === 'json') {
    return `${JSON.stringify({ mcpServers: { [spec.serverKey]: buildMcpEntry(spec, endpoint, token) } }, null, 2)}\n`;
  }
  if (spec.format === 'toml') {
    const table = pairs.map((p) => `${tomlKey(p.key)} = "${tomlQuote(p.value)}"`).join(', ');
    return `[mcp_servers.${spec.serverKey}]\nurl = "${endpoint}"\nhttp_headers = { ${table} }\n`;
  }
  const headerLines = pairs.map((p) => `请求头：${p.key}: ${p.value}`).join('\n');
  return `端点：${endpoint}\n${headerLines}\n（${spec.note ?? '请在客户端设置中手工添加'}）\n`;
}

/** 客户端应用内开关：只认显式布尔 true，字符串 "true" / 数字 1 / 其它值一律不猜。
 *  没有禁用标记时原样返回（不带新键），保证既有七态探测结果逐字不变。 */
function markDisabled(probe: McpConfigProbe, entry: Record<string, unknown>): McpConfigProbe {
  return entry.disabled === true ? { ...probe, disabled: true } : probe;
}

/**
 * 规范化 JSONC 文本：去掉 UTF-8 BOM、行注释（//）、块注释（/…/）、尾逗号。
 * **纯文本变换**，逐字保留字符串内容（字符串里的 `//`、`/*`、`"`、`,}` 一律不动）。
 * 调用方必须在严格 `JSON.parse` 失败后才用它，并用 `JSON.parse(normalized)` 复核成功才认；
 * 本函数不判接入状态、不写盘，浏览器/主进程共用同一份真源。
 */
export function normalizeConfigText(text: string): { text: string; changed: boolean } {
  let out = '';
  let i = 0;
  let inString = false;
  let escaped = false;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      i += 1;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; i += 1; continue; }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n' && text[i] !== '\r') i += 1;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (ch === '}' || ch === ']') {
      // 非字符串上下文：去掉紧邻的尾逗号（逗号与括号之间只允许空白）
      let k = out.length - 1;
      while (k >= 0 && /\s/.test(out[k])) k -= 1;
      if (k >= 0 && out[k] === ',') out = `${out.slice(0, k)}${out.slice(k + 1)}`;
    }
    out += ch;
    i += 1;
  }
  if (out.charCodeAt(0) === 0xFEFF) out = out.slice(1);
  return { text: out, changed: out !== text };
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
  // stdio 桥接形态（2026-11-18）：条目是 command+args，没有 url/headers——令牌由桥接脚本每次现读，
  // 配置里**不含凭据**。认不出它就会被误判成 missing_auth 并反复要求重写。
  if (isStdioEntry(e)) {
    return markDisabled({ state: 'wired', hasAuth: true, hasClientId: true, transport: 'stdio' }, e);
  }
  const url = typeof e.url === 'string' ? e.url : typeof e.httpUrl === 'string' ? e.httpUrl : undefined;
  if (url !== endpoint) return markDisabled({ state: 'conflict', foundUrl: url, hasAuth: false, transport: 'http' }, e);
  const headers = e.headers;
  const headerBag = headers && typeof headers === 'object' && !Array.isArray(headers)
    ? (headers as Record<string, unknown>)
    : {};
  const readHeader = (key: string): unknown => headerBag[key] ?? headerBag[key.toLowerCase()];
  const auth = readHeader('Authorization');
  const hasAuth = typeof auth === 'string' && /^Bearer\s+\S+/i.test(auth.trim());
  const clientId = readHeader(MCP_CLIENT_HEADER_NAME);
  const found = typeof clientId === 'string' ? clientId.trim() : '';
  // 2026-11-28：不只看「有没有这个头」，还要看值是不是本客户端——Zcode 配置里就曾被写成
  // deepseek-harness，服务端会把 Zcode 的调用记到别的客户端名下（串号），必须能识别出来并提示补写。
  const hasClientId = found.length > 0 && found === spec.id;
  return markDisabled({
    state: hasAuth ? 'wired' : 'missing_auth', foundUrl: url, hasAuth, hasClientId, transport: 'http',
    ...(found && !hasClientId ? { foundClientId: found } : {}),
  }, e);
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
  // stdio 桥接形态（2026-11-18）：command + args 指向桥接脚本，配置里不含令牌
  if (/\bcommand\s*=\s*"/.test(section) && /mcp-bridge\.cjs/.test(section)) {
    const wired: McpConfigProbe = { state: 'wired', hasAuth: true, hasClientId: true, transport: 'stdio' };
    return /\bdisabled\s*=\s*true\b/i.test(section) ? { ...wired, disabled: true } : wired;
  }
  const url = /\b(?:url|http_url)\s*=\s*"([^"]*)"/.exec(section)?.[1];
  if (url !== endpoint) return { state: 'conflict', foundUrl: url, hasAuth: false, transport: 'http' };
  const auth = /\bAuthorization\s*=\s*"([^"]*)"/i.exec(section)?.[1];
  const hasAuth = typeof auth === 'string' && /^Bearer\s+\S+/i.test(auth.trim());
  const hasClientId = tomlHeaderRe(MCP_CLIENT_HEADER_NAME).test(section);
  const probe: McpConfigProbe = {
    state: hasAuth ? 'wired' : 'missing_auth', foundUrl: url, hasAuth, hasClientId, transport: 'http',
  };
  return /\bdisabled\s*=\s*true\b/i.test(section) ? { ...probe, disabled: true } : probe;
}

/** TOML 里某个请求头是否已写（裸键与带引号键两种写法都认） */
function tomlHeaderRe(key: string): RegExp {
  return new RegExp(`(^|[,{\\s"])${escapeRe(key)}"?(?=\\s*=\\s*")`, 'i');
}

/**
 * YAML 插件条目（2026-11-28）：deepseek harness 的 MCP 配置不是 mcpServers 表，而是
 * `~/.dsh/profiles/desktop/cordis.patch.yml` 里一条插件声明：
 * ```
 * - insert:
 *     - id: memagent-mcp
 *       name: '@deepseek-ai/dsh-mcp-client'
 *       config: { serverName: memagent, transport: streamable-http, url: …, headers: {…} }
 * ```
 * 定位规则：找 `- id: <serverKey>`（或 `<serverKey>-mcp`）这一行，块到下一个顶格 `- ` 之前。
 * 纯文本定位、不做 YAML 反序列化——避免把用户文件里的注释、锚点、插件顺序整篇重排。
 */
function yamlItemLineRange(lines: string[], spec: McpClientSpec): { start: number; end: number } | null {
  const idRe = new RegExp(`^\\s*-\\s+id:\\s*${escapeRe(spec.serverKey)}(?:-mcp)?\\s*$`);
  const start = lines.findIndex((l) => idRe.test(l));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^-(?:\s|$)/.test(lines[i])) { end = i; break; }
  }
  return { start, end };
}

/** 判断 YAML 插件条目里本服务的接入状态（只读；不返回令牌） */
export function probeYamlConfig(text: string | null, spec: McpClientSpec, endpoint: string): McpConfigProbe {
  if (text === null) return { state: 'no_config', hasAuth: false };
  const lines = text.split(/\r?\n/);
  const range = yamlItemLineRange(lines, spec);
  if (!range) return { state: 'missing_entry', hasAuth: false };
  const block = lines.slice(range.start, range.end).join('\n');
  const url = /^\s*url:\s*(\S+)\s*$/m.exec(block)?.[1];
  if (url !== endpoint) return { state: 'conflict', foundUrl: url, hasAuth: false, transport: 'http' };
  // 令牌既可能写在 `Authorization: Bearer xxx` 同一行，也可能是 `Bearer` 换行 + 缩进令牌（本机现状）
  const auth = /Authorization:\s*Bearer\s+([^\s#]+)/.exec(block)?.[1];
  const hasAuth = typeof auth === 'string' && auth.length > 0;
  const found = (/X-Memagent-Client:\s*(\S+)/.exec(block)?.[1] ?? '').replace(/^['"]|['"]$/g, '');
  const hasClientId = found.length > 0 && found === spec.id;
  return {
    state: hasAuth ? 'wired' : 'missing_auth', foundUrl: url, hasAuth, hasClientId, transport: 'http',
    ...(found && !hasClientId ? { foundClientId: found } : {}),
  };
}

/** 按配置格式探测；manual = 该客户端没有任何可读配置面（批次28-B：动态配置面 configPath=null 但有 glob，按格式正常探测） */
export function probeClientConfig(
  spec: McpClientSpec, text: string | null, endpoint: string,
): McpConfigProbe {
  if (spec.format === 'unknown') return { state: 'manual', hasAuth: false };
  if (spec.format === 'toml') return probeTomlConfig(text, spec, endpoint);
  if (spec.format === 'yaml') return probeYamlConfig(text, spec, endpoint);
  return probeJsonConfig(text, spec, endpoint);
}

/**
 * 把本服务的 url / 令牌 / 身份头写进 YAML 插件条目（2026-11-28）。
 * 只做三处行级改动：url 行、Authorization 行（含「Bearer 换行 + 缩进令牌」的老写法）、
 * X-Memagent-Client 行（缺则补在 Authorization 之后）。**其它插件、注释、字段、缩进一律不动**。
 * 条目不存在时追加一条标准插件声明；没有 url 字段的条目拒绝猜写（抛错→上层如实报错）。
 */
export function mergeMcpYamlConfig(
  text: string | null, spec: McpClientSpec, endpoint: string, token: string,
): { text: string; changed: boolean } {
  if (spec.format !== 'yaml' || !spec.writable) throw new Error(`E_UNSUPPORTED_CLIENT: ${spec.id}`);
  const source = text ?? '';
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source === '' ? [] : source.split(/\r?\n/);
  const range = yamlItemLineRange(lines, spec);
  if (!range) {
    const plugin = spec.pluginName ?? '@deepseek-ai/dsh-mcp-client';
    const block = [
      '- insert:',
      `    - id: ${spec.serverKey}-mcp`,
      `      name: '${plugin}'`,
      '      config:',
      `        serverName: ${spec.serverKey}`,
      '        transport: streamable-http',
      `        url: ${endpoint}`,
      '        headers:',
      `          Authorization: Bearer ${token}`,
      `          ${MCP_CLIENT_HEADER_NAME}: ${spec.id}`,
      '        failOnStartupError: false',
    ].join(eol);
    const base = source.replace(/\s+$/, '');
    return { text: `${base.length > 0 ? `${base}${eol}${eol}` : ''}${block}${eol}`, changed: true };
  }
  const block = lines.slice(range.start, range.end);
  const urlIdx = block.findIndex((l) => /^\s*url:/.test(l));
  if (urlIdx < 0) throw new Error('E_CONFIG_INVALID: 该插件条目没有 url 字段，拒绝猜测改写');
  const urlIndent = /^(\s*)/.exec(block[urlIdx])?.[1] ?? '';
  block[urlIdx] = `${urlIndent}url: ${endpoint}`;
  const authIdx = block.findIndex((l) => /^\s*Authorization:/.test(l));
  if (authIdx >= 0) {
    const indent = /^(\s*)/.exec(block[authIdx])?.[1] ?? '';
    const inlineValue = /^\s*Authorization:\s*Bearer\s*(\S*)\s*$/.exec(block[authIdx])?.[1] ?? '';
    const nextLine = block[authIdx + 1] ?? '';
    const tokenOnNextLine = inlineValue === '' && /^\s+\S+\s*$/.test(nextLine) && !/^\s*[\w-]+:/.test(nextLine);
    block[authIdx] = `${indent}Authorization: Bearer ${token}`;
    if (tokenOnNextLine) block.splice(authIdx + 1, 1);
    const cidIdx = block.findIndex((l) => /^\s*X-Memagent-Client:/.test(l));
    if (cidIdx >= 0) {
      const cidIndent = /^(\s*)/.exec(block[cidIdx])?.[1] ?? '';
      block[cidIdx] = `${cidIndent}${MCP_CLIENT_HEADER_NAME}: ${spec.id}`;
    } else {
      block.splice(authIdx + 1, 0, `${indent}${MCP_CLIENT_HEADER_NAME}: ${spec.id}`);
    }
  } else {
    const indent = `${urlIndent}  `;
    block.splice(
      urlIdx + 1, 0,
      `${urlIndent}headers:`,
      `${indent}Authorization: Bearer ${token}`,
      `${indent}${MCP_CLIENT_HEADER_NAME}: ${spec.id}`,
    );
  }
  const next = [...lines.slice(0, range.start), ...block, ...lines.slice(range.end)].join(eol);
  return { text: next, changed: next !== source };
}

/** TOML 键：只有非 `[A-Za-z0-9_-]` 才加引号（`X-Memagent-Client` 的短横线本身是合法裸键字符） */
function tomlKey(key: string): string {
  return /^[-A-Za-z0-9_]+$/.test(key) ? key : `"${tomlQuote(key)}"`;
}

/**
 * 把本服务条目并入 JSON 配置（保留其它键与其它 MCP 服务器；同名条目只合并不替换）。
 * 仅允许 writable 的 JSON 客户端；conflict / invalid 由调用方先行拒绝。
 * 传 stdio 时改写为**零维护形态**：清掉 url/httpUrl/type/headers（HTTP 形态的四个字段），
 * 只留 command+args——否则客户端会按 url 走 HTTP，令牌照样被抄在配置里。
 */
export function mergeMcpJsonConfig(
  text: string | null, spec: McpClientSpec, endpoint: string, token: string, stdio?: McpStdioTarget,
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
  let nextEntry = stdio ? buildStdioMcpEntry(spec, stdio) : buildMcpEntry(spec, endpoint, token);
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    const old = existing as Record<string, unknown>;
    const url = typeof old.url === 'string' ? old.url : typeof old.httpUrl === 'string' ? old.httpUrl : undefined;
    if (url !== undefined && url !== endpoint) throw new Error('E_CONFIG_CONFLICT: 同名条目指向其它端点');
    // 保留条目上的其它字段（如 qoder_url）与其它请求头，只覆盖本服务需要的字段
    if (stdio) {
      const kept: Record<string, unknown> = { ...old };
      for (const k of ['url', 'httpUrl', 'type', 'headers']) delete kept[k];
      nextEntry = { ...kept, ...nextEntry };
    } else {
      const oldHeaders = old.headers && typeof old.headers === 'object' && !Array.isArray(old.headers)
        ? (old.headers as Record<string, unknown>)
        : {};
      nextEntry = { ...old, ...nextEntry, headers: { ...oldHeaders, ...(nextEntry.headers as Record<string, unknown>) } };
    }
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
 * stdio 形态的 TOML 段重建（2026-11-18）：本服务段整个换成 `command` + `args`。
 * 本服务段是**我们自己的**段，重建时连带丢掉它名下的子表（`.http_headers` / `.env`）——
 * 留着它们会让客户端同时看到「启动命令」和「HTTP 请求头」两套互相矛盾的配置。
 * 其它段与其它客户端条目一律原样保留（只跳过本服务段体）。
 */
function mergeTomlStdioSection(
  source: string, spec: McpClientSpec, eol: string, stdio: McpStdioTarget,
): { text: string; changed: boolean } {
  const lines = source.split(/\r?\n/);
  const headerRe = new RegExp(`^\\s*\\[mcp_servers\\.${escapeRe(spec.serverKey)}\\]\\s*$`);
  const ownRe = new RegExp(`^\\s*\\[mcp_servers\\.${escapeRe(spec.serverKey)}(?:\\.|\\])`);
  const args = buildStdioMcpEntry(spec, stdio).args as string[];
  const body = [
    `command = "${MCP_STDIO_COMMAND}"`,
    `args = [${args.map((a) => `"${tomlQuote(a)}"`).join(', ')}]`,
  ];
  const headerIdx = lines.findIndex((l) => headerRe.test(l));
  if (headerIdx === -1) {
    const block = [`[mcp_servers.${spec.serverKey}]`, ...body].join(eol);
    const base = source.trimEnd();
    return { text: `${base.length > 0 ? `${base}${eol}${eol}` : ''}${block}${eol}`, changed: true };
  }
  // 冲突拒绝：本服务段里的 url 指向别的端点 → 不覆盖（与 HTTP 形态同口径）
  const rest = lines.slice(headerIdx + 1);
  const scanned: string[] = [];
  for (const line of rest) {
    if (/^\s*\[/.test(line) && !ownRe.test(line)) break;
    scanned.push(line);
  }
  const foundUrl = /\b(?:url|http_url)\s*=\s*"([^"]*)"/.exec(scanned.join('\n'))?.[1];
  if (foundUrl !== undefined && foundUrl !== stdio.endpoint) {
    throw new Error('E_CONFIG_CONFLICT: 同名条目指向其它端点');
  }
  const out: string[] = [];
  let insertAt = -1;
  let mode: 'other' | 'main' | 'ownSub' = 'other';
  for (const line of lines) {
    if (/^\s*\[/.test(line)) {
      if (headerRe.test(line)) { mode = 'main'; out.push(line); insertAt = out.length; continue; }
      if (ownRe.test(line)) { mode = 'ownSub'; continue; }
      mode = 'other';
    }
    if (mode !== 'other') continue;
    out.push(line);
  }
  while (insertAt >= 0 && insertAt < out.length && out[insertAt].trim() === '') out.splice(insertAt, 1);
  out.splice(insertAt, 0, ...body);
  const text = out.join(eol);
  return { text, changed: text !== source };
}

/**
 * 把本服务条目并入 TOML 配置（批次23：Codex 等 [mcp_servers.<key>] 客户端）。
 * 保留其它段与其它请求头；已有同名段只补齐/修正 Authorization；同名段指向其它端点 → 拒绝覆盖。
 * 支持两种写法：段内 `http_headers = { Authorization = "..." }`，或子表 `[mcp_servers.<key>.http_headers]`。
 * 传 stdio 时改写为零维护形态（command + args，不含令牌），见 mergeTomlStdioSection。
 */
export function mergeMcpTomlConfig(
  text: string | null, spec: McpClientSpec, endpoint: string, token: string, stdio?: McpStdioTarget,
): { text: string; changed: boolean } {
  if (spec.format !== 'toml' || !spec.writable) throw new Error(`E_UNSUPPORTED_CLIENT: ${spec.id}`);
  const source = text ?? '';
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  if (stdio) return mergeTomlStdioSection(source, spec, eol, stdio);
  const lines = source.split(/\r?\n/);
  const headerRe = new RegExp(`^\\s*\\[mcp_servers\\.${escapeRe(spec.serverKey)}\\]\\s*$`);
  const ownRe = new RegExp(`^\\s*\\[mcp_servers\\.${escapeRe(spec.serverKey)}(?:\\.|\\])`);
  const headerIdx = lines.findIndex((l) => headerRe.test(l));
  const pairs = mcpHeaderPairs(spec, token);
  const assignments = pairs.map((p) => `${tomlKey(p.key)} = "${tomlQuote(p.value)}"`);

  if (headerIdx === -1) {
    const block = [
      `[mcp_servers.${spec.serverKey}]`,
      `url = "${tomlQuote(endpoint)}"`,
      `http_headers = { ${assignments.join(', ')} }`,
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

  // 形式一：子表 [mcp_servers.<key>.http_headers]——逐个头补齐/修正，缺的追加在子表末尾
  const childRe = new RegExp(`^\\s*\\[mcp_servers\\.${escapeRe(spec.serverKey)}\\.http_headers\\]\\s*$`);
  const childIdx = lines.findIndex((l, i) => i > headerIdx && i < sectionEnd && childRe.test(l));
  if (childIdx !== -1) {
    let childEnd = sectionEnd;
    for (let i = childIdx + 1; i < sectionEnd; i += 1) {
      if (/^\s*\[/.test(lines[i])) { childEnd = i; break; }
    }
    const childBody = lines.slice(childIdx + 1, childEnd);
    let changed = false;
    for (const pair of pairs) {
      const want = tomlQuote(pair.value);
      const lineRe = new RegExp(`^(\\s*)"?${escapeRe(pair.key)}"?\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"\\s*$`, 'i');
      const at = childBody.findIndex((l) => lineRe.test(l));
      if (at === -1) {
        childBody.push(`${tomlKey(pair.key)} = "${want}"`);
        changed = true;
        continue;
      }
      const m = lineRe.exec(childBody[at])!;
      if (m[2] === want) continue;
      childBody[at] = `${m[1]}${tomlKey(pair.key)} = "${want}"`;
      changed = true;
    }
    if (!changed) return { text: source, changed: false };
    lines.splice(childIdx + 1, childEnd - childIdx - 1, ...childBody);
    return { text: lines.join(eol), changed: true };
  }

  // 形式二：段内内联表 http_headers = { ... }——只动本服务需要的头，其它键原样保留
  const inlineIdx = lines.findIndex(
    (l, i) => i > headerIdx && i < sectionEnd && /\bhttp_headers\s*=\s*\{/.test(l),
  );
  if (inlineIdx !== -1) {
    const line = lines[inlineIdx];
    const open = line.indexOf('{');
    const close = line.lastIndexOf('}');
    if (open !== -1 && close > open) {
      let inner = line.slice(open + 1, close);
      let changed = false;
      for (const pair of pairs) {
        const want = tomlQuote(pair.value);
        const pairRe = new RegExp(`(^|[{,\\s"])${escapeRe(pair.key)}"?\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`);
        const m = pairRe.exec(inner);
        if (m) {
          if (m[2] === want) continue;
          inner = `${inner.slice(0, m.index)}${m[1]}${tomlKey(pair.key)} = "${want}"${inner.slice(m.index + m[0].length)}`;
          changed = true;
          continue;
        }
        const trimmed = inner.trimEnd();
        const sep = trimmed.trim().length === 0 ? ' ' : trimmed.endsWith(',') ? ' ' : ', ';
        inner = `${trimmed}${sep}${tomlKey(pair.key)} = "${want}"`;
        changed = true;
      }
      if (!changed) return { text: source, changed: false };
      lines[inlineIdx] = `${line.slice(0, open + 1)}${inner}${line.slice(close)}`;
      return { text: lines.join(eol), changed: true };
    }
  }

  // 形式三：段内没有 http_headers → 紧跟 url 行补一行
  const urlIdx = lines.findIndex((l, i) => i > headerIdx && i < sectionEnd && /\b(?:url|http_url)\s*=/.test(l));
  const insertAt = urlIdx === -1 ? headerIdx + 1 : urlIdx + 1;
  lines.splice(insertAt, 0, `http_headers = { ${assignments.join(', ')} }`);
  return { text: lines.join(eol), changed: true };
}
