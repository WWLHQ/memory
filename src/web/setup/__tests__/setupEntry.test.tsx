// 首启向导入口冒烟（批次37-B）：setup.html 是 vite 入口，入口文件本身也要有一条真挂载的用例。
// 断言两件事：① 没有桌面壳时页面挂载的是「纯浏览器模式做不了」的诚实卡；② 有壳时挂载向导并且真的去读主进程进度。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

const w = window as unknown as { __ELECTRON__?: boolean; api?: unknown };

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '';
  delete w.__ELECTRON__;
  delete w.api;
});

describe('setupEntry 首启向导入口（批次37-B 冒烟）', () => {
  it('无桌面壳：挂载诚实的「不可用」卡，不起任何 IPC', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    await import('../setupEntry.tsx');
    await waitFor(() => expect(screen.getByTestId('setup-unavailable')).toBeInTheDocument());
  });

  it('有桌面壳：挂载向导并向 window.api.setup.state 取真实进度', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const state = vi.fn(async () => ({
      ok: true, setup_done: false, dirs_set: true,
      ledger_dir: 'D:\\data', l0_dir: 'D:\\data', same_dir: true,
      ledger_file: { path: 'D:\\data\\memories.db.json', exists: false, bytes: 0 },
      l0_file: { path: 'D:\\data\\memories.l0.json', exists: false, bytes: 0 },
      has_admin_password: false, has_recovery: false, card_pending: false, card_exported: false, fingerprint: '',
    }));
    w.__ELECTRON__ = true;
    w.api = { setup: { state } };
    await import('../setupEntry.tsx');
    // setup-step-dirs 不等 state 就渲染；等 mock 回的真数据落到卡面（dirs_set=true → ① 已完成），
    // 否则并行负载下 effect 还没发起 IPC 就断言，这条会假红；也让下面的 disabled 不是空状态下的假通过
    await waitFor(() => expect(state).toHaveBeenCalled());
    expect(await screen.findByText('① 已完成')).toBeInTheDocument();
    expect(screen.getByTestId('setup-step-dirs')).toBeInTheDocument();
    expect(screen.getByTestId('setup-finish')).toBeDisabled();
  });
});
