// 接入页组件单测夹具（仅测试用；页面卡片由真实接入名单生成，无演示卡片）。
import type { DiscoveredAgent, UiAgentCard } from '../../../types/agentOnboard.ts';

export const SEED_AGENTS: UiAgentCard[] = [
  {
    name: 'deepseek harness', badge: 'p0', label: 'MVP·P0', method: 'MCP + Webhook 直连（自有）',
    conn: 99.2, circuit: 'CLOSED', latency: 1.2, fail: 0, recover: 0, tenant: 'ent_001 / team_001',
    tools: { recall: { on: true, topk: 5, scene: 'task_start', mode: '' }, write: { on: true }, pref: { on: true } },
    iso: { projShare: true, prefCross: true },
    chan: { webhook: true, api: true, recon: '5min' },
    key: { mask: '[API_KEY:harness]', last: '未记录', grace: 24 },
    state: 'connected',
  },
  {
    name: 'Claude Code', badge: 'p1', label: 'MVP·P1', method: 'MCP 工具 + 会话日志兜底（第三方样板）',
    conn: 98.1, circuit: 'CLOSED', latency: 1.4, fail: 0, recover: 0, tenant: 'ent_001 / team_001',
    tools: { recall: { on: true, topk: 5, scene: 'default', mode: '' }, write: { on: true }, pref: { on: true } },
    iso: { projShare: true, prefCross: true },
    chan: { webhook: true, api: true, recon: '5min' },
    key: { mask: '[API_KEY:claude]', last: '未记录', grace: 24 },
    state: 'connected',
  },
  {
    name: 'Codex', badge: 'p2', label: '兜底·P2', method: 'MCP（若支持）+ API 拉取兜底',
    conn: 93.5, circuit: 'CLOSED', latency: 1.8, fail: 0, recover: 0, tenant: 'ent_001 / team_001',
    // 原型此处 pref 就是布尔 false（表示该工具未启用），勿"修正"为对象
    tools: { recall: { on: true, topk: 5, scene: 'default', mode: '' }, write: { on: true }, pref: false },
    iso: { projShare: true, prefCross: true },
    chan: { webhook: false, api: true, recon: '5min' },
    key: { mask: '[API_KEY:codex]', last: '未记录', grace: 24 },
    state: 'degraded',
  },
];

export const SEED_DISCOVERED: DiscoveredAgent[] = [
  { name: 'deepseek harness', badge: 'p0', label: 'MVP·P0', signal: 'MCP 注册表 + 本机进程', bound: true, ok: true, source: 'kernel' },
  { name: 'Claude Code', badge: 'p1', label: 'MVP·P1', signal: 'MCP 注册表 + Webhook 心跳', bound: true, ok: true, source: 'kernel' },
  { name: 'Codex', badge: 'p2', label: '兜底·P2', signal: '本机进程 + API 拉取兜底', bound: true, ok: false, source: 'kernel' },
];
