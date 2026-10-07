// 按端置灰矩阵 (REQ-003 §9 / 19.10 / T10)
// 纯函数：给定当前端 form，返回可用信号源；被渲染与"发现"逻辑复用。
//
// 端谱（19.11）：desktop(P0 主源) / web / mobile / mac / linux / cli
// 信号源：MCP注册表 / 本机进程 / Webhook心跳 / 手动兜底
// 置灰规则（§9 矩阵）：
//   桌面 全开；Web 关「本机进程」；移动 关「本机进程/注册表」；CLI 关「Webhook 心跳」改命令

import type { Form } from '../types/agentOnboard.ts';

export const SIGNAL_SOURCES = ['MCP注册表', '本机进程', 'Webhook心跳', '手动兜底'] as const;
export type SignalSource = (typeof SIGNAL_SOURCES)[number];

/** 当前端可用的信号源列表（已置灰项不返回）。 */
export function signalSourcesForForm(form: Form): SignalSource[] {
  switch (form) {
    case 'desktop':
    case 'mac':
    case 'linux':
      return [...SIGNAL_SOURCES]; // 桌面/类桌面全开
    case 'web':
      return SIGNAL_SOURCES.filter((s) => s !== '本机进程');
    case 'mobile':
      return SIGNAL_SOURCES.filter((s) => s !== '本机进程' && s !== 'MCP注册表');
    case 'cli':
      return SIGNAL_SOURCES.filter((s) => s !== 'Webhook心跳'); // CLI 改命令探测
    default:
      return [...SIGNAL_SOURCES];
  }
}

/** 某信号源在当前端是否被置灰（不可勾、不渲染发现）。 */
export function isSourceGrayed(form: Form, source: SignalSource): boolean {
  return !signalSourcesForForm(form).includes(source);
}