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
import type { Gain } from '../../../types/agentOnboard.ts';

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
function LoggedInDashboard({ rawProp = raw, sync, onTrace, effectGains, storageError }: {
  rawProp?: RawHomeFeed; sync?: SyncState; onTrace: (id: string) => void; effectGains?: Gain[];
  storageError?: string | null;
}) {
  const login = useLogin();
  useEffect(() => {
    login({ account: ACCOUNT, password: 'pw', form: 'desktop' });
  }, [login]);
  return <Dashboard raw={rawProp} sync={sync} onTrace={onTrace} effectGains={effectGains} storageError={storageError} />;
}

function renderUnauth(onTrace: (id: string) => void) {
  return render(
    <TenantProvider loginFn={localLogin}>
      <Dashboard raw={raw} sync={onlineSync} onTrace={onTrace} />
    </TenantProvider>,
  );
}
function renderAuth(opts: {
  sync?: SyncState; onTrace: (id: string) => void; rawProp?: RawHomeFeed; effectGains?: Gain[];
  storageError?: string | null;
} = { onTrace: () => {} }) {
  return render(
    <TenantProvider loginFn={localLogin}>
      <LoggedInDashboard
        sync={opts.sync}
        onTrace={opts.onTrace}
        rawProp={opts.rawProp}
        effectGains={opts.effectGains}
        storageError={opts.storageError}
      />
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
    // 数据区不渲染（关系图谱同样不渲染，未登录不泄露账本）
    expect(container.querySelector('.gain')).toBeNull();
    expect(container.querySelector('.stat')).toBeNull();
    expect(container.querySelector('.rid')).toBeNull();
    expect(container.querySelector('#layerGraph')).toBeNull();
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

  it('同步未实现：待回传提示明确标注未实现，不得冒充离线', () => {
    const unwired: SyncState = { form: 'desktop', role: 'primary', lastReconcileAt: 0, pendingSync: 2, wired: false };
    const { container } = renderAuth({ sync: unwired, onTrace: () => {} });
    expect(container.textContent).toContain('同步未实现（本版本不提供云端同步） · 2 条待回传');
    expect(container.textContent).not.toContain('离线 2 条待回传');
  });

  it('内核读不到（storageError）→ 明示「不是账本为空」+ 真实原因（批次25 P0-7）', () => {
    const { container } = renderAuth({ onTrace: () => {}, storageError: 'E_IPC_TIMEOUT 宿主桥 3s 未回话' });
    expect(container.querySelector('[data-testid="kernel-error-banner"]')).not.toBeNull();
    expect(container.textContent).toContain('内核账本没读到');
    expect(container.textContent).toContain('E_IPC_TIMEOUT');
  });

  it('账本可读（storageError=null）→ 不显示错误横幅', () => {
    const { container } = renderAuth({ onTrace: () => {} });
    expect(container.querySelector('[data-testid="kernel-error-banner"]')).toBeNull();
  });

  it('已登录：渲染 L1–L6 图谱卡片（无图谱数据时诚实空态 + 六层结构）', () => {
    const { container } = renderAuth({ onTrace: () => {} });
    expect(container.querySelector('#layerGraph')).not.toBeNull();
    expect(container.querySelectorAll('[data-graph-hub]')).toHaveLength(6);
    expect(container.querySelector('#lgEmpty')?.textContent).toContain('暂无记忆');
  });

  it('效果证据四卡渲染在关系图谱上方，且与累计四卡各自独立 id', () => {
    const effectGains: Gain[] = [
      { icon: '🪙', title: 'Token 节省', big: '-80%', desc: 'payload 300/1500', src: '内核账本·实时' },
      { icon: '⚡', title: '效率提升', big: '3 次命中', desc: '真实召回', src: '内核账本·实时' },
      { icon: '🔁', title: '跨 Agent 复用', big: '2 条 · 1 域', desc: '共享', src: '内核账本·实时' },
      { icon: '💸', title: '模型成本节省（反代理 19.8）', big: '1 次 · ¥0.02', desc: '反代理', src: '内核账本·实时' },
    ];
    const { container } = renderAuth({ onTrace: () => {}, effectGains });
    expect(container.querySelector('#gains')).not.toBeNull();
    expect(container.querySelectorAll('#effectGains > .gain')).toHaveLength(4);
    const section = container.querySelector('#effectEvidence')!;
    expect(section).not.toBeNull();
    expect(section.textContent).toContain('-80%');
    const graph = container.querySelector('#layerGraph')!;
    // effectEvidence 必须在 layerGraph 之前（用户要求：移动到关系图谱卡片上方）
    expect(section.compareDocumentPosition(graph) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
