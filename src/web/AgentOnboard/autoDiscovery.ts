// 登录自动发现链路（批次16）：三路真实信号合并 + 对可写 JSON 客户端自动写入 MCP。
//  ① hostScan:run        —— 本机进程 / MCP 注册表 / agent 配置文件（宿主真扫）
//  ② hostAgentDetect:run —— 五路安装痕迹（CLI where/which / 安装目录 exe / 开始菜单 / 配置 / 注册表卸载项）
//  ③ mcp:clients         —— 各 MCP 客户端配置文件真实内容（wired/missing_auth/…）
// 纯浏览器无宿主能力 → 如实返回失败（绝不使用内核模拟冒充本机命中）。
import type {
  BadgeClass, DiscoveredAgent, InstalledAgent,
} from '../../types/agentOnboard.ts';
import type { HostScanResult } from '../../desktop/hostScan.ts';
import { hostCall, hostCapability } from '../../desktop/hostBridge.ts';
import {
  MCP_CLIENT_SPECS, MCP_ENDPOINT, type McpClientSpec, type McpWireState,
} from '../../agentOnboard/mcpClients.ts';
import type { OnboardMcpSummary } from './onboardState.ts';
import { currentSessionId } from '../shared/session.ts';

export interface McpClientRow {
  id: string;
  name: string;
  state: McpWireState;
  writable: boolean;
  format: string;
  installed: boolean;
  displayPath?: string | null;
  error?: string;
  foundUrl?: string;
}

export interface HostInstallScan {
  found: InstalledAgent[];
  probes: Record<string, string>;
  err: string | null;
}

export interface LocalAgentScan {
  /** 至少一路真实扫描成功（零命中仍是成功扫描） */
  ok: boolean;
  capability: 'native' | 'bridge' | 'none';
  source: 'host' | 'browser';
  discovered: DiscoveredAgent[];
  installed: InstalledAgent[];
  installedProbes: Record<string, string>;
  mcpClients: McpClientRow[];
  endpoint: string;
  /** 各路扫描的真实失败原因 */
  errors: string[];
  scannedAt: number;
}

const BADGE_RANK: Record<BadgeClass, number> = { p0: 0, p1: 1, p2: 2, p3: 3 };

function keyOf(name: string): string {
  return name.trim().toLowerCase();
}

function errText(e: unknown): string {
  return (e as Error)?.message ?? String(e);
}

function mergeDiscovered(
  hostFound: HostScanResult['found'],
  installed: InstalledAgent[],
): DiscoveredAgent[] {
  const byName = new Map<string, DiscoveredAgent>();
  for (const f of installed) {
    byName.set(keyOf(f.agent), {
      name: f.agent,
      badge: f.badge,
      label: f.label,
      signal: `安装痕迹（${f.via}）· ${f.source}`,
      bound: true,
      ok: true,
      source: 'host',
    });
  }
  for (const f of hostFound) {
    const key = keyOf(f.name);
    const hit = byName.get(key);
    const signal = `${f.signal} · ${f.source}`;
    if (!hit) {
      byName.set(key, { name: f.name, badge: f.badge, label: f.label, signal, bound: true, ok: true, source: 'host' });
    } else if (!hit.signal.startsWith(f.signal)) {
      hit.signal = `${signal}；${hit.signal}`;
    }
  }
  return [...byName.values()].sort((a, b) => BADGE_RANK[a.badge] - BADGE_RANK[b.badge]);
}

/**
 * 三路真实扫描并合并。Promise.allSettled：任一路失败不影响其它路，
 * 失败原因全部带出（UI 如实展示，绝不把失败当「未安装」）。
 */
