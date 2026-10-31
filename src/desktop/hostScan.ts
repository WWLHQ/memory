// 宿主真扫（discover 真实化）· 纯类型 + 纯匹配层（零 node 依赖，可安全打进浏览器包）。
//  · 类型：HostScanResult / HostAgentFound / AgentFingerprint（UI 同构，badge p0→p3）
//  · 纯函数：matchAgentsFromProcesses / matchAgentsFromMcp / matchAgentsFromConfigFiles / mergeHostAgents（可单测）
//  · 实际进程枚举 / 注册表探测 / 配置文件探测的 IO 在 src/electron/hostScan.ts（node 层），渲染层经
//    window.api.hostScan.run() 调主进程；纯浏览器无此能力 → 降级内核 discover 并标注「本地模拟」。
// 边界：仅本文件 + electron 实现；页面 createMemAgent 无感知。

export interface AgentFingerprint {
  name: string;
  badge: 'p0' | 'p1' | 'p2' | 'p3';
  label: string;
  procPatterns: string[];
  mcpPatterns?: string[];
  /** agent 配置文件特征片段（匹配探测到的配置路径；纯 fs，无需 spawn 子进程） */
  configPatterns?: string[];
}

/** 已知 agent 指纹（按优先级 p0→p3 排列；匹配首个命中即归并，避免重复） */
export const AGENT_FINGERPRINTS: AgentFingerprint[] = [
  {
    name: 'deepseek harness', badge: 'p0', label: 'MVP·P0',
    procPatterns: ['deepseek', 'harness'],
    mcpPatterns: ['deepseek'],
    configPatterns: ['.deepseek', 'deepseek'],
  },
  {
    name: 'Claude Code', badge: 'p1', label: 'MVP·P1',
    procPatterns: ['claude', 'cladecode'],
    mcpPatterns: ['claude'],
    configPatterns: ['.claude'],
  },
  {
    name: 'Codex', badge: 'p2', label: '兜底·P2',
    procPatterns: ['codex', 'openai'],
    mcpPatterns: ['codex'],
    configPatterns: ['.codex'],
  },
  {
    name: 'Cursor', badge: 'p3', label: '扩展·P3',
    procPatterns: ['cursor'],
    mcpPatterns: ['cursor'],
    configPatterns: ['.cursor'],
  },
  // ---------- 后续扩展（2026-10-24）：本机已装 agent 检测 ----------
  {
    name: 'WorkBuddy', badge: 'p3', label: '扩展·P3',
    procPatterns: ['workbuddy'],
    mcpPatterns: ['workbuddy'],
    configPatterns: ['.workbuddy'],
  },
  {
    name: 'Gemini CLI', badge: 'p3', label: '扩展·P3',
    procPatterns: ['gemini', 'gemini-cli'],
    mcpPatterns: ['gemini'],
    configPatterns: ['.gemini', 'gemini-cli'],
  },
  {
    name: 'Qwen Code', badge: 'p3', label: '扩展·P3',
    procPatterns: ['qwen', 'qwen-code'],
    mcpPatterns: ['qwen'],
    configPatterns: ['.qwen', 'qwen-code'],
  },
  {
    name: 'Amp', badge: 'p3', label: '扩展·P3',
    procPatterns: ['amp'],
    mcpPatterns: ['amp'],
    configPatterns: ['.amp'],
  },
  {
    name: 'iFlow CLI', badge: 'p3', label: '扩展·P3',
    procPatterns: ['iflow'],
    mcpPatterns: ['iflow'],
    configPatterns: ['.iflow'],
  },
  // ---------- 国内 IDE/Agent 扩展（2026-10-24 补充） ----------
  {
    name: 'Qoder CN', badge: 'p3', label: '扩展·P3',
    procPatterns: ['qoder'],
    mcpPatterns: ['qoder'],
    configPatterns: ['.qoder', 'qoder'],
  },
  {
    name: 'Trae Code CN', badge: 'p3', label: '扩展·P3',
    procPatterns: ['trae', 'traecode'],
    mcpPatterns: ['trae'],
    configPatterns: ['.trae', 'trae'],
  },
  {
    name: 'Zcode', badge: 'p3', label: '扩展·P3',
    procPatterns: ['zcode', 'z-code'],
    mcpPatterns: ['zcode'],
    configPatterns: ['.zcode', 'z-code'],
  },
];

