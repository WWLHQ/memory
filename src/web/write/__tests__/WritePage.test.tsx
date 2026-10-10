import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { WritePage } from '../WritePage.tsx';

describe('WritePage 集成（T5）', () => {
  it('渲染表单与标题', () => {
    render(<WritePage />);
    expect(screen.getByTestId('write-page')).toBeInTheDocument();
    expect(screen.getByTestId('write-form')).toBeInTheDocument();
  });

  it('project_id 只读必填（R2）', () => {
    render(<WritePage />);
    const proj = screen.getByTestId('f-project') as HTMLInputElement;
    expect(proj.readOnly).toBe(true);
    expect(proj.value).toBe('p1');
  });

  it('空内容 → 提交按钮禁用；填内容后可提交并出回执', () => {
    render(<WritePage />);
    const submit = screen.getByTestId('submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true); // content 空
    fireEvent.change(screen.getByTestId('f-content'), { target: { value: '一条新的记忆内容' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(screen.getByTestId('receipt')).toBeInTheDocument();
    expect(screen.getByTestId('receipt-id')).toHaveTextContent(/^mem_/);
    expect(screen.getByTestId('toast')).toHaveTextContent('已写入记忆');
  });

  it('内容与既有记忆重复 → 查重卡标记命中', () => {
    render(<WritePage />);
    fireEvent.change(screen.getByTestId('f-content'), {
      target: { value: '项目技术栈约束：后端 Node 22 + React 19 strict' }, // 与 mem_001 近一致
    });
    expect(screen.getByTestId('dedup-card').className).toContain('dup');
    expect(screen.getByTestId('composite')).toHaveTextContent('命中重复');
  });

  it('回执含 L1–L6，L1 标注仅审计展开（15.3）', () => {
    render(<WritePage />);
    fireEvent.change(screen.getByTestId('f-content'), { target: { value: '某条新记忆' } });
    fireEvent.click(screen.getByTestId('submit'));
    for (const ln of ['L1', 'L2', 'L3', 'L4', 'L5', 'L6']) {
      expect(screen.getByTestId(`layer-${ln}`)).toBeInTheDocument();
    }
    expect(within(screen.getByTestId('layer-L1')).getByText(/仅审计可展开原文/)).toBeInTheDocument();
  });
});
