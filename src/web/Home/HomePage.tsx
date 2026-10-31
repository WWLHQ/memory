// REQ-005 T9：首页装配容器（HomePage，§0.1/§0.2/§0.3 集成）
// 串起 TopBar + Dashboard + LoginModal；初始进入即首页（未登录态，不阻塞登录，§0.2 红线⑤）。
// 登录成功 → useLogin 注入上下文 → 整页刷新为已登录（TopBar 变 + Dashboard 出数据）；登出 → 回灰置。
// 未登录不阻塞：功能区灰置占位，仅顶栏「▶ 登录」可点（红线⑤）。
// 边界：仅 src/web/Home/HomePage.tsx + 测试（不改 auth/后端）。
import { useState } from 'react';
import { TenantProvider, useLogout, useTenant, type LoginFn, type LogoutFn } from './tenantContext.tsx';
import { TopBar } from './TopBar.tsx';
import { Dashboard } from './Dashboard.tsx';
import { LoginModal } from './LoginModal.tsx';
import type { SyncState } from '../../types/home.ts';
import type { Form } from '../../types/agentOnboard.ts';
import type { RawHomeFeed } from '../../home/dashboard.ts';
import type { LayerGraph } from './layerGraph.ts';
import type { Gain } from '../../types/agentOnboard.ts';

export interface HomePageProps {
  /** 后端/镜像原始 feed（T4 消费） */
  raw: RawHomeFeed;
  /** 同步态；缺省桌面主源 */
  sync?: SyncState;
  /** L1–L6 关系图谱（真实账本推导；缺省为空图谱） */
  graph?: LayerGraph;
  /** 效果证据四卡（内核账本真实聚合；缺省不渲染该区块） */
  effectGains?: Gain[];
  /** 内核账本读取失败的真实原因；有值 → Dashboard 明示「不是空账本」（批次25 P0-7） */
  storageError?: string | null;
  /** 点击 .rid 溯源回调（弹审计 modal） */
  onTrace?: (requestId: string) => void;
  /** 图谱刷新（重新读取内核账本） */
  onRefreshGraph?: () => void | Promise<void>;
  /** 注入登录实现（T11 后端镜像 / 测试 mock）；缺省 T3 本地内核 */
  loginFn?: LoginFn;
  /** 注入登出副作用（T11 后端写审计）；缺省无操作 */
  onLogout?: LogoutFn;
  /** 是否要求登录才能查看首页内容（默认 true）；false 时跳过门控（如内联标识演示页） */
  requireLogin?: boolean;
}

function HomeInner({ raw, sync, graph, effectGains, storageError, onTrace, onRefreshGraph, requireLogin = true }: HomePageProps) {
  const [open, setOpen] = useState(false);
  const logout = useLogout();
  const ctx = useTenant();

  // 未登录 + 要求登录：只显示 TopBar + 登录遮罩，不渲染 Dashboard
  if (requireLogin && !ctx) {
    return (
      <div className="home" id="home">
        <TopBar onLogin={() => setOpen(true)} onLogout={logout} sync={sync} />
        <div className="auth-gate" id="authGate">
          <div className="gate-card">
            <h2>请先登录</h2>
            <p>登录后查看你的功劳 / 异常 / 活跃记忆 / 待办</p>
            <button className="btn primary" id="btnOpenLoginFromGate" type="button" onClick={() => setOpen(true)}>
              ▶ 登录
            </button>
          </div>
        </div>
        <LoginModal
          open={open}
          onClose={() => setOpen(false)}
          onSuccess={() => setOpen(false)}
          form={(sync?.form ?? 'desktop') as Form}
        />
      </div>
    );
  }

  return (
    <div className="home" id="home">
      <TopBar onLogin={() => setOpen(true)} onLogout={logout} sync={sync} />
      <Dashboard
        raw={raw}
        sync={sync}
        graph={graph}
        effectGains={effectGains}
        storageError={storageError}
        onRefreshGraph={onRefreshGraph}
        onTrace={onTrace ?? (() => {})}
      />
      <LoginModal
        open={open}
        onClose={() => setOpen(false)}
        onSuccess={() => setOpen(false)}
        form={(sync?.form ?? 'desktop') as Form}
      />
    </div>
  );
}

export function HomePage({ loginFn, onLogout, ...props }: HomePageProps) {
  return (
    <TenantProvider loginFn={loginFn} onLogout={onLogout}>
      <HomeInner {...props} />
    </TenantProvider>
  );
}
