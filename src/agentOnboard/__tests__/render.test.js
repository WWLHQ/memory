// TC-003 UI 渲染（对应 AC-003.1/AC-003.3/AC-003.4/AC-003.7/AC-003.8/AC-003.10）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderCard,
  renderStatusBadge,
  renderPriorityBadge,
  renderOneClickProgress,
  renderTestPanel,
  renderFormBadge,
  renderOnboardPage,
} from '../render.js';
import { signalSourcesForForm } from '../formMatrix.js';

const card = {
  agent_name: 'deepseek harness',
  priority: 'P0',
  status: 'CONNECTED',
  circuit: 'CLOSED',
  connectRate: 98,
  avgLatency: 2,
  enterprise_id: 'e1',
  team_id: 't1',
  accessMode: 'MCP+Webhook',
  apiKeyPlaintext: null,
  keySet: true,
  requestId: 'req_abc',
  tested: true,
  previewTokens: 12,
};

test('renderCard 含状态/优先级徽标与只读租户（AC-003.1/AC-003.3）', () => {
  const html = renderCard(card);
  assert.match(html, /data-status="CONNECTED"/);
  assert.match(html, /data-priority="P0"/);
  assert.match(html, /只读/); // enterprise/team 只读
});

test('renderCard 密钥恒脱敏不回显明文（AC-003.7 / R5）', () => {
  const html = renderCard(card);
  assert.match(html, /\[API_KEY:service\]/);
  assert.doesNotMatch(html, /sk-/); // 绝不出现明文
});

test('renderCard 熔断 OPEN 时禁用测试按钮（AC-003.3 / R6）', () => {
  const html = renderCard({ ...card, circuit: 'OPEN' });
  assert.match(html, /data-act="test" disabled/);
});

test('renderCard 连通率<95% / 延迟>5s 告警态（AC-003.1）', () => {
  const html = renderCard({ ...card, connectRate: 90, avgLatency: 6 });
  assert.match(html, /class="rate warn"/);
  assert.match(html, /class="latency warn"/);
});

test('renderOneClickProgress 四段（AC-003.4 / T4）', () => {
  const html = renderOneClickProgress([{ key: '扫', done: true }, { key: '分', done: true }, { key: '绑', done: false }, { key: '验', done: false }]);
  assert.match(html, /data-seg="扫"/);
  assert.match(html, /data-seg="验"/);
  assert.match(html, /seg done/);
});

test('renderTestPanel 含 request_id（AC-003.8 / R7）', () => {
  const html = renderTestPanel(card);
  assert.match(html, /data-request-id/);
  assert.match(html, /req_abc/);
});

test('renderFormBadge 按端置灰（AC-003.10 / 19.10）', () => {
  const web = renderFormBadge('web');
  assert.match(web, /当前端：web/);
  assert.match(web, /置灰：本机进程/); // Web 端关本机进程
  assert.deepEqual(signalSourcesForForm('web').includes('本机进程'), false);
  assert.deepEqual(signalSourcesForForm('desktop').length, 4); // 桌面全开
});

test('renderOnboardPage 组合整页', () => {
  const html = renderOnboardPage({ cards: [card], form: 'desktop' });
  assert.match(html, /Agent 接入配置页/);
  assert.match(html, /data-agent="deepseek harness"/);
});
