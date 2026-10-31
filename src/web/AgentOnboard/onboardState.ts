// Agent 接入页「已接入」状态持久化（localStorage，跨 iframe 共享、切页/重载保持）。
// 用途：登录即触发自动接入；接入过一次后，切走再切回不重扫（保持已接入状态）。
//   - onboarding 完成后写 agentOnboardState = { lastOnboardAt, agentNames }
//   - 页面挂载时先读：有 → 恢复"已完成"态（scanState=已完成、各 agent 已绑定），跳过重扫
//   - 无 → 自动触发接入
// localStorage 同域跨 iframe 可用（crossTabAuth 同款机制），刷新/切视图不丢。
import type { DiscoveredAgent, InstalledAgent } from '../../types/agentOnboard.ts';

const KEY = 'agentOnboardState';
/** storage 事件监听用（跨 iframe 登录自动接入完成后刷新接入页） */
export const ONBOARD_STATE_KEY = KEY;

/** MCP 自动写入结果（登录自动接入时对可写 JSON 客户端执行） */
export interface OnboardMcpSummary {
  endpoint: string;
  /** 接入成功（本次新写入 + 之前已接入）的客户端名 */
  wired: string[];
  /** 本次新写入的客户端名（wired 的子集） */
  changed: string[];
  /** 仅能手工配置的客户端（无稳定可写配置/TOML/未知格式） */
  manual: string[];
  /** 写入失败（无管理员会话/冲突/文件不可写） */
  failed: Array<{ client: string; reason: string }>;
}

export interface OnboardState {
  /** 最近一次自动/手动完成接入的时间戳 */
  lastOnboardAt: number;
  /** 接入时发现并绑定的 agent 名列表（恢复 UI 用） */
  agentNames: string[];
  /** 数据来源：host=宿主真扫 / kernel=内核模拟降级 */
  source: 'host' | 'kernel';
  /** 真实发现行（含信号/来源），恢复发现列表用 */
  discovered?: DiscoveredAgent[];
  /** 五路安装痕迹探测结果（已安装列表） */
  installed?: InstalledAgent[];
  /** 安装探测自检（命令/agent → 结果，UI 展示真实原因） */
  installedProbes?: Record<string, string>;
  /** MCP 自动写入结果 */
  mcp?: OnboardMcpSummary;
  /** 接入后端 auto_bind 是否成功（false → 卡片指标暂无真实样本） */
  backendOk?: boolean;
  /** 接入后端失败原因（network/HTTP 错误） */
  backendError?: string;
  /** 状态版本（storage 事件去重） */
  seq?: number;
}

export function readOnboardState(): OnboardState | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as OnboardState;
    if (typeof p?.lastOnboardAt !== 'number' || !Array.isArray(p?.agentNames)) return null;
    return p;
  } catch {
    return null;
  }
}

export function writeOnboardState(s: OnboardState): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(s));
}

/** 清除「已接入」标记（登出时调用，下次登录需重新接入） */
export function clearOnboardState(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(KEY);
}

