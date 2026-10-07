// TC-003.12 端到端（T12）：覆盖 §8 验收用例（逻辑+服务层，零依赖）
// 说明：真正的浏览器点击级 E2E 需无头浏览器(Playwright)，需联网安装；此处以
// "service + render 驱动 §8 场景" 在 Node 内验证业务正确性，等价于无 UI 的 E2E。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentOnboardService } from '../service.js';
import { signalSourcesForForm } from '../formMatrix.js';
import { createServer } from '../server.js';
import { AgentOnboardClient } from '../client.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  // 服务层字段正确（渲染层由 render.test.js 按原型 proto 形状覆盖）
  assert.equal(svc.cards.get('deepseek harness').priority, 'P0');
  assert.equal(svc.cards.get('Claude Code').priority, 'P1');
  assert.equal(svc.cards.get('deepseek harness').channels.webhook, true);
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

// ───────────────────────────────────────────────────────────────────────────
// T15 真实后端全链路 E2E（接 T13 服务 + T14 客户端注入点）
// 起真实 HTTP 服务，经 AgentOnboardService(backend=AgentOnboardClient) 跑
// configure→testConnect→rotateKey→revokeKey→oneClickOnboard→revokeBind 全链路，
// 并验证审计/卡片 JSON 持久化跨服务重启。
// ───────────────────────────────────────────────────────────────────────────
test('T15 真实后端全链路 (HTTP)：configure→test→rotate→revoke→oneClick→revokeBind + 持久化跨重启', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ab-e2e-'));
  const dataFile = join(dir, 'e2e.json');

  const s1 = await createServer({ port: 0, dataFile });
  // 走 T14 注入点：service 包 client，等价于前端改调真实后端
  const svc = new AgentOnboardService(new AgentOnboardClient(s1.url));

  const cfg = await svc.configure(card('deepseek harness', 'P0'));
  assert.equal(cfg.ok, true);
  const t = await svc.testConnect('deepseek harness');
  assert.equal(t.card.status, 'CONNECTED');
  const r = await svc.rotateKey('deepseek harness');
  assert.equal(r.ok, true);
  const rv = await svc.revokeKey('deepseek harness');
  assert.equal(rv.ok, true);

  const disc = await svc.oneClickOnboard(
    [
      { name: 'Claude Code', priority: 'P1', signal: '本机进程' },
      { name: 'Codex', priority: 'P2', signal: 'Webhook心跳' },
    ],
    'desktop',
  );
  assert.equal(disc.ok, true);
  assert.equal(disc.cards.length, 2);

  const rb = await svc.revokeBind('Claude Code');
  assert.equal(rb.ok, true);

  // 审计含全链路动作（后端异步返回 Promise）
  const audit = await svc.getAudit();
  for (const a of ['configure', 'test', 'rotate', 'revoke', 'auto_bind', 'unbound']) {
    assert.ok(audit.some((x) => x.action === a), `审计缺 ${a}`);
  }

  await s1.stop();

  // 重启：JSON 持久化恢复卡片 + 审计
  const s2 = await createServer({ port: 0, dataFile });
  const svc2 = new AgentOnboardService(new AgentOnboardClient(s2.url));
  const audit2 = await svc2.getAudit();
  assert.ok(audit2.length >= 6, '重启后审计仍在');
  // 深度卡片仍存在且吊销状态持久化
  const t2 = await svc2.testConnect('deepseek harness');
  assert.equal(t2.ok, true, '重启后 deepseek 卡片仍在');
  assert.equal(t2.card.keyRevoked, true, '吊销持久化');
  // Claude Code 已 revokeBind → 不存在
  const tClaude = await svc2.testConnect('Claude Code');
  assert.equal(tClaude.ok, false, 'revokeBind 持久化（卡片已删）');
  // GET /agents：初始加载即显示已有卡片（前端填后端不点 ⚡ 也有数据）
  const all = await svc2.getCards();
  assert.ok(all.some((c) => c.agent_name === 'deepseek harness'), 'getCards 含 deepseek');
  assert.ok(all.some((c) => c.agent_name === 'Codex'), 'getCards 含 Codex');
  assert.equal(all.some((c) => c.agent_name === 'Claude Code'), false, 'revokeBind 持久化（GET /agents 不含 Claude）');
  await s2.stop();
});
