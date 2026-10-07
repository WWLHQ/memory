// T4/T5/T6/T7/T8/T10 验收：一键接入、工具/通道/密钥/测试面板、按端置灰（AC-003.4/AC-003.10）
// ⚠ 断言点严格对齐 design/ui/Agent接入页_原型.html。
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OneClickOnboard } from '../OneClickOnboard.tsx';
import { McpToolConfig } from '../McpToolConfig.tsx';
import { ChannelConfig } from '../ChannelConfig.tsx';
import { KeyMgmt } from '../KeyMgmt.tsx';
import { TestPanel } from '../TestPanel.tsx';
import { FormBadge, GRAYED_BY_FORM } from '../FormBadge.tsx';
import { Gains } from '../Gains.tsx';
import { SEED_AGENTS, SEED_DISCOVERED, SEED_GAINS } from '../seed.ts';

/* ---------- T4 OneClickOnboard（AC-003.4） ---------- */
test('一键接入：四段进度 + 4 发现项 + 已绑定/未发现两种态', () => {
  render(
    <OneClickOnboard
      form="desktop"
      discovered={SEED_DISCOVERED}
      running={false}
      stageIndex={-1}
      scanState="待扫描"
      onDiscover={() => {}}
      onUnbind={() => {}}
      onSignalChange={() => {}}
    />,
  );
  expect(document.querySelectorAll('.stage')).toHaveLength(4);
  expect(document.querySelector('#btnDiscover')).toBeTruthy();
  expect(document.querySelectorAll('#found .found')).toHaveLength(4);
  expect(document.querySelectorAll('#found .found.unbound')).toHaveLength(1); // Cursor
  expect(screen.getAllByText('自动发现 · 已绑定 ✓').length).toBe(2);
  expect(screen.getByText('未发现信号 · 需手填端点')).toBeInTheDocument();
  expect(document.querySelectorAll('[data-unbind]')).toHaveLength(3); // 仅已绑定项可撤销
});

test('一键接入：点按钮触发 onDiscover，running 时禁用', async () => {
  let hit = 0;
  const { rerender } = render(
    <OneClickOnboard form="desktop" discovered={SEED_DISCOVERED} running={false} stageIndex={-1} scanState="待扫描"
      onDiscover={() => { hit += 1; }} onUnbind={() => {}} onSignalChange={() => {}} />,
  );
  await userEvent.click(screen.getByRole('button', { name: /自动发现并接入本机 Agent/ }));
  expect(hit).toBe(1);
  rerender(
    <OneClickOnboard form="desktop" discovered={SEED_DISCOVERED} running stageIndex={2} scanState="按默认值绑定中…"
      onDiscover={() => { hit += 1; }} onUnbind={() => {}} onSignalChange={() => {}} />,
  );
  expect(screen.getByRole('button', { name: /自动发现并接入本机 Agent/ })).toBeDisabled();
  expect(document.querySelectorAll('.stage.done')).toHaveLength(3); // 0,1,2 已完成
  expect(screen.getAllByText('按默认值绑定中…').length).toBeGreaterThan(0);
});

test('一键接入：撤销按钮回调正确下标（R9）', async () => {
  const got: number[] = [];
  render(
    <OneClickOnboard form="desktop" discovered={SEED_DISCOVERED} running={false} stageIndex={-1} scanState="待扫描"
      onDiscover={() => {}} onUnbind={(i) => got.push(i)} onSignalChange={() => {}} />,
  );
  await userEvent.click(document.querySelector('[data-unbind="1"]') as HTMLButtonElement);
  expect(got).toEqual([1]);
});

/* ---------- T10 FormBadge（AC-003.10 / 19.10） ---------- */
test('按端置灰：web 关本机进程 / linux 关心跳 / desktop 全开', () => {
  expect(GRAYED_BY_FORM.web).toContain('proc');
  expect(GRAYED_BY_FORM.mobile).toEqual(['proc', 'mcp']);
  expect(GRAYED_BY_FORM.linux).toContain('hb');
  expect(GRAYED_BY_FORM.desktop).toHaveLength(0);
});

test('FormBadge 文案随端变化（对齐原型 applyForm）', () => {
  const { rerender } = render(<FormBadge form="desktop" />);
  expect(screen.getByText('当前端：桌面（全量发现可用）')).toBeInTheDocument();
  rerender(<FormBadge form="web" />);
  expect(screen.getByText('当前端：Web（仅注册表+心跳）')).toBeInTheDocument();
});

