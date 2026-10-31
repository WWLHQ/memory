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
import { SEED_AGENTS, SEED_DISCOVERED } from './fixtures.ts';
import { emptyOnboardGains } from '../coreOnboard.ts';

/* ---------- T4 OneClickOnboard（AC-003.4） ---------- */
test('一键接入：四段进度 + 3 发现项（Cursor 演示行已移除）+ 已绑定/未发现两种态', () => {
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
  expect(document.querySelectorAll('#found .found')).toHaveLength(3);
  expect(document.querySelectorAll('#found .found.unbound')).toHaveLength(0); // 无 Cursor 演示行
  expect(screen.getAllByText('自动发现 · 已绑定 ✓').length).toBe(2);
  expect(screen.getAllByText('自动发现 · 已绑定 ⚠ 待手动补').length).toBe(1); // Codex 未通
  expect(document.querySelectorAll('[data-unbind]')).toHaveLength(3); // 仅已绑定项可撤销
  // 批次19 统一格式：状态 pill 与撤销按钮在首行（与 badge/名称平齐），信号在次行
  const heads = document.querySelectorAll('#found .found-card .found-head');
  expect(heads).toHaveLength(3);
  heads.forEach((h) => {
    expect(h.querySelector('.badge')).not.toBeNull();
    expect(h.querySelector('.agent-name')).not.toBeNull();
    expect(h.querySelector('.found-actions .pill')).not.toBeNull();
  });
  expect(document.querySelectorAll('#found .found-head [data-unbind]')).toHaveLength(3);
  expect(document.querySelectorAll('#found .found-card .found-meta .method')).toHaveLength(3);
});

test('已安装 Agent 卡片：与发现卡片同构（首行 badge/名称/右侧操作 + 次行元信息）', () => {
  render(
    <OneClickOnboard
      form="desktop"
      discovered={[]}
      installedAgents={[
        { agent: 'Cursor', via: 'app', source: 'C:\\Users\\me\\AppData\\Local\\Programs\\Cursor\\Cursor.exe', version: '0.42.0', badge: 'p3', label: '扩展·P3' },
      ]}
      running={false}
      stageIndex={-1}
      scanState="待扫描"
      onDiscover={() => {}}
      onUnbind={() => {}}
      onSignalChange={() => {}}
      onAddCardForInstalled={() => {}}
    />,
  );
  const card = document.querySelector('#installedAgents .found-card') as HTMLElement;
  expect(card).not.toBeNull();
  expect(card.querySelector('.found-head .badge')?.textContent).toBe('扩展·P3');
  expect(card.querySelector('.found-head .agent-name')?.textContent).toBe('Cursor');
  expect(card.querySelector('.found-head .found-actions button')?.textContent).toContain('新增接入卡片');
  expect(card.querySelector('.found-meta')?.textContent).toContain('桌面端已装');
  expect(card.querySelector('.found-meta')?.textContent).toContain('v0.42.0');
});

