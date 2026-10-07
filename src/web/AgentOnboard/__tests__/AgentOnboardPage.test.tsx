// 页面级集成测试（对应旧 browser.test.js 的护栏作用 + §8 场景点击级验证）
// 覆盖：首屏结构、R3 回落、R4 禁用保存、R2 提示、一键接入四段动画、撤销绑定。
// ⚠ 选择器与文案严格对齐 design/ui/Agent接入页_原型.html。
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentOnboardPage } from '../AgentOnboardPage.tsx';

test('首屏：3 宿主卡片 + 4 效果证据 + 4 发现项 + 端徽标', () => {
  render(<AgentOnboardPage />);
  expect(document.querySelectorAll('#cards > .card')).toHaveLength(3);
  expect(document.querySelectorAll('#gains > .gain')).toHaveLength(4);
  expect(document.querySelectorAll('#found > .found')).toHaveLength(4);
  expect(document.querySelectorAll('#stages .stage')).toHaveLength(4);
  expect(document.querySelector('#formBadge')?.textContent).toContain('当前端');
  expect(screen.getAllByText('deepseek harness').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Codex').length).toBeGreaterThan(0);
});

test('R4：双通道全关 → 报错并禁保存；恢复一路即解除', async () => {
  render(<AgentOnboardPage />);
  const card = document.querySelectorAll('#cards > .card')[0] as HTMLElement;
  const save = card.querySelector('[data-act="save"]') as HTMLButtonElement;

  await userEvent.click(card.querySelector('input[data-chan="webhook"]') as HTMLInputElement);
  await userEvent.click(card.querySelector('input[data-chan="api"]') as HTMLInputElement);

  await waitFor(() => {
    expect(card.querySelector('[data-err]')?.textContent).toContain('R4');
  });
  expect(save.disabled).toBe(true);

  await userEvent.click(card.querySelector('input[data-chan="webhook"]') as HTMLInputElement);
  await waitFor(() => {
    expect(card.querySelector('[data-err]')?.textContent).toBe('');
  });
  expect(save.disabled).toBe(false);
});

test('R2：关共享且开写 → 保存时提示须带 project_id', async () => {
  render(<AgentOnboardPage />);
  const card = document.querySelectorAll('#cards > .card')[0] as HTMLElement;
  await userEvent.click(card.querySelector('input[data-iso="projShare"]') as HTMLInputElement);
  await userEvent.click(card.querySelector('[data-act="save"]') as HTMLButtonElement);
  await waitFor(() => {
    expect(screen.getByText(/R2：记忆读写须带 project_id/)).toBeInTheDocument();
  });
});

test('测试接入 → toast + 显示注入预览；轮换密钥 → toast', async () => {
  render(<AgentOnboardPage />);
  const card = document.querySelectorAll('#cards > .card')[0] as HTMLElement;
  const inject = card.querySelector('[data-inject]') as HTMLElement;
  expect(inject.style.display).toBe('none');

  await userEvent.click(card.querySelector('[data-act="test"]') as HTMLButtonElement);
  await waitFor(() => expect(screen.getByText(/测试成功：deepseek harness/)).toBeInTheDocument());
  expect(inject.style.display).not.toBe('none');

  await userEvent.click(card.querySelector('[data-act="rotate"]') as HTMLButtonElement);
  await waitFor(() => expect(screen.getByText(/已轮换，旧 Key 24h 内有效/)).toBeInTheDocument());
});

test('一键接入：四段动画跑完 → 完成审计文案 + Codex 转降级', async () => {
  render(<AgentOnboardPage />);
  const codexCard = document.querySelectorAll('#cards > .card')[2] as HTMLElement;
  expect(codexCard.querySelector('.statusdot.st-degraded')).toBeTruthy();

  await userEvent.click(screen.getByRole('button', { name: /自动发现并接入本机 Agent/ }));

  await waitFor(() => {
    expect(document.querySelectorAll('#stages .stage.done')).toHaveLength(4);
  }, { timeout: 4000 });
  await waitFor(() => {
    expect(screen.getByText(/完成 · 发现并绑定 3 个 · 已记审计 auto_bind/)).toBeInTheDocument();
  });
  await waitFor(() => {
    expect(screen.getByText(/一键接入完成：自动发现 3 个 Agent 并绑定/)).toBeInTheDocument();
  });
});

test('撤销自动绑定 → 该卡片回到未配置（R9）', async () => {
  render(<AgentOnboardPage />);
  await userEvent.click(document.querySelector('[data-unbind="0"]') as HTMLButtonElement);
  await waitFor(() => {
    expect(screen.getByText(/已撤销 deepseek harness 的自动绑定/)).toBeInTheDocument();
  });
  const card = document.querySelectorAll('#cards > .card')[0] as HTMLElement;
  expect(card.textContent).toContain('未配置');
  expect(document.querySelector('[data-unbind="0"]')).toBeNull(); // 已撤销 → 按钮消失
});

test('request_id 点击 → 跳审计提示（18.2-E）', async () => {
  render(<AgentOnboardPage />);
  const rid = document.querySelector('[data-rid]') as HTMLElement;
  await userEvent.click(rid);
  await waitFor(() => {
    expect(screen.getByText(/定位 deepseek harness 的 request_id 链路/)).toBeInTheDocument();
  });
});