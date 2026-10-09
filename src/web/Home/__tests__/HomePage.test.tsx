// T9 验收（提前规划的测试）：首页装配容器（HomePage 集成，§0.2/§0.3）
// 对应 specs/tasks/HOME-LOGIN.md T9 「验收（提前规划的测试）」
// 串起 TopBar + Dashboard + LoginModal：未登录灰置不阻塞 → ▶ 登录弹卡 → 登录成功整页刷新 → 登出回灰置。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { HomePage } from '../HomePage.tsx';
import { login as localLogin, registerAccount, resetAuthStore } from '../../../auth/loginService.ts';
import { hashPassword } from '../../../auth/hash.ts';
import type { RawHomeFeed } from '../../../home/dashboard.ts';
import type { SyncState } from '../../../types/home.ts';

const ACCOUNT = 'user_001';

const raw: RawHomeFeed = {
  gains: [
    { icon: '🪙', title: 'Token 节省', big: '-58%', desc: 'payload 780/1500', src: 'mech' },
    { icon: '⚡', title: '效率提升', big: '-34%', desc: '免重复背景交代', src: 'mech' },
    { icon: '🔁', title: '跨 Agent 复用', big: '3.2×', desc: '1 次沉淀 · 4 端共享', src: 'mech' },
    { icon: '💸', title: '模型成本', big: '省¥19', desc: '反代理', src: 'mech' },
  ],
  anomalies: [
    { title: 'Codex 熔断 OPEN', detail: 'desktop/Codex 连续失败≥5', level: 'error', request_id: 'req_x1', jump: 'P10' },
    { title: '反代理 claude-free 额度 90%', detail: '临 proxy_budget', level: 'warn', request_id: 'req_x3', jump: 'P13' },
  ],
  activeMemories: [{ title: '为什么上次重构失败', hits: 3, decayClass: 'hot', request_id: 'req_001' }],
  todos: [{ label: '⚖️ 待裁决 3 条', detail: '9.7 冲突队列', request_id: 'req_003', kind: 'dispute' }],
};

const sync: SyncState = { form: 'desktop', role: 'primary', lastReconcileAt: Date.now(), pendingSync: 0 };

function typeInto(container: HTMLElement, id: string, value: string) {
  fireEvent.change(container.querySelector(`#${id}`)!, { target: { value } });
}

describe('T9 首页装配容器', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetAuthStore();
    registerAccount(ACCOUNT, hashPassword('pw'), { enterprise_id: 'ent_001', team_id: 'team_001', perspective: 'team' });
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errSpy.mockRestore();
    resetAuthStore();
  });

  it('初始渲染未登录态：显示门控遮罩 + ▶ 登录，不渲染 Dashboard', () => {
    const { container } = render(<HomePage raw={raw} sync={sync} loginFn={localLogin} />);
    expect(container.querySelector('#hiUnauth')).not.toBeNull();
    expect(container.querySelector('#btnOpenLogin')).not.toBeNull();
    // 未登录 + requireLogin=true：显示门控遮罩
    expect(container.querySelector('#authGate')).not.toBeNull();
    // Dashboard 数据区不应出现
    expect(container.querySelector('#gains')).toBeNull();
    expect(container.querySelector('#dashGrid')).toBeNull();
    // 已登录专属元素尚未出现
    expect(container.querySelector('#hiAuth')).toBeNull();
    expect(container.querySelector('#btnLogout')).toBeNull();
  });

  it('点 ▶ 登录 → 弹出 LoginModal', () => {
    const { container } = render(<HomePage raw={raw} sync={sync} loginFn={localLogin} />);
    fireEvent.click(container.querySelector('#btnOpenLogin')!);
    expect(container.querySelector('.login-modal.show')).not.toBeNull();
  });

  it('登录成功 → 整页刷新为已登录（TopBar 变 + Dashboard 出数据）', async () => {
    const { container } = render(<HomePage raw={raw} sync={sync} loginFn={localLogin} />);
    fireEvent.click(container.querySelector('#btnOpenLogin')!);
    typeInto(container, 'acc', ACCOUNT);
    typeInto(container, 'pwd', 'pw');
    await act(async () => {
      fireEvent.click(container.querySelector('#btnLogin')!);
    });
    // 顶栏变已登录
    expect(container.querySelector('#hiAuth')?.textContent).toContain('user_001');
    expect(container.querySelector('#btnLogout')).not.toBeNull();
    // Dashboard 出数据（灰置占位消失，功劳 4 卡出现）
    expect(container.querySelector('#offPlaceholder')).toBeNull();
    expect(container.querySelectorAll('.gains .gain')).toHaveLength(4);
    // 弹卡已关闭
    expect(container.querySelector('.login-modal.show')).toBeNull();
  });

  it('登出 → 回到门控遮罩', async () => {
    const { container } = render(<HomePage raw={raw} sync={sync} loginFn={localLogin} />);
    fireEvent.click(container.querySelector('#btnOpenLogin')!);
    typeInto(container, 'acc', ACCOUNT);
    typeInto(container, 'pwd', 'pw');
    await act(async () => {
      fireEvent.click(container.querySelector('#btnLogin')!);
    });
    expect(container.querySelector('#hiAuth')).not.toBeNull();
    // 登出
    fireEvent.click(container.querySelector('#btnLogout')!);
    expect(container.querySelector('#hiUnauth')).not.toBeNull();
    expect(container.querySelector('#authGate')).not.toBeNull();
    expect(container.querySelector('#gains')).toBeNull();
    expect(container.querySelector('#hiAuth')).toBeNull();
  });

  it('无控制台异常（整条流程 console.error 为空）', async () => {
    const { container } = render(<HomePage raw={raw} sync={sync} loginFn={localLogin} />);
    fireEvent.click(container.querySelector('#btnOpenLogin')!);
    typeInto(container, 'acc', ACCOUNT);
    typeInto(container, 'pwd', 'pw');
    await act(async () => {
      fireEvent.click(container.querySelector('#btnLogin')!);
    });
    fireEvent.click(container.querySelector('#btnLogout')!);
    expect(errSpy).not.toHaveBeenCalled();
  });
});
