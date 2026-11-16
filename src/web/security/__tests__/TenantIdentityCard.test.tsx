// T4（管理员与成员权限设计 §14.2 / AC-5 / AC-10 / AC-11）：「本机租户身份」卡单测。
// 口径：读 tenant:read（机器级真源，非会话三元组）；成员只读无写入口；管理员改值须逐字口令 TENANT；
// 保存回执含备份与重启生效提示；user_id 变更提示绑定失配；整页不渲染 JSON / 英文字段名。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../shared/session.ts', () => ({
  currentSessionId: () => 's_test',
  useSessionContext: () => ({ sid: 's_test', context: { role: 'admin' }, role: 'admin' as const, loading: false }),
  fetchSessionContext: async () => null,
}));
vi.mock('../../kernel.ts', () => ({ newRequestId: () => 'req_t4_test' }));

import { TenantIdentityCard } from '../TenantIdentityCard.tsx';

const w = window as unknown as { __ELECTRON__?: boolean; api?: unknown };

const TENANT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };

function mockHost(opts: { read?: unknown; set?: unknown; normalize?: unknown } = {}) {
  w.__ELECTRON__ = true;
  const readFn = vi.fn(() => Promise.resolve(opts.read ?? { ok: true, tenant: TENANT }));
  const setFn = vi.fn(() => Promise.resolve(opts.set ?? {
    ok: true,
    prev: TENANT,
    next: { user_id: 'u2', team_id: 't1', enterprise_id: 'e1' },
    backup_file: 'D:\\data\\backups\\tenant\\tenant.json.bak-x',
    restart_required: true,
  }));
  const normFn = vi.fn(() => Promise.resolve(opts.normalize ?? { ok: true, total: 10, mismatched: 0, normalized: 0 }));
  w.api = { tenant: { read: readFn, set: setFn, normalize: normFn } };
  return { readFn, setFn, normFn };
}

beforeEach(() => {
  delete w.__ELECTRON__;
  delete w.api;
});

afterEach(() => {
  delete w.__ELECTRON__;
  delete w.api;
  vi.restoreAllMocks();
});

describe('TenantIdentityCard（T4 本机租户身份）', () => {
  it('浏览器环境：如实说明不可用，不渲染表格与写入口', () => {
    render(<TenantIdentityCard enabled />);
    expect(screen.getByTestId('tenant-identity-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('tenant-identity-table')).toBeNull();
  });

  it('成员态（只读）：三行中文名 + 当前值 + 一句摘要，显示「需要管理员修改」，无输入框与保存按钮', async () => {
    const { readFn } = mockHost();
    render(<TenantIdentityCard enabled={false} />);
    await waitFor(() => expect(screen.getByTestId('tenant-identity-user_id')).toBeInTheDocument());
    expect(readFn).toHaveBeenCalledWith('s_test');
    expect(screen.getByTestId('tenant-identity-user_id').textContent).toContain('本机用户标识');
    expect(screen.getByTestId('tenant-identity-user_id').textContent).toContain('u1');
    expect(screen.getByTestId('tenant-identity-team_id').textContent).toContain('团队标识');
    expect(screen.getByTestId('tenant-identity-enterprise_id').textContent).toContain('企业（租户）标识');
    expect(screen.getByTestId('tenant-identity-member-note').textContent).toContain('需要管理员修改');
    expect(screen.queryByTestId('tenant-identity-save')).toBeNull();
    expect(screen.queryByTestId('tenant-identity-input-user_id')).toBeNull();
    expect(screen.queryByTestId('tenant-identity-normalize')).toBeNull();
  });

  it('UI 铁律（AC-11）：整页不出现英文字段名 / 原始 JSON 字样，只有中文名与值', async () => {
    mockHost();
    const { container } = render(<TenantIdentityCard enabled={false} />);
    await waitFor(() => expect(screen.getByTestId('tenant-identity-user_id')).toBeInTheDocument());
    const text = container.textContent ?? '';
    expect(text).not.toContain('user_id');
    expect(text).not.toContain('team_id');
    expect(text).not.toContain('enterprise_id');
    expect(text).not.toContain('"');
    expect(text).not.toContain('payload');
  });

  it('管理员：口令未逐字输入 TENANT 时保存禁用；输入后保存走 tenant:set 并显示备份 + 重启生效 + 绑定失配提示', async () => {
    const { setFn } = mockHost();
    render(<TenantIdentityCard enabled />);
    await waitFor(() => expect(screen.getByTestId('tenant-identity-input-user_id')).toBeInTheDocument());
    const save = screen.getByTestId('tenant-identity-save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('tenant-identity-word'), { target: { value: 'tenan' } });
    expect(save.disabled).toBe(true);
    // 改本机用户标识 u1 → u2（触发绑定失配提示路径）
    fireEvent.change(screen.getByTestId('tenant-identity-input-user_id'), { target: { value: 'u2' } });
    fireEvent.change(screen.getByTestId('tenant-identity-word'), { target: { value: 'TENANT' } });
    expect(save.disabled).toBe(false);
    await actClick(save);
    await waitFor(() => expect(screen.getByTestId('tenant-identity-receipt')).toBeInTheDocument());
    expect(setFn).toHaveBeenCalledWith(
      { user_id: 'u2', team_id: 't1', enterprise_id: 'e1' }, 'TENANT', 'req_t4_test', 's_test',
    );
    const receipt = screen.getByTestId('tenant-identity-receipt').textContent ?? '';
    expect(receipt).toContain('重启');
    expect(receipt).toContain('备份');
    expect(receipt).toContain('失配');
  });

  it('管理员归一：点击走 tenant:normalize，全部一致时如实说「无需改写」', async () => {
    const { normFn } = mockHost({ normalize: { ok: true, total: 10, mismatched: 0, normalized: 0 } });
    render(<TenantIdentityCard enabled />);
    await waitFor(() => expect(screen.getByTestId('tenant-identity-normalize')).toBeInTheDocument());
    await actClick(screen.getByTestId('tenant-identity-normalize'));
    await waitFor(() => expect(screen.getByTestId('tenant-identity-normalize-report')).toBeInTheDocument());
    expect(normFn).toHaveBeenCalledWith('req_t4_test', 's_test');
    expect(screen.getByTestId('tenant-identity-normalize-report').textContent).toContain('无需改写');
  });

  it('主进程拒绝（如口令错误 / 备份失败）：原样展示错误，不显示成功回执', async () => {
    mockHost({ set: { ok: false, error: '二次确认未通过：需逐字输入 TENANT 才允许改写本机数据身份' } });
    render(<TenantIdentityCard enabled />);
    await waitFor(() => expect(screen.getByTestId('tenant-identity-input-user_id')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('tenant-identity-word'), { target: { value: 'TENANT' } });
    await actClick(screen.getByTestId('tenant-identity-save'));
    await waitFor(() => expect(screen.getByTestId('tenant-identity-action-error')).toBeInTheDocument());
    expect(screen.getByTestId('tenant-identity-action-error').textContent).toContain('二次确认未通过');
    expect(screen.queryByTestId('tenant-identity-receipt')).toBeNull();
  });
});

async function actClick(el: HTMLElement) {
  const { act } = await import('@testing-library/react');
  await act(async () => { fireEvent.click(el); });
}