export interface HostAgentFound {
  name: string;
  badge: AgentFingerprint['badge'];
  label: AgentFingerprint['label'];
  /** 真实来源：命中的进程名 / MCP 配置标识 / 配置文件路径（可溯源，不造假） */
  source: string;
  /** 检测信号类型（proc / mcp / config） */
  signal: 'proc' | 'mcp' | 'config';
}

export interface HostScanResult {
  /** 真实扫描命中的 agent（无命中 → 空数组，绝不造假） */
  found: HostAgentFound[];
  /** 本次扫描的原始证据（进程名样本 + 命中的配置文件路径），供 UI 展示「数据来源」 */
  evidence: { processNames: string[]; configFiles: string[] };
  /** 运行平台（宿主真扫的真实上下文） */
  platform: string;
  /** 扫描是否成功（进程表读取失败 → false，UI 据此标注降级） */
  ok: boolean;
  scannedAt: number;
  /** 各路信号源的自检结果（成功/失败原因），供 UI 展示真实降级原因 */
  probes?: { proc: string; mcp: string; config: string };
}

const RANK: Record<string, number> = { p0: 0, p1: 1, p2: 2, p3: 3 };

/** 把进程名按指纹归并出命中的 agent（纯函数，可单测） */
export function matchAgentsFromProcesses(
  processNames: string[],
  fingerprints = AGENT_FINGERPRINTS,
): HostAgentFound[] {
  const lower = processNames.map((n) => n.toLowerCase());
  const out: HostAgentFound[] = [];
  for (const fp of fingerprints) {
    const hit = lower.find((n) => fp.procPatterns.some((p) => n.includes(p)));
    if (hit) out.push({ name: fp.name, badge: fp.badge, label: fp.label, source: hit, signal: 'proc' });
  }
  return out;
}

/** 把 MCP 配置标识按指纹归并（纯函数，可单测） */
export function matchAgentsFromMcp(
  mcpEntries: string[],
  fingerprints = AGENT_FINGERPRINTS,
): HostAgentFound[] {
  const lower = mcpEntries.map((n) => n.toLowerCase());
  const out: HostAgentFound[] = [];
  for (const fp of fingerprints) {
    if (!fp.mcpPatterns) continue;
    const mcpPats = fp.mcpPatterns;
    const hit = lower.find((n) => mcpPats.some((p) => n.includes(p)));
    if (hit) out.push({ name: fp.name, badge: fp.badge, label: fp.label, source: `mcp:${hit}`, signal: 'mcp' });
  }
  return out;
}

/**
 * 把探测到的 agent 配置文件路径按指纹归并（纯函数，可单测）。
 * 第三路信号：纯 fs 探测，不依赖 spawn 子进程 —— 被安全软件/受限终端拦截时仍能给出真实证据。
 */
export function matchAgentsFromConfigFiles(
  configPaths: string[],
  fingerprints = AGENT_FINGERPRINTS,
): HostAgentFound[] {
  const lower = configPaths.map((p) => p.replace(/\\/g, '/').toLowerCase());
  const out: HostAgentFound[] = [];
  for (const fp of fingerprints) {
    if (!fp.configPatterns?.length) continue;
    const hit = lower.find((p) => fp.configPatterns!.some((c) => p.includes(c)));
    if (hit) out.push({ name: fp.name, badge: fp.badge, label: fp.label, source: `config:${hit}`, signal: 'config' });
  }
  return out;
}

/** 合并多路命中并按 badge 优先级去重（同名 agent 只保留一条，proc 优先） */
export function mergeHostAgents(...hitGroups: HostAgentFound[][]): HostAgentFound[] {
  const byName = new Map<string, HostAgentFound>();
  for (const h of hitGroups.flat()) {
    const cur = byName.get(h.name);
    if (!cur || RANK[h.badge] < RANK[cur.badge]) byName.set(h.name, h);
  }
  return [...byName.values()].sort((a, b) => RANK[a.badge] - RANK[b.badge]);
}

/** 渲染层经 preload 暴露的宿主真扫 API 形状（window.api.hostScan） */
export interface HostScanApi {
  /** 同步返回一次真实宿主扫描结果（主进程执行；IPC 桥接） */
  run: () => Promise<HostScanResult>;
}