test('一键接入：内核模拟标注「内核模拟」，真实扫描标注「宿主真扫」', () => {
  const { rerender } = render(
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
  // 内核降级数据（source='kernel'）→ 信号后标注「内核模拟」
  expect(screen.getAllByText(/内核模拟/).length).toBeGreaterThan(0);
  // 真实扫描数据（source='host'）→ 信号后标注「宿主真扫」
  rerender(
    <OneClickOnboard
      form="desktop"
      discovered={[
        { name: 'Claude Code', badge: 'p1', label: 'MVP·P1', signal: 'proc · claude.exe', bound: true, ok: true, source: 'host' },
        { name: 'Cursor', badge: 'p3', label: '扩展·P3', signal: '未发现信号', bound: false, ok: false, source: 'host' },
      ]}
      running={false}
      stageIndex={-1}
      scanState="完成 · 真实发现 1 个"
      onDiscover={() => {}}
      onUnbind={() => {}}
      onSignalChange={() => {}}
    />,
  );
  expect(screen.getAllByText(/宿主真扫/).length).toBeGreaterThan(0);
  expect(screen.getByText(/proc · claude.exe/, { exact: false })).toBeInTheDocument();
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

test('FormBadge：真实运行时标识（浏览器 vs 桌面壳）+ 文案随端变化', () => {
  // jsdom = 纯浏览器 → 如实标注「宿主真扫不可用」（不再 UA 粗判谎称可用）
  const { rerender, unmount } = render(<FormBadge form="desktop" />);
  expect(screen.getByText((_, el) => el?.id === 'formBadge' && el.textContent === '当前端：桌面（浏览器 · 宿主真扫不可用）')).toBeInTheDocument();
  rerender(<FormBadge form="web" />);
  expect(screen.getByText('当前端：Web（仅注册表+心跳）')).toBeInTheDocument();
  unmount();
  // Electron 桌面壳（有 preload 能力）→ 「宿主真扫可用」
  (window as unknown as { __ELECTRON__?: boolean }).__ELECTRON__ = true;
  (window as unknown as { api: unknown }).api = { hostScan: { run: async () => ({}) }, storage: {} };
  try {
    render(<FormBadge form="desktop" />);
    expect(screen.getByText((_, el) => el?.id === 'formBadge' && el.textContent === '当前端：桌面（桌面壳 · 宿主真扫可用）')).toBeInTheDocument();
  } finally {
    delete (window as unknown as { __ELECTRON__?: boolean }).__ELECTRON__;
    delete (window as unknown as { api?: unknown }).api;
  }
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
  // seed 轮换时间已真实化为「未记录」（真实值由容器层从后端审计回填）
  const { rerender } = render(<KeyMgmt apiKey={SEED_AGENTS[0].key} />);
  expect(screen.getByText('[API_KEY:harness]')).toBeInTheDocument();
  expect(screen.getByText('轮换宽限 24h · 上次 未记录')).toBeInTheDocument();
  expect(document.querySelector('.pill.gold')).toBeNull();
  // 真实 staleDays > 90 → gold 告警（由容器层从最近 rotate ts 计算）
  rerender(<KeyMgmt apiKey={SEED_AGENTS[2].key} staleDays={92} />);
  expect(screen.getByText('⚠ 超 90 天未轮换')).toBeInTheDocument();
  // 轮换后：脱敏值加「（新）」（对齐原型 act('rotate')）
  rerender(<KeyMgmt apiKey={{ ...SEED_AGENTS[0].key, last: '刚轮换', rotated: true }} />);
  expect(screen.getByText('[API_KEY:harness]（新）')).toBeInTheDocument();
});

/* ---------- T8 TestPanel ---------- */
test('TestPanel：未测试/未验证不伪造 request_id，真实回执才可点（R7）', async () => {
  let clicked = '';
  const { rerender } = render(
    <TestPanel agent={SEED_AGENTS[0]} injectVisible={false} onRidClick={(n) => { clicked = n; }} />,
  );
  expect(screen.getByText('尚未测试 · 点「▶ 测试接入」')).toBeInTheDocument();
  const inject = document.querySelector('[data-inject]') as HTMLElement;
  expect(inject.style.display).toBe('none');
  // 未测试 → 点击不得跳转（没有可定位的回执）
  await userEvent.click(document.querySelector('[data-rid]') as HTMLElement);
  expect(clicked).toBe('');

  // 后端不可达 → 如实标「未验证」并展示原因，仍不可点
  rerender(
    <TestPanel
      agent={SEED_AGENTS[0]}
      injectVisible={false}
      evidence={{ rid: null, local: true, ok: false, reason: '接入后端不可达，本地未验证' }}
      onRidClick={(n) => { clicked = n; }}
    />,
  );
  expect(screen.getByText('后端不可达 · 本次未验证')).toBeInTheDocument();
  expect(screen.getByText(/原因：接入后端不可达/)).toBeInTheDocument();
  await userEvent.click(document.querySelector('[data-rid]') as HTMLElement);
  expect(clicked).toBe('');

  // 真实回执 → 显示 request_id，可点
  rerender(
    <TestPanel
      agent={SEED_AGENTS[0]}
      injectVisible
      evidence={{ rid: 'req_real_1', ok: true }}
      onRidClick={(n) => { clicked = n; }}
    />,
  );
  expect(screen.getByText('req_real_1')).toBeInTheDocument();
  expect((document.querySelector('[data-inject]') as HTMLElement).style.display).not.toBe('none');
  await userEvent.click(document.querySelector('[data-rid]') as HTMLElement);
  expect(clicked).toBe('deepseek harness');
});

/* ---------- 效果证据 ---------- */
test('Gains：四张证据卡 + 大字指标（真实聚合口径）', () => {
  // 真实化后页面用 getOnboardGains/emptyOnboardGains；此处验证 Gains 组件渲染契约
  render(<Gains gains={emptyOnboardGains()} />);
  expect(document.querySelectorAll('.gain')).toHaveLength(4);
  expect(screen.getAllByText('—').length).toBe(4);
  // 标题含 emoji，文本被拆分 -> 用 matcher
  expect(screen.getByText(/Token 节省/)).toBeInTheDocument();
});
test('Gains：desc 富文本强调保留（真实聚合结果含 <b>）', () => {
  render(<Gains gains={[{ icon: '🪙', title: 'Token 节省', big: '-50%', desc: '本周期 <b>2 次召回</b> · 平均 payload <b>750/1500</b>', src: '内核账本·实时' }]} />);
  expect(document.querySelectorAll('.gain .desc b').length).toBe(2);
});