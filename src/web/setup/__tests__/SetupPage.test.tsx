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
  // 批次58：两个可选步骤的回显（未配置态）
  backup: {
    ledger_dir: '', l0_dir: '', shared_dir: '', default_dir: 'C:////Users////e2e////backups',
    enabled: false, hour: 3, minute: 0, keep_count: 7,
  },
  llm: {
    usable: false, skipped: false, engines: [],
    presets: [
      { preset: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com', model: 'deepseek-chat', needsKey: true },
      { preset: 'ollama', name: 'Ollama（本地）', baseURL: 'http://127.0.0.1:11434', model: '', needsKey: false },
    ],
  },
};
/** 密码已设、本次内存里也没有待导出的卡（上次没导出就重启了） */
const PW_ONLY = { ...FRESH, has_admin_password: true, has_recovery: true };
/** 必需四项走完（批次58 起备份也是必需项） */
const DONE = {
  ...PW_ONLY, card_pending: true, card_exported: true, fingerprint: 'ff00ff00',
  backup: { ...FRESH.backup, ledger_dir: 'E:/bk/ledger', l0_dir: 'E:/bk/l0', enabled: true },
};
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
  llmTest?: unknown;
  llmSave?: unknown;
  setBackup?: { ok: boolean; warnings?: string[]; error?: string };
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
  // 批次58：两个可选步骤的通道（默认都成功，用例按需覆盖）
  const chooseBackupDir = vi.fn((...a: unknown[]) => Promise.resolve({
    ok: true, group: a[0] === 'l0' ? 'l0' : 'ledger', dir: a[0] === 'l0' ? 'E:/bk/l0' : 'E:/bk/ledger',
  }));
  const setBackup = vi.fn((patch?: { ledgerDir?: string; l0Dir?: string }) => {
    current = {
      ...current,
      backup: {
        ...current.backup,
        ledger_dir: typeof patch?.ledgerDir === 'string' ? patch.ledgerDir : '',
        l0_dir: typeof patch?.l0Dir === 'string' ? patch.l0Dir : '',
        enabled: true,
      },
    };
    return Promise.resolve(opts.setBackup ?? { ok: true, warnings: [] });
  });
  const llmTest = vi.fn((_draft?: Record<string, unknown>) => Promise.resolve(opts.llmTest ?? {
    ok: true, model: 'deepseek-chat', latencyMs: 320, engine: { id: 'deepseek', name: 'DeepSeek', model: 'deepseek-chat' },
  }));
  const llmSave = vi.fn((_draft?: Record<string, unknown>) => Promise.resolve(opts.llmSave ?? {
    ok: true, model: 'deepseek-chat', latencyMs: 300, usable: true,
    engine: { id: 'deepseek', name: 'DeepSeek', model: 'deepseek-chat' },
  }));
  const skipLlm = vi.fn(() => Promise.resolve({ ok: true, skipped: true }));
  w.api = { setup: { state, setL0Password, regenCode, exportCard, finish, reselectDirs, chooseBackupDir, setBackup, llmTest, llmSave, skipLlm } };
  /** 流程中途改主进程回显（模拟「导出后状态真的变了」） */
  const setState = (next: typeof FRESH) => { current = next; };
  return { state, setL0Password, regenCode, exportCard, finish, reselectDirs, chooseBackupDir, setBackup, llmTest, llmSave, skipLlm, setState };
}

