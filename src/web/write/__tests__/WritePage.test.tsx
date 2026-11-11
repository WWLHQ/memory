import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { WritePage } from '../WritePage.tsx';
import { resetKernelForTests, setKernelL0ForTests } from '../../kernel.ts';
import { createTestVault, TEST_ADMIN_ID } from '../../../core/memagent/__tests__/l0Kit.ts';
import { SESSION_STORAGE_KEY } from '../../../shared/sessionKey.ts';

describe('WritePage 集成（T5）', () => {
  // 写入必须先有 L0 写密钥（§4.4.4）：注入真 L0Vault（管理密码设置即解锁写密钥）
  beforeEach(async () => {
    resetKernelForTests();
    const { vault } = await createTestVault();
    setKernelL0ForTests({ l0: vault, l0Admin: vault });
  });
  it('渲染表单与标题', () => {
    render(<WritePage />);
    expect(screen.getByTestId('write-page')).toBeInTheDocument();
    expect(screen.getByTestId('write-form')).toBeInTheDocument();
  });

  it('project_id 只读必填（R2）', () => {
    render(<WritePage />);
    const proj = screen.getByTestId('f-project') as HTMLInputElement;
    expect(proj.readOnly).toBe(true);
    expect(proj.value).toBe('P1');
  });

  it('空内容 → 提交按钮禁用；填内容后可提交并出回执', async () => {
    render(<WritePage />);
    const submit = screen.getByTestId('submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true); // content 空
    fireEvent.change(screen.getByTestId('f-content'), { target: { value: '部署流水线构建失败：Node 版本不匹配需统一为 22 LTS' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    // 提交走内核 ma.write（async），用 waitFor 等回执
    await waitFor(() => expect(screen.getByTestId('receipt')).toBeInTheDocument());
    expect(screen.getByTestId('receipt-id')).toHaveTextContent(/^mem_/);
    expect(screen.getByTestId('toast')).toHaveTextContent('已写入记忆');
  });

  it('内容与既有记忆重复 → 查重卡标记命中（真实账本：先写后查）', async () => {
    render(<WritePage />);
    // 第一步：写入一条真实记忆（进账本）
    fireEvent.change(screen.getByTestId('f-content'), {
      target: { value: '项目技术栈约束：后端 Node 22 + React 19 strict' },
    });
    fireEvent.click(screen.getByTestId('submit'));
    await waitFor(() => expect(screen.getByTestId('receipt')).toBeInTheDocument());
    // 第二步：重新输入相同内容 → 查重卡应标记命中（候选来自真实账本）
    fireEvent.change(screen.getByTestId('f-content'), {
      target: { value: '项目技术栈约束：后端 Node 22 + React 19 strict' },
    });
    expect(screen.getByTestId('dedup-card').className).toContain('hit');
    expect(screen.getByTestId('dedup-verdict')).toHaveTextContent('预览提示可能重复');
  });

  it('查重卡诚实化（批次25 P0-3）：页面不再声称六维、不再留无后端的三模式按钮', () => {
    render(<WritePage />);
    expect(screen.getByTestId('write-page').textContent).not.toMatch(/六维查重/);
    fireEvent.change(screen.getByTestId('f-content'), {
      target: { value: '本地词面查重预览：CI 缓存键需带 Node 主版本' },
    });
    expect(screen.getByTestId('dedup-card')).toBeInTheDocument();
    for (const id of ['op-merge', 'op-overwrite', 'op-keep']) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    }
  });

  it('修复轮：查重卡常驻右栏——空内容也渲染（诚实空态，不画预览分）', () => {
    render(<WritePage />);
    expect(screen.getByTestId('dedup-card')).toBeInTheDocument();
    expect(screen.getByTestId('dedup-empty')).toHaveTextContent('输入内容后按当前候选实算词面相似度');
    expect(screen.queryByTestId('dedup-score')).not.toBeInTheDocument();
    // 输入内容后同一张卡切换为实算预览
    fireEvent.change(screen.getByTestId('f-content'), { target: { value: '修复轮常驻验证：写入前先看相似度' } });
    expect(screen.getByTestId('dedup-score')).toBeInTheDocument();
    expect(screen.queryByTestId('dedup-empty')).not.toBeInTheDocument();
  });

  it('回执：L1 真实产出且仅审计展开；L2–L6 标「未精炼」（未接入 LLM）', async () => {
    render(<WritePage />);
    fireEvent.change(screen.getByTestId('f-content'), { target: { value: '部署脚本需固定 Node 22 LTS，避免 CI 版本漂移' } });
    fireEvent.click(screen.getByTestId('submit'));
    await waitFor(() => expect(screen.getByTestId('receipt')).toBeInTheDocument());
    for (const ln of ['L1', 'L2', 'L3', 'L4', 'L5', 'L6']) {
      expect(screen.getByTestId(`layer-${ln}`)).toBeInTheDocument();
    }
    expect(within(screen.getByTestId('layer-L1')).getByText(/仅审计可展开原文/)).toBeInTheDocument();
    for (const ln of ['L2', 'L3', 'L4', 'L5', 'L6']) {
      expect(within(screen.getByTestId(`layer-${ln}`)).getByText(/未精炼（未接入 LLM）/)).toBeInTheDocument();
    }
  });

  it('内核不可达 → 查重候选如实报错（不冒充「无候选」），错误态不画查重卡', async () => {
    render(<WritePage load={() => Promise.reject(new Error('E_IPC_TIMEOUT 宿主桥 3s 未回话'))} />);
    fireEvent.change(screen.getByTestId('f-content'), {
      target: { value: '内核不可达时查重候选读取失败' },
    });
    await waitFor(() => expect(screen.getByTestId('kernel-error')).toBeInTheDocument());
    expect(screen.getByTestId('kernel-error-reason')).toHaveTextContent('E_IPC_TIMEOUT');
    expect(screen.queryByTestId('dedup-card')).not.toBeInTheDocument();
  });

  it('修复轮2：登录态实时跟随（免刷新）——storage 事件后查重候选重载、解锁卡「未登录」转管理员密码框', async () => {
    resetKernelForTests();
    const { vault } = await createTestVault();
    setKernelL0ForTests({ l0: vault, l0Admin: vault });
    await vault.lockWrite({ admin_user_id: TEST_ADMIN_ID }); // 锁写密钥，解锁卡才走 need-admin/密码框分支
    const load = vi.fn(async () => []);
    render(<WritePage load={load} />);
    await waitFor(() => expect(screen.getByTestId('l0-unlock-need-admin')).toHaveTextContent('未登录'));
    const callsBefore = load.mock.calls.length;
    // 模拟壳层登录：登录发生在壳层文档，写 localStorage + 本 iframe 收 storage 事件
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({
        context: {
          enterprise_id: 'e1', team_id: 't1', user_id: TEST_ADMIN_ID,
          perspective: 'team', session_id: 'sid_e2e_admin', role: 'admin',
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));
    localStorage.setItem(SESSION_STORAGE_KEY, 'sid_e2e_admin');
    window.dispatchEvent(new StorageEvent('storage', { key: SESSION_STORAGE_KEY }));
    // 免刷新：解锁卡直接转管理员分支（出密码框），不再停留在「未登录」
    await waitFor(() => expect(screen.getByTestId('l0-unlock-password')).toBeInTheDocument());
    // 三个数据源随 sid 变化整体重载（这里以查重候选的重新拉取为准）
    await waitFor(() => expect(load.mock.calls.length).toBeGreaterThan(callsBefore));
    vi.unstubAllGlobals();
    localStorage.removeItem(SESSION_STORAGE_KEY);
  });
});
