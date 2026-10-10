import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AuditTable } from '../AuditTable.tsx';
import type { AuditEntry } from '../types.ts';

const mk = (over: Partial<AuditEntry>): AuditEntry => ({
  enterprise_id: 'ent_001', user_id: 'u1', ip_address: '10.0.0.5', device_info: 'd',
  action: 'recall', resource_type: 'memory', resource_id: 'm1',
  request_id: 'r1', payload_tokens: 0, pipeline_llm_tokens: 0,
  created_at: '2026-10-08T09:00:00.000Z', ...over,
});

describe('AuditTable (T4)', () => {
  it('渲染审计行全量字段', () => {
    render(<AuditTable entries={[mk({})]} activeRequestId={null} onToggleChain={vi.fn()} />);
    expect(screen.getByTestId('audit-table')).toBeInTheDocument();
    expect(screen.getByText('召回')).toBeInTheDocument(); // 动作中文
    expect(screen.getByText('memory/m1')).toBeInTheDocument();
    expect(screen.getByText('u1@10.0.0.5')).toBeInTheDocument();
  });

  it('evidence_thin 行显示证据不足', () => {
    render(<AuditTable entries={[mk({ evidence_thin: true })]} activeRequestId={null} onToggleChain={vi.fn()} />);
    expect(screen.getByTestId('ev-thin')).toHaveTextContent('证据不足');
  });

  it('点 request_id → onToggleChain 回调', () => {
    const onToggle = vi.fn();
    render(<AuditTable entries={[mk({ request_id: 'r9' })]} activeRequestId={null} onToggleChain={onToggle} />);
    fireEvent.click(screen.getByTestId('rid-r9-0'));
    expect(onToggle).toHaveBeenCalledWith('r9');
  });

  it('activeRequestId 匹配的行高亮 chain 类', () => {
    const { container } = render(
      <AuditTable entries={[mk({ request_id: 'r9' })]} activeRequestId="r9" onToggleChain={vi.fn()} />,
    );
    expect(container.querySelector('tr.chain')).not.toBeNull();
  });

  it('空列表显示无匹配', () => {
    render(<AuditTable entries={[]} activeRequestId={null} onToggleChain={vi.fn()} />);
    expect(screen.getByText('无匹配审计记录')).toBeInTheDocument();
  });

  it('跳检索页占位链接存在', () => {
    render(<AuditTable entries={[mk({ request_id: 'r1' })]} activeRequestId={null} onToggleChain={vi.fn()} />);
    expect(screen.getByTestId('jump-r1-0')).toHaveAttribute('href', '/overview.html');
  });
});
