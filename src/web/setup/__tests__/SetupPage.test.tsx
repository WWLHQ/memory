// 批次37-B：首启向导页单测。
// 口径：一切进度以主进程 setup:state 的真值回显（目录、库文件在不在、密码设没设、卡导没导），
// 页面不自己推断也不粉饰；恢复码明文只在发那一次显示，主进程说「不再回显」时页面绝不编一个；
// 「完成设置」在三步没走完时不可点，主进程拒绝时原样显示原因、绝不跳主界面。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { SetupPage } from '../SetupPage.tsx';

const w = window as unknown as { __ELECTRON__?: boolean; api?: unknown };

const CODE = 'aB3dEfGhIjKlMnOpQrStUvWxYz0123456789abcD';
const GROUPED = (CODE.match(/.{1,4}/g) ?? []).join(' ');

const FILE_LEDGER = { path: 'D:\\data\\memories.db.json', exists: false, bytes: 0 };
const FILE_L0 = { path: 'D:\\l0disk\\memories.l0.json', exists: false, bytes: 0 };

/** 全新机器：目录已选、密码未设、没有卡 */
const FRESH = {
  ok: true, setup_done: false, dirs_set: true,
  ledger_dir: 'D:\\data', l0_dir: 'D:\\l0disk', same_dir: false,
  ledger_file: FILE_LEDGER, l0_file: FILE_L0,
  has_admin_password: false, has_recovery: false,
  card_pending: false, card_exported: false, fingerprint: '',
};
/** 密码已设、本次内存里也没有待导出的卡（上次没导出就重启了） */
const PW_ONLY = { ...FRESH, has_admin_password: true, has_recovery: true };
/** 三步走完 */
const DONE = { ...PW_ONLY, card_pending: true, card_exported: true, fingerprint: 'ff00ff00' };
/** 老指针升级上来：已有两份库文件（向导必须说「沿用、不覆盖」而不是「新库」） */
const WITH_FILES = {
  ...FRESH, same_dir: true, l0_dir: 'D:\\data',
  ledger_file: { ...FILE_LEDGER, exists: true, bytes: 5_800_000 },
  l0_file: { ...FILE_L0, exists: true, bytes: 320_000 },
};

/** 装上桌面壳：window.api.setup.{state,reselectDirs,setL0Password,regenCode,exportCard,finish} */
function mockHost(opts: {
  state?: typeof FRESH;
  issue?: unknown;
  export?: { ok: boolean; file_name?: string; inside_data_root?: boolean; canceled?: boolean; error?: string };
  finish?: unknown;
  reselect?: unknown;
} = {}) {
  w.__ELECTRON__ = true;
  let current = opts.state ?? FRESH;
  const state = vi.fn(() => Promise.resolve(current));
  const setL0Password = vi.fn((..._a: unknown[]) => Promise.resolve(opts.issue ?? {
    ok: true, recovery_code: CODE, recovery_code_grouped: GROUPED, fingerprint: 'ff00ff00',
  }));
  const regenCode = vi.fn((..._a: unknown[]) => Promise.resolve(opts.issue ?? {
    ok: true, recovery_code: CODE, recovery_code_grouped: GROUPED, fingerprint: 'ff00ff00',
  }));
  const exportRes = opts.export ?? { ok: true, file_name: 'L0恢复卡-ff00ff00.txt', inside_data_root: false };
  // 导出成功时主进程真的会记下「本次导出过一张卡」，所以 mock 同步改状态：页面的 refresh 必须把它读回来
  const exportCard = vi.fn(() => {
    if (exportRes.ok) current = { ...current, card_pending: true, card_exported: true, has_admin_password: true, fingerprint: 'ff00ff00' };
    return Promise.resolve(exportRes);
  });
  const finish = vi.fn(() => Promise.resolve(opts.finish ?? { ok: true, next_url: 'http://127.0.0.1:5180/overview.html' }));
  const reselectDirs = vi.fn(() => Promise.resolve(opts.reselect ?? { ok: true, relaunch: true }));
  w.api = { setup: { state, setL0Password, regenCode, exportCard, finish, reselectDirs } };
  /** 流程中途改主进程回显（模拟「导出后状态真的变了」） */
  const setState = (next: typeof FRESH) => { current = next; };
  return { state, setL0Password, regenCode, exportCard, finish, reselectDirs, setState };
}

