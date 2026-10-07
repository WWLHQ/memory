// TC-003 UI 渲染（对齐原型 renderCards/renderFound/renderGains）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderCard, renderFound, renderGains } from '../render.js';

const card = {
  name: 'deepseek harness', badge: 'p0', label: 'MVP·P0', method: 'MCP + Webhook 直连（自有）',
  conn: 99.2, circuit: 'CLOSED', latency: 1.2, tenant: 'ent_001 / team_001',
  tools: { recall: { on: true, topk: 5, scene: 'task_start', mode: '' }, write: { on: true, category: 'work' }, pref: { on: true } },
  iso: { projShare: true, prefCross: true },
  chan: { webhook: true, api: true, recon: '5min' }, key: { mask: '[API_KEY:harness]', last: '32 天前', grace: 24 },
  state: 'connected',
};

test('renderCard 含原型徽标/状态点/工具-隔离-通道-操作交互点', () => {
  const html = renderCard(card);
  assert.match(html, /class="badge p0"/);
  assert.match(html, /statusdot st-connected/);
  assert.match(html, /data-tool="recall"/);
  assert.match(html, /data-tool="write"/);
  assert.match(html, /data-iso="projShare"/);
  assert.match(html, /data-chan="webhook"/);
  assert.match(html, /data-act="test"/);
  assert.match(html, /data-mask/);
  assert.match(html, /只读/); // 租户只读展示
});

test('renderCard 密钥恒脱敏不回显明文（R5）', () => {
  const html = renderCard(card);
  assert.match(html, /\[API_KEY:harness\]/);
  assert.doesNotMatch(html, /sk-/); // 绝不出现明文
});

test('renderCard 熔断 OPEN 时禁用测试按钮（R6）', () => {
  const html = renderCard({ ...card, circuit: 'OPEN', state: 'degraded' });
  assert.match(html, /data-act="test" disabled/);
});

test('renderCard 降级态加 .degraded 并显示降级告警（5.4）', () => {
  const html = renderCard({ ...card, circuit: 'OPEN', state: 'degraded' });
  assert.match(html, /class="card degraded"/);
  assert.match(html, /class="warn show"/);
});

test('renderCard 连通率<95% / 延迟>5s 告警态', () => {
  const html = renderCard({ ...card, conn: 90, latency: 6 });
  assert.match(html, /class="v warn"/);
});

test('renderCard 超 90 天未轮换显示 gold 告警', () => {
  const html = renderCard({ ...card, key: { ...card.key, last: '92 天前' } });
  assert.match(html, /class="pill gold"/);
});

test('renderCard 容忍 tools.pref 为布尔 false（Codex 原型数据，不抛错且未勾选）', () => {
  const html = renderCard({ ...card, tools: { ...card.tools, pref: false } });
  assert.match(html, /data-tool="pref"/);
  // 未勾选：pref 输入框不含 checked
  const prefInput = html.match(/<input[^>]*data-tool="pref"[^>]*>/)[0];
  assert.doesNotMatch(prefInput, /checked/);
});

test('renderFound 已绑定/未绑定两种态（含 data-unbind）', () => {
  const html = renderFound([
    { name: 'deepseek harness', badge: 'p0', label: 'MVP·P0', signal: 'MCP 注册表 + 本机进程', bound: true, ok: true },
    { name: 'Cursor', badge: 'p3', label: '扩展·P3', signal: '未发现信号', bound: false, ok: false },
  ]);
  assert.match(html, /class="found"/);
  assert.match(html, /class="found unbound"/);
  assert.match(html, /data-unbind="0"/);
  assert.match(html, /自动发现 · 已绑定 ✓/);
  assert.match(html, /未发现信号 · 需手填端点/);
});

test('renderGains 效果证据四卡', () => {
  const html = renderGains([
    { icon: '🪙', title: 'Token 节省', big: '-58%', desc: 'payload 780/1500', src: '2.4.1' },
  ]);
  assert.match(html, /class="gain"/);
  assert.match(html, /class="big">-58%/);
});
