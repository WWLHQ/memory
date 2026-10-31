import { beforeEach, describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { WritePage } from '../WritePage.tsx';
import { resetKernelForTests, setKernelL0ForTests } from '../../kernel.ts';
import { createTestVault } from '../../../core/memagent/__tests__/l0Kit.ts';

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
    expect(screen.getByTestId('dedup-card').className).toContain('dup');
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
});
