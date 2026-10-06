// Agent 接入页 UI 渲染（REQ-003 T3~T8 / T10 / 接原型 HTML）
// 纯函数：state -> HTML 字符串，便于单测（无需浏览器/jsdom）。
// 浏览器入口 src/agentOnboard/browser.js 直接调用本模块把字符串塞进 DOM，即"接原型"。
//
// 原型参考：design/ui/Agent接入页_原型.html（AGENTS/DISCOVERED 数组 + renderCards/bindCard/act）

import { AgentStatus } from './stateMachine.js';
import { signalSourcesForForm, isSourceGrayed } from './formMatrix.js';

const STATUS_TEXT = {
  ONBOARD: '未配置',
  CONFIGURED: '已配置',
  CONNECTED: '连通',
  DEGRADED: '降级',
};
const CIRCUIT_TEXT = { CLOSED: '正常', OPEN: '熔断OPEN', HALF_OPEN: '半开' };

/** 状态徽标 */
export function renderStatusBadge(status) {
  return `<span class="badge status-${status}" data-status="${status}">${STATUS_TEXT[status] || status}</span>`;
}

/** 优先级徽标：MVP·P0 / MVP·P1 / 兜底·P2 / 扩展·P3 */
export function renderPriorityBadge(priority) {
  const label = { P0: 'MVP·P0', P1: 'MVP·P1', P2: '兜底·P2', P3: '扩展·P3' }[priority] || priority;
  return `<span class="badge priority-${priority}" data-priority="${priority}">${label}</span>`;
}

/** 熔断状态点 */
export function renderCircuitDot(circuit) {
  return `<span class="dot circuit-${circuit}" title="${CIRCUIT_TEXT[circuit] || circuit}" data-circuit="${circuit}"></span>`;
}

/**
 * 单家 Agent 接入卡片（AC-003.1~AC-003.3 / AC-003.7 / AC-003.8）
 * 字段级：agent_name 枚举、接入方式、连通成功率(<95% 告警)、平均延迟(>5s 告警)、
 *  enterprise_id/team_id 只读、熔断状态点、单 Agent 操作(测试/轮换/吊销)。
 */
export function renderCard(card) {
  const rateWarn = card.connectRate != null && card.connectRate < 95 ? ' warn' : '';
  const rateText = card.connectRate != null ? `连通成功率 ${card.connectRate}%` : '连通成功率 —';
  const latencyWarn = card.avgLatency != null && card.avgLatency > 5 ? ' warn' : '';
  const latencyText = card.avgLatency != null ? `平均延迟 ${card.avgLatency}s` : '平均延迟 —';
  const tenant = card.enterprise_id ? `企业 ${card.enterprise_id} / 团队 ${card.team_id}` : '全局租户上下文';
  // R5/R6 密钥恒脱敏
  const keyText = card.apiKeyPlaintext ? '[API_KEY:service]' : (card.keySet ? '[API_KEY:service]' : '未配置');
  const testDisabled = card.circuit === 'OPEN' ? ' disabled' : '';
  return `
<div class="agent-card" data-agent="${card.agent_name}">
  <div class="card-head">
    <strong>${card.agent_name}</strong>
    ${renderPriorityBadge(card.priority)}
    ${renderStatusBadge(card.status)}
    ${renderCircuitDot(card.circuit || 'CLOSED')}
  </div>
  <div class="card-body">
    <div>接入方式：${card.accessMode || 'MCP+Webhook'}</div>
    <div class="rate${rateWarn}">${rateText}</div>
    <div class="latency${latencyWarn}">${latencyText}</div>
    <div class="tenant readonly">${tenant}（只读）</div>
    <div class="key desensitize">API Key：${keyText}</div>
  </div>
  <div class="card-ops">
    <button data-act="test"${testDisabled}>测试</button>
    <button data-act="rotate">轮换</button>
    <button data-act="revoke">吊销</button>
  </div>
</div>`;
}

/**
 * 一键全量接入四段进度条（AC-003.4 / T4）
 * segments: [{key:'扫'|'分'|'绑'|'验', done:boolean, fail?:boolean}]
 */
export function renderOneClickProgress(segments) {
  const segs = segments
    .map((s) => `<span class="seg ${s.done ? 'done' : ''} ${s.fail ? 'fail' : ''}" data-seg="${s.key}">${s.key}</span>`)
    .join('');
  return `<div class="oneclick-progress">${segs}</div>`;
}

/**
 * 自动绑定结果卡（AC-003.4 / R8 只读召回 / R9 可撤销）
 */
export function renderAutoBindCard(card) {
  const readonly = card.oneClick?.defaultReadOnly ? '只读召回' : '可读写';
  const revocable = card.oneClick?.bindRevocable ? '可撤销' : '不可撤销';
  return `
<div class="autobind-card" data-agent="${card.agent_name}">
  ${renderPriorityBadge(card.priority)} ${renderStatusBadge(card.status)}
  <span class="mode">${readonly}</span>
  <span class="revoke">${revocable}</span>
  <button data-act="revoke-bind">撤销</button>
</div>`;
}

/**
 * 测试面板（AC-003.8 / R7 request_id 审计）
 */
export function renderTestPanel(card) {
  const reqId = card.requestId ? `<code data-request-id>${card.requestId}</code>` : '未生成';
  const preview = card.tested ? `将注入 N 条，payload ≈ ${card.previewTokens || 'X'} tokens` : '未测试';
  return `
<div class="test-panel" data-agent="${card.agent_name}">
  <div>注入预览：${preview}</div>
  <div>request_id：${reqId}</div>
  <div>连通结果：${STATUS_TEXT[card.status] || card.status}</div>
</div>`;
}

/**
 * 当前端徽标 + 信号源勾选区（AC-003.10 / 19.10 / T10）
 */
export function renderFormBadge(form) {
  const sources = signalSourcesForForm(form)
    .map((s) => `<label><input type="checkbox" data-signal="${s}" checked> ${s}</label>`)
    .join('');
  const grayed = SIGNAL_SOURCES_EXTRA(form);
  return `
<div class="form-badge" data-form="${form}">当前端：${form}${grayed}</div>
<div class="signal-sources">${sources}</div>`;
}
function SIGNAL_SOURCES_EXTRA(form) {
  // 列出被置灰项（仅展示提示）
  const all = ['MCP注册表', '本机进程', 'Webhook心跳', '手动兜底'];
  const gray = all.filter((s) => isSourceGrayed(form, s));
  return gray.length ? `（置灰：${gray.join('、')}）` : '';
}

/**
 * 整页组合（接原型 HTML 的布局）
 */
export function renderOnboardPage({ cards = [], form = 'desktop', segments, autoBinds = [] }) {
  const header = `<header><h1>Agent 接入配置页</h1>${renderFormBadge(form)}</header>`;
  const oneClick = renderOneClickProgress(segments || [
    { key: '扫', done: false }, { key: '分', done: false }, { key: '绑', done: false }, { key: '验', done: false },
  ]);
  const cardList = cards.map(renderCard).join('\n');
  const binds = autoBinds.map(renderAutoBindCard).join('\n');
  return `<section class="onboard-page">${header}${oneClick}<div class="cards">${cardList}</div><div class="autobinds">${binds}</div></section>`;
}
