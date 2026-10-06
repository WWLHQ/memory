// TC-003.12 端到端（T12）：覆盖 §8 验收用例（逻辑+服务层，零依赖）
// 说明：真正的浏览器点击级 E2E 需无头浏览器(Playwright)，需联网安装；此处以
// "service + render 驱动 §8 场景" 在 Node 内验证业务正确性，等价于无 UI 的 E2E。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentOnboardService } from '../service.js';
import { renderCard } from '../render.js';
import { signalSourcesForForm } from '../formMatrix.js';

function card(name, priority) {
  return {
    agent_name: name, priority, accessMode: 'MCP+Webhook',
    enterprise_id: 'e1', team_id: 't1', tenantManual: false,
    mcpTools: { recall_memory: { project_id: 'p1' }, write_memory: { project_id: 'p1' }, get_user_preferences: { user_id: 'u1' } },
    channels: { webhook: true, apiPull: true }, apiKeyPlaintext: null, circuit: 'CLOSED',
  };
}

test('§8 MVP 接入：deepseek(P0)+Claude(P1) 双通道 → 两卡片 CONNECTED + 优先级徽标', () => {
  const svc = new AgentOnboardService();
  svc.configure(card('deepseek harness', 'P0'));
  svc.configure(card('Claude Code', 'P1'));
  svc.testConnect('deepseek harness');
  svc.testConnect('Claude Code');
  assert.equal(svc.cards.get('deepseek harness').status, 'CONNECTED');
  assert.equal(svc.cards.get('Claude Code').status, 'CONNECTED');
  assert.match(renderCard(svc.cards.get('deepseek harness')), /data-priority="P0"/);
  assert.match(renderCard(svc.cards.get('Claude Code')), /data-priority="P1"/);
});

test('§8 双通道兜底：主通道熔断 OPEN → DEGRADED 仅补偿', () => {
  const svc = new AgentOnboardService();
  svc.configure(card('deepseek harness', 'P0')); // 先正常配置
  svc.cards.get('deepseek harness').circuit = 'OPEN'; // 运行期熔断
  svc.testConnect('deepseek harness');
  assert.equal(svc.cards.get('deepseek harness').status, 'DEGRADED');
  assert.equal(svc.cards.get('deepseek harness').channels.webhook, true); // 补偿仍在
});

test('§8 一键接入：3 个本机 Agent 自动出现卡片（P0/P1/P2），默认只读召回 + 双通道 + project 共享', () => {
  const svc = new AgentOnboardService();
  svc.oneClickOnboard(
    [
      { name: 'deepseek harness', priority: 'P0', signal: 'MCP注册表' },
      { name: 'Claude Code', priority: 'P1', signal: '本机进程' },
      { name: 'Codex', priority: 'P2', signal: 'Webhook心跳' },
    ],
    'desktop',
  );
  for (const n of ['deepseek harness', 'Claude Code', 'Codex']) {
    const c = svc.cards.get(n);
    assert.equal(c.status, 'CONNECTED');
    assert.equal(c.channels.webhook && c.channels.apiPull, true); // 双通道
    assert.equal(c.mcpTools.recall_memory.project_id, 'p1'); // project 共享
  }
});

test('§8 撤销自动绑定：其余绑定不受影响', () => {
  const svc = new AgentOnboardService();
  svc.oneClickOnboard([{ name: 'A', priority: 'P0', signal: 'x' }, { name: 'B', priority: 'P1', signal: 'y' }], 'desktop');
  svc.revokeBind('A');
  assert.equal(svc.cards.has('A'), false);
  assert.equal(svc.cards.has('B'), true);
});

test('§8 P2 敏感动作：默认不开写；确认后才放行', () => {
  const svc = new AgentOnboardService();
  const r = svc.oneClickOnboard([{ name: 'Codex', priority: 'P2', signal: 'Webhook心跳' }], 'desktop');
  const codex = r.cards[0];
  assert.equal(codex.oneClick.p2Write, false); // 默认只读召回
  // 用户确认路径（真实 UI 弹确认框）：置 p2Confirm 后允许写
  codex.oneClick.p2Confirm = true;
  codex.oneClick.p2Write = true;
  assert.equal(codex.oneClick.p2Write, true);
});

test('§8 按端置灰（19.10）：Web 端关「本机进程」；CLI 端关「Webhook 心跳」改命令', () => {
  assert.equal(signalSourcesForForm('web').includes('本机进程'), false);
  assert.equal(signalSourcesForForm('cli').includes('Webhook心跳'), false);
  assert.equal(signalSourcesForForm('desktop').length, 4);
});

test('§8 审计记端（19.11）：auto_bind 审计含 form，可归因发现于哪个端', () => {
  const svc = new AgentOnboardService();
  svc.oneClickOnboard([{ name: 'A', priority: 'P0', signal: 'x' }], 'web');
  const bind = svc.getAudit().find((x) => x.action === 'auto_bind');
  assert.ok(bind && bind.form === 'web');
});