/** 先走完「设密码 → 发码」：页面不显示没生成过的码，所以导出按钮在这之后才存在 */
async function issueCode(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('setup-pw-form')).toBeInTheDocument());
  fireEvent.change(screen.getByTestId('setup-pw'), { target: { value: 'My-First-Pass1!' } });
  fireEvent.change(screen.getByTestId('setup-pw2'), { target: { value: 'My-First-Pass1!' } });
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

  it('密码两步：不满足 ≥12 位复杂度或两次不一致不给提交；一致后把原样字符串交给主进程', async () => {
    const { setL0Password } = mockHost();
    render(<SetupPage />);
    await waitFor(() => expect(screen.getByTestId('setup-pw-form')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('setup-pw'), { target: { value: 'short12' } });
    fireEvent.change(screen.getByTestId('setup-pw2'), { target: { value: 'short12' } });
    expect(screen.getByTestId('setup-pw-submit')).toBeDisabled();
    fireEvent.change(screen.getByTestId('setup-pw2'), { target: { value: 'another-pass' } });
    expect(screen.getByTestId('setup-pw-submit')).toBeDisabled();
    fireEvent.change(screen.getByTestId('setup-pw'), { target: { value: 'My-First-Pass1!' } });
    fireEvent.change(screen.getByTestId('setup-pw2'), { target: { value: 'My-First-Pass1!' } });
    expect(screen.getByTestId('setup-pw-submit')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('setup-pw-submit'));
    await waitFor(() => expect(setL0Password).toHaveBeenCalled());
    expect(setL0Password.mock.calls[0][0]).toBe('My-First-Pass1!');
  });

  it('发码成功：分组明文码可见 + 复制与导出入口，且写明只显现这一次', async () => {
    mockHost();
    render(<SetupPage />);
    await issueCode();
    expect(screen.getByTestId('setup-code').textContent).toContain(GROUPED);
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
    // 批次58：备份是必需项——这里先给上，才能验「导出后完成按钮真的放开」这一条
    mockHost({
      state: { ...FRESH, backup: { ...FRESH.backup, ledger_dir: 'E:/bk/ledger' } },
      export: { ok: true, file_name: '卡.txt', inside_data_root: true },
    });
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
    fireEvent.change(screen.getByTestId('setup-regen-pw'), { target: { value: 'My-First-Pass1!' } });
    fireEvent.click(screen.getByTestId('setup-regen'));
    await waitFor(() => expect(regenCode).toHaveBeenCalled());
    expect(regenCode.mock.calls[0][0]).toBe('My-First-Pass1!');
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

// 批次58：两个可选步骤（备份路径 / 精炼大模型）。
// 口径：可选 ≠ 可以糊弄——「没配」与「配了」必须能一眼分开；跳过大模型必须先把代价说清楚，
// 且「确认跳过」才落标记，取消只是关掉弹窗、回到配置。
describe('SetupPage（批次58：备份路径 + 精炼大模型两个可选步骤）', () => {
  it('备份：选目录即落盘（图中每列一个「选择目录」，不再另造保存按钮）', async () => {
    const h = mockHost();
    render(<SetupPage />);
    await waitFor(() => expect(screen.getByTestId('setup-backup-ledger')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('setup-backup-choose-ledger'));
    await waitFor(() => expect(h.chooseBackupDir).toHaveBeenCalledWith('ledger'));
    await waitFor(() => expect(h.setBackup).toHaveBeenCalled());
    expect(h.setBackup.mock.calls[0][0]).toEqual({ ledgerDir: 'E:/bk/ledger', l0Dir: '' });
    await waitFor(() => expect((screen.getByTestId('setup-backup-ledger') as HTMLInputElement).value).toBe('E:/bk/ledger'));
    fireEvent.click(screen.getByTestId('setup-backup-choose-l0'));
    await waitFor(() => expect(h.chooseBackupDir).toHaveBeenCalledWith('l0'));
    await waitFor(() => expect(h.setBackup.mock.calls.length).toBe(2));
    expect(h.setBackup.mock.calls[1][0]).toEqual({ ledgerDir: 'E:/bk/ledger', l0Dir: 'E:/bk/l0' });
    await waitFor(() => expect(screen.getByTestId('setup-backup-msg').textContent).toContain('已保存'));
  });

  it('备份：主进程回警告（与库同目录）时原样显示，不吞掉', async () => {
    mockHost({ setBackup: { ok: true, warnings: ['记忆库备份与库在同一目录：同一次事故里会一起没'] } });
    render(<SetupPage />);
    await waitFor(() => expect(screen.getByTestId('setup-backup-choose-ledger')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('setup-backup-choose-ledger'));
    await waitFor(() => expect(screen.getByTestId('setup-backup-msg')).toBeInTheDocument());
    expect(screen.getByTestId('setup-backup-msg').textContent).toContain('同一次事故里会一起没');
  });

  it('备份：没选目录时输入框如实显示「未设置」，不冒充已有备份', async () => {
    const h = mockHost();
    render(<SetupPage />);
    await waitFor(() => expect(screen.getByTestId('setup-backup-ledger')).toBeInTheDocument());
    expect((screen.getByTestId('setup-backup-ledger') as HTMLInputElement).value).toBe('未设置');
    expect((screen.getByTestId('setup-backup-l0') as HTMLInputElement).value).toBe('未设置');
    expect(h.setBackup).not.toHaveBeenCalled();
    expect(screen.getByTestId('setup-chip-①').className).not.toContain('ok');
  });

  it('模型：没拨测通过前「保存并启用」不可点；拨测通过后才放开', async () => {
    const h = mockHost();
    render(<SetupPage />);
    await waitFor(() => expect(screen.getByTestId('setup-llm-test')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('setup-llm-model'), { target: { value: 'deepseek-chat' } });
    fireEvent.change(screen.getByTestId('setup-llm-key'), { target: { value: 'sk-e2e' } });
    expect(screen.getByTestId('setup-llm-save')).toBeDisabled();
    fireEvent.click(screen.getByTestId('setup-llm-test'));
    await waitFor(() => expect(h.llmTest).toHaveBeenCalled());
    expect(h.llmTest.mock.calls[0][0]).toMatchObject({ model: 'deepseek-chat', apiKey: 'sk-e2e' });
    await waitFor(() => expect(screen.getByTestId('setup-llm-save')).not.toBeDisabled());
    expect(screen.getByTestId('setup-llm-probe').textContent).toContain('连通');
  });

  it('模型：拨测失败 → 保存仍禁用，并把主进程给的原因原样显示', async () => {
    mockHost({ llmTest: { ok: false, error: 'HTTP 401 Unauthorized' } });
    render(<SetupPage />);
    await waitFor(() => expect(screen.getByTestId('setup-llm-test')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('setup-llm-model'), { target: { value: 'deepseek-chat' } });
    fireEvent.change(screen.getByTestId('setup-llm-key'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByTestId('setup-llm-test'));
    await waitFor(() => expect(screen.getByTestId('setup-llm-probe').textContent).toContain('HTTP 401'));
    expect(screen.getByTestId('setup-llm-save')).toBeDisabled();
  });

  it('模型：保存由主进程复测后才算数——保存被拒时如实显示、不谎称已启用', async () => {
    const h = mockHost({ llmSave: { ok: false, error: '连通性测试未通过，未保存：timeout' } });
    render(<SetupPage />);
    await waitFor(() => expect(screen.getByTestId('setup-llm-test')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('setup-llm-model'), { target: { value: 'deepseek-chat' } });
    fireEvent.change(screen.getByTestId('setup-llm-key'), { target: { value: 'sk-e2e' } });
    fireEvent.click(screen.getByTestId('setup-llm-test'));
    await waitFor(() => expect(h.llmTest).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('setup-llm-save'));
    await waitFor(() => expect(screen.getByTestId('setup-error')).toBeInTheDocument());
    expect(screen.getByTestId('setup-error').textContent).toContain('未保存');
    expect(screen.queryByTestId('setup-llm-msg')).toBeNull();
  });

  it('跳过：弹窗必须写明「无法生成 L2–L5 精炼记忆层」；点否只关窗，不落跳过标记', async () => {
    const h = mockHost();
    render(<SetupPage />);
    await waitFor(() => expect(screen.getByTestId('setup-llm-skip')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('setup-llm-skip'));
    await waitFor(() => expect(screen.getByTestId('setup-skip-dialog')).toBeInTheDocument());
    const dialog = screen.getByTestId('setup-skip-dialog');
    expect(dialog.textContent).toContain('无法生成 L2–L5 精炼记忆层');
    expect(dialog.textContent).toContain('L1 原文');
    fireEvent.click(screen.getByTestId('setup-skip-cancel'));
    await waitFor(() => expect(screen.queryByTestId('setup-skip-dialog')).toBeNull());
    expect(h.skipLlm).not.toHaveBeenCalled();
  });

  it('跳过：必需项已齐时，确认跳过即记标记并直接进入应用', async () => {
    const h = mockHost({ state: DONE });
    const onNavigate = vi.fn();
    render(<SetupPage onNavigate={onNavigate} />);
    await waitFor(() => expect(screen.getByTestId('setup-llm-skip')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('setup-llm-skip'));
    await waitFor(() => expect(screen.getByTestId('setup-skip-confirm')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('setup-skip-confirm'));
    await waitFor(() => expect(h.skipLlm).toHaveBeenCalled());
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('http://127.0.0.1:5180/overview.html'));
  });

  it('跳过：必需项没齐时只记标记，不假装能进应用', async () => {
    const h = mockHost();
    const onNavigate = vi.fn();
    render(<SetupPage onNavigate={onNavigate} />);
    await waitFor(() => expect(screen.getByTestId('setup-llm-skip')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('setup-llm-skip'));
    fireEvent.click(screen.getByTestId('setup-skip-confirm'));
    await waitFor(() => expect(h.skipLlm).toHaveBeenCalled());
    expect(onNavigate).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('setup-llm-msg').textContent).toContain('还有必需步骤'));
  });

  it('备份未设 = 必需项没齐：进入应用不可点（批次58：备份必选）', async () => {
    mockHost({ state: { ...DONE, backup: { ...FRESH.backup } } });
    render(<SetupPage />);
    await waitFor(() => expect(screen.getByTestId('setup-finish')).toBeInTheDocument());
    expect(screen.getByTestId('setup-finish')).toBeDisabled();
    expect(screen.getByTestId('setup-finish-hint').textContent).toContain('四项必需');
    expect(screen.getByTestId('setup-chip-①').className).not.toContain('ok');
  });

  it('进度三格：状态全部来自 setup:state（已设备份 / 已跳过模型 / 已导出卡）', async () => {
    mockHost({
      state: {
        ...DONE,
        backup: { ...FRESH.backup, ledger_dir: 'E:/bk/ledger', l0_dir: 'E:/bk/l0', enabled: true },
        llm: { ...FRESH.llm, skipped: true },
      },
    });
    render(<SetupPage />);
    await waitFor(() => expect(screen.getByTestId('setup-chip-①')).toBeInTheDocument());
    expect(screen.getByTestId('setup-chip-①').className).toContain('ok');
    expect(screen.getByTestId('setup-chip-②').className).toContain('ok');
    expect(screen.getByTestId('setup-chip-③').className).toContain('ok');
    expect(screen.queryByTestId('setup-chip-④')).toBeNull();
    // 被跳过的模型步骤在底栏与进度文案里都要能看见
    expect(screen.getByTestId('setup-step-finish').textContent).toContain('精炼模型已跳过');
  });
});
