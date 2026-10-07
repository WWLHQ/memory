// 初始数据 —— 逐字对齐 design/ui/Agent接入页_原型.html 的 AGENTS / DISCOVERED / GAINS。
// ⚠ 唯一数据来源；改动须回到原型对齐，禁止自创。
import type { DiscoveredAgent, Gain, UiAgentCard } from '../../types/agentOnboard.ts';

export const SEED_AGENTS: UiAgentCard[] = [
  {
    name: 'deepseek harness', badge: 'p0', label: 'MVP·P0', method: 'MCP + Webhook 直连（自有）',
    conn: 99.2, circuit: 'CLOSED', latency: 1.2, fail: 0, recover: 0, tenant: 'ent_001 / team_001',
    tools: { recall: { on: true, topk: 5, scene: 'task_start', mode: '' }, write: { on: true }, pref: { on: true } },
    iso: { projShare: true, prefCross: true },
    chan: { webhook: true, api: true, recon: '5min' },
    key: { mask: '[API_KEY:harness]', last: '32 天前', grace: 24 },
    state: 'connected',
  },
  {
    name: 'Claude Code', badge: 'p1', label: 'MVP·P1', method: 'MCP 工具 + 会话日志兜底（第三方样板）',
    conn: 98.1, circuit: 'CLOSED', latency: 1.4, fail: 0, recover: 0, tenant: 'ent_001 / team_001',
    tools: { recall: { on: true, topk: 5, scene: 'default', mode: '' }, write: { on: true }, pref: { on: true } },
    iso: { projShare: true, prefCross: true },
    chan: { webhook: true, api: true, recon: '5min' },
    key: { mask: '[API_KEY:claude]', last: '5 天前', grace: 24 },
    state: 'connected',
  },
  {
    name: 'Codex', badge: 'p2', label: '兜底·P2', method: 'MCP（若支持）+ API 拉取兜底',
    conn: 93.5, circuit: 'OPEN', latency: 6.1, fail: 5, recover: 60, tenant: 'ent_001 / team_001',
    // 原型此处 pref 就是布尔 false（表示该工具未启用），勿"修正"为对象
    tools: { recall: { on: true, topk: 5, scene: 'default', mode: '' }, write: { on: true }, pref: false },
    iso: { projShare: true, prefCross: true },
    chan: { webhook: false, api: true, recon: '5min' },
    key: { mask: '[API_KEY:codex]', last: '92 天前', grace: 24 },
    state: 'degraded',
  },
];

export const SEED_DISCOVERED: DiscoveredAgent[] = [
  { name: 'deepseek harness', badge: 'p0', label: 'MVP·P0', signal: 'MCP 注册表 + 本机进程', bound: true, ok: true },
  { name: 'Claude Code', badge: 'p1', label: 'MVP·P1', signal: 'MCP 注册表 + Webhook 心跳', bound: true, ok: true },
  { name: 'Codex', badge: 'p2', label: '兜底·P2', signal: '本机进程 + API 拉取兜底', bound: true, ok: false },
  { name: 'Cursor', badge: 'p3', label: '扩展·P3', signal: '未发现信号', bound: false, ok: false },
];

export const SEED_GAINS: Gain[] = [
  {
    icon: '🪙', title: 'Token 节省', big: '-58%',
    desc: '本周期 Agent 平均每次召回 <b>payload 780/1500</b>；极简模式短查询仅 <b>≤600t</b>，对比全量召回数千 token。次模式注入 <b>≤200t 占位符</b>而非全文。',
    src: '2.4.1 三档预算 / 2.4.3 占位符注入 / 检索页预算面板',
  },
  {
    icon: '⚡', title: '效率提升', big: '-34% 背景交代',
    desc: '跨会话已记住项目技术栈/约束/决策，<b>新会话免重复贴说明</b>；踩坑库自动召回，<b>少犯同类错</b>；决策可追溯，问「为什么」直接给依据。',
    src: '9.1 跨会话 / 9.3 踩坑 / 9.4 决策',
  },
  {
    icon: '🔁', title: '跨 Agent 复用', big: '1 次沉淀 · 4 端共享',
    desc: 'Claude Code 记的踩坑，Codex 同 project_id 直接命中——<b>一次沉淀，多处省</b>；个人偏好按 user_id 跨 Agent/项目共享。',
    src: '19.4 project_id 共享域 / user_id 偏好',
  },
  {
    icon: '💸', title: '模型成本节省（反代理 19.8）', big: '¥0 · 省 ¥19/月',
    desc: '自动选择<b>先免费、后低价</b>：本周期跨 3 Agent 反代理 480 次（claude-free 免费 312 + gpt4o-mini 低价 168），不额外掏模型钱。低价源单价上限 <b>¥0.02/千</b>（用户设，不可超），成本封顶 ¥3/月。',
    src: '19.8 proxy_select_mode=auto · 免费优先 · proxy_price_cap 用户定',
  },
];