test('非桌面端：被置灰的信号源 checkbox 禁用（19.10）', () => {
  render(
    <OneClickOnboard form="web" discovered={SEED_DISCOVERED} running={false} stageIndex={-1} scanState="待扫描"
      onDiscover={() => {}} onUnbind={() => {}} onSignalChange={() => {}} />,
  );
  const proc = document.querySelector('.sig[value="proc"]') as HTMLInputElement;
  expect(proc.disabled).toBe(true);
  expect(proc.checked).toBe(false);
});

/* ---------- T5 McpToolConfig ---------- */
test('McpToolConfig：三个工具 + 原型文案', async () => {
  const got: string[] = [];
  render(<McpToolConfig tools={SEED_AGENTS[0].tools} onChange={(t) => got.push(t)} />);
  expect(screen.getByText(/recall_memory top_k=5 scene=task_start/)).toBeInTheDocument();
  expect(screen.getByText('write_memory')).toBeInTheDocument();
  expect(screen.getByText('get_user_preferences')).toBeInTheDocument();
  await userEvent.click(document.querySelector('input[data-tool="write"]') as HTMLInputElement);
  expect(got).toEqual(['write']);
});

/* ---------- T6 ChannelConfig ---------- */
test('ChannelConfig：双通道 + 对账 + SHA-256 幂等（不可关）', async () => {
  const got: string[] = [];
  render(<ChannelConfig chan={SEED_AGENTS[0].chan} onChange={(c) => got.push(c)} />);
  expect(screen.getByText('主 Webhook')).toBeInTheDocument();
  expect(screen.getByText('补偿 API 拉取')).toBeInTheDocument();
  expect(screen.getByText('对账 5min')).toBeInTheDocument();
  expect(screen.getByText('SHA-256 幂等（不可关）')).toBeInTheDocument();
  await userEvent.click(document.querySelector('input[data-chan="api"]') as HTMLInputElement);
  expect(got).toEqual(['api']);
});

/* ---------- T7 KeyMgmt ---------- */
test('KeyMgmt：脱敏 + 宽限 + 超 90 天告警 + 轮换后缀（新）', () => {
  const { rerender } = render(<KeyMgmt apiKey={SEED_AGENTS[0].key} />);
  expect(screen.getByText('[API_KEY:harness]')).toBeInTheDocument();
  expect(screen.getByText('轮换宽限 24h · 上次 32 天前')).toBeInTheDocument();
  expect(document.querySelector('.pill.gold')).toBeNull();
  rerender(<KeyMgmt apiKey={SEED_AGENTS[2].key} />);
  expect(screen.getByText('⚠ 超 90 天未轮换')).toBeInTheDocument();
  // 轮换后：脱敏值加「（新）」（对齐原型 act('rotate')）
  rerender(<KeyMgmt apiKey={{ ...SEED_AGENTS[0].key, last: '刚轮换', rotated: true }} />);
  expect(screen.getByText('[API_KEY:harness]（新）')).toBeInTheDocument();
});

/* ---------- T8 TestPanel ---------- */
test('TestPanel：request_id 可点 + 注入预览按可见性切换（R7）', async () => {
  let clicked = '';
  const { rerender } = render(
    <TestPanel agent={SEED_AGENTS[0]} injectVisible={false} onRidClick={(n) => { clicked = n; }} />,
  );
  expect(screen.getByText('req_test_deepseek harness')).toBeInTheDocument();
  const inject = document.querySelector('[data-inject]') as HTMLElement;
  expect(inject.style.display).toBe('none');
  await userEvent.click(document.querySelector('[data-rid]') as HTMLElement);
  expect(clicked).toBe('deepseek harness');
  rerender(<TestPanel agent={SEED_AGENTS[0]} injectVisible onRidClick={() => {}} />);
  expect((document.querySelector('[data-inject]') as HTMLElement).style.display).not.toBe('none');
});

/* ---------- 效果证据 ---------- */
test('Gains：四张证据卡 + 大字指标', () => {
  render(<Gains gains={SEED_GAINS} />);
  expect(document.querySelectorAll('.gain')).toHaveLength(4);
  expect(screen.getByText('-58%')).toBeInTheDocument();
  // 标题含 emoji，文本被拆分 -> 用 matcher
  expect(screen.getByText(/Token 节省/)).toBeInTheDocument();
  // desc 富文本强调保留
  expect(document.querySelectorAll('.gain .desc b').length).toBeGreaterThan(0);
});