/** 先走完「设密码 → 发码」：页面不显示没生成过的码，所以导出按钮在这之后才存在 */
async function issueCode(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('setup-pw-form')).toBeInTheDocument());
  fireEvent.change(screen.getByTestId('setup-pw'), { target: { value: 'my-first-pass' } });
  fireEvent.change(screen.getByTestId('setup-pw2'), { target: { value: 'my-first-pass' } });
  fireEvent.click(screen.getByTestId('setup-pw-submit'));
  await waitFor(() => expect(screen.getByTestId('setup-card-body')).toBeInTheDocument());
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

describe('SetupPage（批次37-B 首启强制向导）', () => {
  it('浏览器模式（无桌面壳）：如实说明做不了，不起任何 IPC', () => {
    render(<SetupPage />);
    expect(screen.getByTestId('setup-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('setup-step-dirs')).toBeNull();
  });

  it('挂载即读主进程进度：两个库路径与「新库/沿用」按真值回显', async () => {
    const { state } = mockHost({ state: WITH_FILES });
    render(<SetupPage />);
    await waitFor(() => expect(screen.getByTestId('setup-step-dirs')).toBeInTheDocument());
    expect(state).toHaveBeenCalled();
    const dirs = screen.getByTestId('setup-step-dirs').textContent ?? '';
    expect(dirs).toContain('D:\\data\\memories.db.json');
    expect(dirs).toContain('已有文件');
    expect(dirs).toContain('不覆盖');
    expect(dirs).toContain('同一目录');
  });

  it('新库（文件还不存在）：显示「首次写入时创建」，不谎称已有数据', async () => {
    mockHost();
    render(<SetupPage />);
    await waitFor(() => expect(screen.getByTestId('setup-step-dirs')).toBeInTheDocument());
    expect(screen.getByTestId('setup-step-dirs').textContent).toContain('首次写入时创建');
  });

  it('密码两步：不足 8 位或两次不一致不给提交；一致后把原样字符串交给主进程', async () => {
    const { setL0Password } = mockHost();
    render(<SetupPage />);
    await waitFor(() => expect(screen.getByTestId('setup-pw-form')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('setup-pw'), { target: { value: 'short12' } });
    fireEvent.change(screen.getByTestId('setup-pw2'), { target: { value: 'short12' } });
    expect(screen.getByTestId('setup-pw-submit')).toBeDisabled();
    fireEvent.change(screen.getByTestId('setup-pw2'), { target: { value: 'another-pass' } });
    expect(screen.getByTestId('setup-pw-submit')).toBeDisabled();
    fireEvent.change(screen.getByTestId('setup-pw'), { target: { value: 'my-first-pass' } });
    fireEvent.change(screen.getByTestId('setup-pw2'), { target: { value: 'my-first-pass' } });
    expect(screen.getByTestId('setup-pw-submit')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('setup-pw-submit'));
    await waitFor(() => expect(setL0Password).toHaveBeenCalled());
    expect(setL0Password.mock.calls[0][0]).toBe('my-first-pass');
  });

  it('发码成功：分组明文码可见 + 复制与导出入口，且写明只显现这一次', async () => {
    mockHost();
    render(<SetupPage />);
    await issueCode();
    expect(screen.getByTestId('setup-code').textContent).toBe(GROUPED);
    expect(screen.getByTestId('setup-code-once').textContent).toContain('只在这次生成时显示');
    expect(screen.getByTestId('setup-export')).toBeInTheDocument();
  });

  it('没导出恢复卡：完成按钮不可点（强制先导出才能继续）', async () => {
    mockHost();
    render(<SetupPage />);
    await waitFor(() => expect(screen.getByTestId('setup-finish')).toBeInTheDocument());
    expect(screen.getByTestId('setup-finish')).toBeDisabled();
    expect(screen.getByTestId('setup-finish-hint')).toBeInTheDocument();
    expect(screen.getByTestId('setup-not-exported')).toBeInTheDocument();
  });

  it('导出取消：说明「可再点一次」，不放行完成', async () => {
    const h = mockHost({ export: { ok: false, canceled: true, error: '未导出恢复卡' } });
    render(<SetupPage />);
    await issueCode();
    fireEvent.click(screen.getByTestId('setup-export'));
    await waitFor(() => expect(screen.getByTestId('setup-export-result')).toBeInTheDocument());
    expect(screen.getByTestId('setup-export-result').textContent).toContain('可以再点一次');
    // 主进程仍说没导出 → 完成按钮继续不可点
    expect(screen.getByTestId('setup-finish')).toBeDisabled();
    expect(h.finish).not.toHaveBeenCalled();
  });

  it('导出落在数据根内：回执如实警告「同一次事故会一起没」，但按已导出放行', async () => {
    mockHost({ export: { ok: true, file_name: '卡.txt', inside_data_root: true } });
    render(<SetupPage />);
    await issueCode();
    fireEvent.click(screen.getByTestId('setup-export'));
    await waitFor(() => expect(screen.getByTestId('setup-export-result')).toBeInTheDocument());
    expect(screen.getByTestId('setup-export-result').textContent).toContain('同一次事故');
    // 页面导出后自己会重读进度：主进程记下「已导出」，完成按钮才放开
    await waitFor(() => expect(screen.getByTestId('setup-finish')).not.toBeDisabled());
  });

  it('三步走完：点完成按主进程给的地址跳转（端口参数由主进程拼）', async () => {
    mockHost({ state: DONE });
    const onNavigate = vi.fn();
    render(<SetupPage onNavigate={onNavigate} />);
    await waitFor(() => expect(screen.getByTestId('setup-finish')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('setup-finish'));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('http://127.0.0.1:5180/overview.html'));
  });

  it('主进程拒绝完成：显示原因，绝不跳主界面', async () => {
    mockHost({ state: DONE, finish: { ok: false, error: '恢复卡还没导出：没有这张卡，忘记管理密码时 L0 原文就找不回来' } });
    const onNavigate = vi.fn();
    render(<SetupPage onNavigate={onNavigate} />);
    await waitFor(() => expect(screen.getByTestId('setup-finish')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('setup-finish'));
    await waitFor(() => expect(screen.getByTestId('setup-error')).toBeInTheDocument());
    expect(screen.getByTestId('setup-error').textContent).toContain('忘记管理密码时 L0 原文就找不回来');
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('密码已设：不再给首次设密码表单，改给「用管理密码重新生成恢复码」', async () => {
    const { setL0Password, regenCode } = mockHost({ state: PW_ONLY });
    render(<SetupPage />);
    await waitFor(() => expect(screen.getByTestId('setup-pw-set')).toBeInTheDocument());
    expect(screen.queryByTestId('setup-pw-form')).toBeNull();
    expect(setL0Password).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('setup-regen-pw'), { target: { value: 'my-first-pass' } });
    fireEvent.click(screen.getByTestId('setup-regen'));
    await waitFor(() => expect(regenCode).toHaveBeenCalled());
    expect(regenCode.mock.calls[0][0]).toBe('my-first-pass');
  });

  it('卡待导出但码已不再回显：如实说明，绝不编一个码出来', async () => {
    mockHost({ state: { ...PW_ONLY, card_pending: true } });
    render(<SetupPage />);
    await waitFor(() => expect(screen.getByTestId('setup-card-pending')).toBeInTheDocument());
    expect(screen.queryByTestId('setup-code')).toBeNull();
    expect(screen.getByTestId('setup-card-pending').textContent).toContain('码明文不再回显');
  });

  it('重选目录：主进程返回取消时保持原位并说明，不假装已改', async () => {
    const { reselectDirs } = mockHost({ state: PW_ONLY, reselect: { ok: false, canceled: true, error: '未选择目录：保持原位置不变' } });
    render(<SetupPage />);
    await waitFor(() => expect(screen.getByTestId('setup-reselect-dirs')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('setup-reselect-dirs'));
    await waitFor(() => expect(reselectDirs).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('setup-error')).toBeInTheDocument());
    expect(screen.getByTestId('setup-error').textContent).toContain('保持原位置不变');
  });

  it('进度读取失败（IPC 抛错）：显示原因，不显示任何「已完成」状态', async () => {
    w.__ELECTRON__ = true;
    w.api = { setup: { state: vi.fn(() => Promise.reject(new Error('主进程未就绪'))) } };
    render(<SetupPage />);
    await waitFor(() => expect(screen.getByTestId('setup-error')).toBeInTheDocument());
    expect(screen.getByTestId('setup-error').textContent).toContain('主进程未就绪');
    expect(screen.getByTestId('setup-step-dirs').textContent).toContain('读取中');
  });
});
