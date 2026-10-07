// T3 验收：AgentCard 组件（对应 AC-003.1/AC-003.3/AC-003.7/AC-003.8）
// ⚠ 断言点全部对齐 design/ui/Agent接入页_原型.html 的 renderCards() 输出结构。
import type React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentCard, toolRef } from '../AgentCard.tsx';
import { SEED_AGENTS } from '../seed.ts';
import type { UiAgentCard } from '../../../types/agentOnboard.ts';

type Over = Partial<React.ComponentProps<typeof AgentCard>>;

function setup(over: Partial<UiAgentCard> = {}, props: Over = {}) {
  const agent = { ...SEED_AGENTS[0], ...over };
  const onToolChange = props.onToolChange ?? (() => {});
  const utils = render(
    <AgentCard
      agent={agent}
      error=""
      testDisabled={agent.circuit === 'OPEN'}
      saveDisabled={false}
      injectVisible={false}
      onToolChange={onToolChange}
      onIsoChange={() => {}}
      onChanChange={() => {}}
      onAct={() => {}}
      onRidClick={() => {}}
      {...props}
    />,
  );
  return { agent, onToolChange, ...utils };
}

test('渲染徽标/状态点/四项指标（AC-003.1/AC-003.3）', () => {
  setup();
  expect(screen.getByText('MVP·P0')).toBeInTheDocument();
  expect(screen.getByText('deepseek harness')).toBeInTheDocument();
  expect(document.querySelector('.statusdot.st-connected')).toBeTruthy();
  expect(screen.getByText('已连通')).toBeInTheDocument();
  expect(screen.getByText('99.2%')).toBeInTheDocument();
  expect(screen.getByText('CLOSED')).toBeInTheDocument();
  expect(screen.getByText('ent_001 / team_001')).toBeInTheDocument();
});

test('密钥恒脱敏不回显明文（R5）', () => {
  setup();
  expect(screen.getByText('[API_KEY:harness]')).toBeInTheDocument();
  expect(document.body.textContent).not.toContain('sk-');
});

test('熔断 OPEN：卡片加 degraded + 显示降级告警 + 禁测试（R6/5.4）', () => {
  setup({ circuit: 'OPEN', state: 'degraded' });
  expect(document.querySelector('.card.degraded')).toBeTruthy();
  expect(document.querySelector('.warn.show')).toBeTruthy();
  expect(screen.getByRole('button', { name: /测试接入/ })).toBeDisabled();
});

test('连通率<95% / 延迟>5s 告警态', () => {
  setup({ conn: 90, latency: 6 });
  expect(document.querySelectorAll('.metric .v.warn').length).toBeGreaterThanOrEqual(1);
});

test('超 90 天未轮换显示 gold 告警', () => {
  setup({ key: { mask: '[API_KEY:codex]', last: '92 天前', grace: 24 } });
  expect(document.querySelector('.pill.gold')).toBeTruthy();
});

test('工具/隔离/通道开关均带原型 data-* 属性', () => {
  setup();
  expect(document.querySelector('input[data-tool="recall"]')).toBeTruthy();
  expect(document.querySelector('input[data-iso="projShare"]')).toBeTruthy();
  expect(document.querySelector('input[data-chan="webhook"]')).toBeTruthy();
  expect(document.querySelector('[data-act="test"]')).toBeTruthy();
  expect(document.querySelector('[data-mask]')).toBeTruthy();
  expect(document.querySelector('[data-rid]')).toBeTruthy();
});

test('R4 违规：显示 errbox 且禁保存', () => {
  setup({}, { error: 'R4：双通道（Webhook + API 拉取）至少开一，记忆库需可采集（5.1）', saveDisabled: true });
  expect(screen.getByText(/R4：双通道/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '保存配置' })).toBeDisabled();
});

test('点击开关回调正确工具名（R3 入口）', async () => {
  const calls: string[] = [];
  const { onToolChange } = setup({}, { onToolChange: (t: string) => calls.push(t) });
  await userEvent.click(document.querySelector('input[data-tool="pref"]') as HTMLInputElement);
  expect(onToolChange).toBeDefined();
  expect(calls).toContain('pref');
});

test('toolRef 归一化：布尔 false 提升为对象（真实 BUG 回归）', () => {
  // 原型 Codex 的 tools.pref 就是false；曾因false.on = x 抛
  // "Cannot create property 'on' on boolean 'false'"
  expect(() => { toolRef(false).on = true; }).not.toThrow();
  expect(toolRef(false).on).toBe(false);
  expect(toolRef({ on: true }).on).toBe(true);
});

test('Codex 原样渲染：pref=false 未勾选且不抛错', () => {
  const codex = SEED_AGENTS[2];
  render(
    <AgentCard
      agent={codex}
      error=""
      testDisabled
      saveDisabled={false}
      injectVisible={false}
      onToolChange={() => {}}
      onIsoChange={() => {}}
      onChanChange={() => {}}
      onAct={() => {}}
      onRidClick={() => {}}
    />,
  );
  const pref = document.querySelector('input[data-tool="pref"]') as HTMLInputElement;
  expect(pref.checked).toBe(false);
  expect(screen.getByText('降级（仅补偿）')).toBeInTheDocument();
});