export async function scanLocalAgents(): Promise<LocalAgentScan> {
  const capability = hostCapability();
  const base: LocalAgentScan = {
    ok: false, capability, source: capability === 'none' ? 'browser' : 'host',
    discovered: [], installed: [], installedProbes: {}, mcpClients: [],
    endpoint: MCP_ENDPOINT, errors: [], scannedAt: Date.now(),
  };
  if (capability === 'none') {
    return { ...base, errors: ['非桌面壳环境：浏览器无法读取本机进程/安装痕迹，请使用桌面应用'] };
  }

  const [hostR, installR, mcpR] = await Promise.allSettled([
    hostCall<HostScanResult>('hostScan:run'),
    hostCall<HostInstallScan>('hostAgentDetect:run'),
    hostCall<{ endpoint?: string; clients?: McpClientRow[] }>('mcp:clients', [currentSessionId()]),
  ]);

  const errors: string[] = [];
  let hostOk = false;
  let hostFound: HostScanResult['found'] = [];
  if (hostR.status === 'fulfilled' && hostR.value) {
    hostFound = Array.isArray(hostR.value.found) ? hostR.value.found : [];
    hostOk = hostR.value.ok === true || hostFound.length > 0;
    if (!hostR.value.ok) {
      const probes = hostR.value.probes
        ? Object.entries(hostR.value.probes).filter(([, v]) => String(v).startsWith('失败'))
        : [];
      errors.push(`宿主扫描部分失败${probes.length ? `（${probes.map(([k, v]) => `${k}=${v}`).join('; ')}）` : ''}`);
    }
  } else {
    errors.push(`宿主扫描失败：${hostR.status === 'rejected' ? errText(hostR.reason) : '无返回'}`);
  }

  let installOk = false;
  let installed: InstalledAgent[] = [];
  let installedProbes: Record<string, string> = {};
  if (installR.status === 'fulfilled' && installR.value) {
    installOk = true;
    const raw = Array.isArray(installR.value.found) ? installR.value.found : [];
    installed = raw.filter((f) => f && typeof f.agent === 'string' && f.agent.trim());
    installedProbes = installR.value.probes && typeof installR.value.probes === 'object'
      ? installR.value.probes
      : {};
    if (installR.value.err) errors.push(`安装痕迹探测部分失败：${installR.value.err}`);
  } else {
    errors.push(`安装痕迹探测失败：${installR.status === 'rejected' ? errText(installR.reason) : '无返回'}`);
  }

  let mcpClients: McpClientRow[] = [];
  let endpoint = MCP_ENDPOINT;
  if (mcpR.status === 'fulfilled' && mcpR.value) {
    mcpClients = Array.isArray(mcpR.value.clients) ? mcpR.value.clients : [];
    if (typeof mcpR.value.endpoint === 'string' && mcpR.value.endpoint) endpoint = mcpR.value.endpoint;
  } else {
    errors.push(`MCP 客户端配置扫描失败：${mcpR.status === 'rejected' ? errText(mcpR.reason) : '无返回'}`);
  }

  return {
    ...base,
    ok: hostOk || installOk,
    discovered: mergeDiscovered(hostFound, installed),
    installed,
    installedProbes,
    mcpClients,
    endpoint,
    errors,
    scannedAt: Date.now(),
  };
}

/** agent 名 → MCP 客户端配方（同名；未收录 → undefined） */
export function mcpSpecForAgent(name: string): McpClientSpec | undefined {
  const key = keyOf(name);
  return MCP_CLIENT_SPECS.find((s) => keyOf(s.name) === key);
}

/**
 * 对「已连通」的 agent 自动写入 MCP 配置（仅管理员 + 已知结构客户端，JSON/TOML 均可）。
 * 客户端未收录/未知格式 → 记「需手工」，不伪造已接入；
 * 冲突/无法解析/无会话/无权限 → 记失败并带真实原因。
 */
export async function autoWireMcpForAgents(
  agentNames: string[],
  scan: Pick<LocalAgentScan, 'capability' | 'mcpClients' | 'endpoint'>,
  session: { sid: string | null; role: 'admin' | 'member' | null },
): Promise<OnboardMcpSummary> {
  const summary: OnboardMcpSummary = {
    endpoint: scan.endpoint,
    wired: [], changed: [], manual: [], failed: [],
  };
  const seen = new Set<string>();
  for (const name of agentNames) {
    const key = keyOf(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const spec = mcpSpecForAgent(name);
    if (!spec) continue; // 不是 MCP 客户端（如 Amp/iFlow）：无配置可写，不计入
    if (!spec.writable) {
      summary.manual.push(spec.name);
      continue;
    }
    const row = scan.mcpClients.find((c) => c.id === spec.id);
    if (row?.state === 'wired') {
      summary.wired.push(spec.name);
      continue;
    }
    if (row?.state === 'conflict') {
      summary.failed.push({ client: spec.name, reason: `同名条目指向其它端点（${row.foundUrl ?? '未填写'}），拒绝覆盖` });
      continue;
    }
    if (row?.state === 'invalid') {
      summary.failed.push({ client: spec.name, reason: `配置文件无法解析：${row.error ?? '格式错误'}` });
      continue;
    }
    if (scan.capability === 'none') {
      summary.failed.push({ client: spec.name, reason: '浏览器模式无法写本机配置' });
      continue;
    }
    if (!session.sid) {
      summary.failed.push({ client: spec.name, reason: '无登录会话，无法校验管理员权限' });
      continue;
    }
    if (session.role !== 'admin') {
      summary.failed.push({ client: spec.name, reason: '需管理员权限才能写入 MCP 配置' });
      continue;
    }
    try {
      const r = await hostCall<{ ok: boolean; changed?: boolean; error?: string }>(
        'mcp:clientWire', [spec.id, session.sid],
      );
      if (r?.ok) {
        summary.wired.push(spec.name);
        if (r.changed) summary.changed.push(spec.name);
      } else {
        summary.failed.push({ client: spec.name, reason: r?.error ?? '写入失败（未知原因）' });
      }
    } catch (e) {
      summary.failed.push({ client: spec.name, reason: `写入失败：${errText(e)}` });
    }
  }
  return summary;
}
