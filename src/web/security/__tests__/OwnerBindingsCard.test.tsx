// OB-3：「个人记忆账号绑定」卡单测。
// 口径：读 owner-bindings:read（登录可读，成员能看到绑没绑）；成员只读无写入口；
// 管理员增删改 + 逐字口令 BIND；env 接管时如实提示界面修改不生效；整页不渲染 JSON / 英文字段名。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('../../shared/session.ts', () => ({
  currentSessionId: () => 's_test',
  useSessionContext: () => ({ sid: 's_test', context: { role: 'admin' }, role: 'admin' as const, loading: false }),
  fetchSessionContext: async () => null,
}));
vi.mock('../../kernel.ts', () => ({ newRequestId: () => 'req_ob_test' }));

import { OwnerBindingsCard } from '../OwnerBindingsCard.tsx';

const w = window as unknown as { __ELECTRON__?: boolean; api?: unknown };

const BINDINGS = [
  { account: '13838528400', kernel_user_id: 'u1' },
];

function mockHost(opts: { read?: unknown; set?: unknown } = {}) {
  w.__ELECTRON__ = true;
  const readFn = vi.fn(() => Promise.resolve(opts.read ?? {
    ok: true, bindings: BINDINGS, source: 'file', kernel_user_id: 'u1', env_override: false,
  }));
  const setFn = vi.fn((_next?: unknown, _confirm?: unknown, _requestId?: unknown, _sessionId?: unknown) => Promise.resolve(opts.set ?? {
    ok: true, prev: BINDINGS, next: [{ account: 'alice', kernel_user_id: 'u1' }],
    backup_file: 'D:\\data\\backups\\owner-bindings\\owner-bindings.json.bak-x', restart_required: true,
  }));
  w.api = { ownerBindings: { read: readFn, set: setFn } };
  return { readFn, setFn };
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

describe('OwnerBindingsCard（OB 个人记忆账号绑定）', () => {
  it('浏览器环境：如实说明不可用，不渲染表格与写入口', () => {
    render(<OwnerBindingsCard enabled />);
    expect(screen.getByTestId('owner-bindings-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('owner-bindings-table')).toBeNull();
  });

  it('成员态（只读）：看到绑定行与「需要管理员修改」，无输入框与保存按钮', async () => {
    const { readFn } = mockHost();
    render(<OwnerBindingsCard enabled={false} />);
    await waitFor(() => expect(screen.getByTestId('owner-bindings-row-0')).toBeInTheDocument());
    expect(readFn).toHaveBeenCalledWith('s_test');
    expect(screen.getByTestId('owner-bindings-row-0').textContent).toContain('13838528400');
    expect(screen.getByTestId('owner-bindings-row-0').textContent).toContain('u1');
    expect(screen.getByTestId('owner-bindings-member-note').textContent).toContain('需要管理员修改');
    expect(screen.queryByTestId('owner-bindings-save')).toBeNull();
    expect(screen.queryByTestId('owner-bindings-add')).toBeNull();
    expect(screen.queryByTestId('owner-bindings-input-0-account')).toBeNull();
  });

  it('无绑定时显示「暂无绑定」占位行（fail-closed 语义：所有账号个人记忆仅本机可见）', async () => {
    mockHost({ read: { ok: true, bindings: [], source: 'file', kernel_user_id: 'u1', env_override: false } });
    render(<OwnerBindingsCard enabled={false} />);
    await waitFor(() => expect(screen.getByTestId('owner-bindings-empty')).toBeInTheDocument());
    expect(screen.getByTestId('owner-bindings-empty').textContent).toContain('暂无绑定');
  });

  it('env 接管时如实提示「界面修改不会生效」', async () => {
    mockHost({ read: { ok: true, bindings: BINDINGS, source: 'env', kernel_user_id: 'u1', env_override: true } });
    const { container } = render(<OwnerBindingsCard enabled={false} />);
    await waitFor(() => expect(screen.getByTestId('owner-bindings-row-0')).toBeInTheDocument());
    expect(container.textContent).toContain('界面修改不会生效');
  });

  it('UI 铁律（AC-11）：整页不出现英文字段名 / 原始 JSON 字样，只有中文名与值', async () => {
    mockHost();
    const { container } = render(<OwnerBindingsCard enabled={false} />);
    await waitFor(() => expect(screen.getByTestId('owner-bindings-row-0')).toBeInTheDocument());
    const text = container.textContent ?? '';
    expect(text).not.toContain('kernel_user_id');
    expect(text).not.toContain('account');
    expect(text).not.toContain('"');
    expect(text).not.toContain('{');
    expect(text).not.toContain('payload');
  });

  it('管理员：口令未逐字输入 BIND 时保存禁用；输入后保存走 owner-bindings:set 并显示备份 + 重启生效', async () => {
    const { setFn } = mockHost();
    render(<OwnerBindingsCard enabled />);
    await waitFor(() => expect(screen.getByTestId('owner-bindings-save')).toBeInTheDocument());
    const word = screen.getByTestId('owner-bindings-word') as HTMLInputElement;
    const save = screen.getByTestId('owner-bindings-save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(word, { target: { value: 'bind' } });
    expect(save.disabled).toBe(false); // 口令校验大小写不敏感（与 TENANT 卡同口径，toUpperCase 比较）
    fireEvent.change(word, { target: { value: 'BIND' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(screen.getByTestId('owner-bindings-receipt')).toBeInTheDocument());
    expect(setFn).toHaveBeenCalledTimes(1);
    expect(setFn.mock.calls[0][1]).toBe('BIND');
    expect(screen.getByTestId('owner-bindings-receipt').textContent).toContain('重启应用后生效');
    expect(screen.getByTestId('owner-bindings-receipt').textContent).toContain('备份文件');
  });

  it('管理员：添加一行默认填本机用户标识，删除行可用', async () => {
    mockHost();
    render(<OwnerBindingsCard enabled />);
    await waitFor(() => expect(screen.getByTestId('owner-bindings-add')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('owner-bindings-add'));
    const acc = screen.getByTestId('owner-bindings-input-1-account') as HTMLInputElement;
    const kernel = screen.getByTestId('owner-bindings-input-1-kernel_user_id') as HTMLInputElement;
    expect(acc.value).toBe('');
    expect(kernel.value).toBe('u1');
    fireEvent.click(screen.getByTestId('owner-bindings-remove-0'));
    expect(screen.queryByTestId('owner-bindings-input-1-account')).toBeNull();
    expect(screen.getByTestId('owner-bindings-input-0-kernel_user_id')).toBeInTheDocument();
  });
});
