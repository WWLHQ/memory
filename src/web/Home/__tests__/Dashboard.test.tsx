// T7 验收（提前规划的测试）：首页 Dashboard 区块组件（功劳 + 异常 + 活跃 + 待办，§0.2）
// 对应 specs/tasks/HOME-LOGIN.md T7 「验收（提前规划的测试）」
// 交互点对齐 design/ui/登录与首页_原型.html：.gains/.gain/.dash-grid/.stat/.list/.rid/.off-placeholder
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { useEffect } from 'react';
import { TenantProvider, useLogin } from '../tenantContext.tsx';
import { Dashboard } from '../Dashboard.tsx';
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
    { title: 'web 同步对账超时', detail: 'sync_fail · form:web', level: 'error', request_id: 'req_x2', jump: 'P15' },
    { title: '反代理 claude-free 额度 90%', detail: '临 proxy_budget', level: 'warn', request_id: 'req_x3', jump: 'P13' },
  ],
  activeMemories: [
    { title: '为什么上次重构失败', hits: 3, decayClass: 'hot', request_id: 'req_001' },
    { title: '项目技术栈约束', hits: 2, decayClass: 'warm', request_id: 'req_002' },
    { title: '周报模板', hits: 1, decayClass: 'cold', request_id: 'req_004' },
  ],
  todos: [{ label: '⚖️ 待裁决 3 条', detail: '9.7 冲突队列', request_id: 'req_003', kind: 'dispute' }],
};

const onlineSync: SyncState = { form: 'desktop', role: 'primary', lastReconcileAt: Date.now(), pendingSync: 0 };
const offlineSync: SyncState = { form: 'mobile', role: 'offline', lastReconcileAt: Date.now(), pendingSync: 5 };

/** 已登录外壳：挂载即调 useLogin 注入上下文 */
function LoggedInDashboard({ rawProp = raw, sync, onTrace }: { rawProp?: RawHomeFeed; sync?: SyncState; onTrace: (id: string) => void }) {
  const login = useLogin();
  useEffect(() => {
    login({ account: ACCOUNT, password: 'pw', form: 'desktop' });
  }, [login]);
  return <Dashboard raw={rawProp} sync={sync} onTrace={onTrace} />;
}

function renderUnauth(onTrace: (id: string) => void) {
  return render(
    <TenantProvider loginFn={localLogin}>
      <Dashboard raw={raw} sync={onlineSync} onTrace={onTrace} />
    </TenantProvider>,
  );
}
function renderAuth(opts: { sync?: SyncState; onTrace: (id: string) => void; rawProp?: RawHomeFeed } = { onTrace: () => {} }) {
  return render(
    <TenantProvider loginFn={localLogin}>
      <LoggedInDashboard sync={opts.sync} onTrace={opts.onTrace} rawProp={opts.rawProp} />
    </TenantProvider>,
  );
}

describe('T7 首页 Dashboard 区块组件', () => {
  beforeEach(() => {
    resetAuthStore();
    registerAccount(ACCOUNT, hashPassword('pw'), { enterprise_id: 'ent_001', team_id: 'team_001', perspective: 'team' });
  });
  afterEach(() => resetAuthStore());

  it('未登录：显示 .off-placeholder，4 卡/异常/活跃/待办不渲染数据', () => {
    const onTrace = vi.fn();
    const { container } = renderUnauth(onTrace);
    expect(container.querySelector('#offPlaceholder')).not.toBeNull();
    expect(container.querySelector('#offPlaceholder2')).not.toBeNull();
    // 数据区不渲染
    expect(container.querySelector('.gain')).toBeNull();
    expect(container.querySelector('.stat')).toBeNull();
    expect(container.querySelector('.rid')).toBeNull();
    expect(onTrace).not.toHaveBeenCalled();
  });

  it('已登录：4 卡数据（🪙 -58% / ⚡ -34% / 🔁 3.2× / 💸 省¥19）+ 异常置顶 error + 活跃 + 待办', () => {
    const { container } = renderAuth({ onTrace: () => {} });
    const gains = container.querySelectorAll('.gains .gain');
    expect(gains).toHaveLength(4);
    const text = container.textContent ?? '';
    expect(text).toContain('🪙');
    expect(text).toContain('-58%');
    expect(text).toContain('⚡');
    expect(text).toContain('-34%');
    expect(text).toContain('🔁');
    expect(text).toContain('3.2×');
    expect(text).toContain('💸');
    expect(text).toContain('省¥19');
    // 异常首个为 error（置顶）
    const firstItem = container.querySelector('.stat .item');
    expect(firstItem?.classList.contains('err')).toBe(true);
    // 待办含 9.7 待裁决
    expect(text).toContain('待裁决 3 条');
  });

  it('点击 .rid → 触发 onTrace(request_id) 回调', () => {
    const onTrace = vi.fn();
    const { container } = renderAuth({ onTrace });
    const rid = container.querySelector('.rid')!;
    const id = rid.textContent!;
    fireEvent.click(rid);
    expect(onTrace).toHaveBeenCalledTimes(1);
    expect(onTrace).toHaveBeenCalledWith(id);
  });

  it('功劳 4 卡复用 Gains（渲染 🪙⚡🔁💸）', () => {
    const { container } = renderAuth({ onTrace: () => {} });
    // #gains 由 Gains 组件渲染（复用 REQ-003）
    expect(container.querySelector('#gains')).not.toBeNull();
    const icons = Array.from(container.querySelectorAll('.gains .gain h3')).map((h) => h.textContent ?? '');
    expect(icons.some((t) => t.includes('🪙'))).toBe(true);
    expect(icons.some((t) => t.includes('⚡'))).toBe(true);
    expect(icons.some((t) => t.includes('🔁'))).toBe(true);
    expect(icons.some((t) => t.includes('💸'))).toBe(true);
  });

  it('离线端（pendingSync>0）：显示「离线 N 条待回传」', () => {
    const { container } = renderAuth({ sync: offlineSync, onTrace: () => {} });
    expect(container.textContent).toContain('离线 5 条待回传');
  });
});
