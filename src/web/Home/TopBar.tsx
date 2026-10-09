// REQ-005 T6：首页顶栏组件（登录态自适应，§0.2 顶栏）
// 结构/文案/交互点严格对齐 design/ui/登录与首页_原型.html：
//   .topbar / .hi(#hiUnauth) / #btnOpenLogin / .hi(#hiAuth) / .pill.ok(#syncPill) / #btnLogout
// 未登录「欢迎使用…未登录 · 当前端[桌面] · [▶ 登录]」；
// 已登录「你好 user_001 · 团队 team_001（管理员分配 · 只读）· 当前端[桌面·主源] · 已同步 · [登出]」。
// 团队只读（无编辑控件）；登录/登出动作委托父级（T9 接线），自身只消费 useTenant 渲染。
import { useTenant } from './tenantContext.tsx';
import type { SyncState, SyncRole } from '../../types/home.ts';
import type { Form } from '../../types/agentOnboard.ts';

const FORM_LABEL: Record<Form, string> = {
  desktop: '桌面',
  web: '网页',
  mobile: '移动',
  mac: 'Mac',
  linux: 'Linux',
  cli: 'CLI',
};
const ROLE_LABEL: Record<SyncRole, string> = {
  primary: '主源',
  mirror: '镜像',
  offline: '离线',
};

export interface TopBarProps {
  /** 点击「▶ 登录」回调（T9 弹登录卡片） */
  onLogin: () => void;
  /** 点击「登出」回调（T9 清会话 + useLogout） */
  onLogout: () => void;
  /** 已登录时的同步态；默认主源已同步（桌面） */
  sync?: SyncState;
}

export function TopBar({ onLogin, onLogout, sync }: TopBarProps) {
  const ctx = useTenant();

  if (!ctx) {
    return (
      <div className="topbar" id="topbar">
        <span className="hi" id="hiUnauth">
          欢迎使用记忆助手 · 当前未登录 · 当前端[桌面]
        </span>
        <button className="btn primary" id="btnOpenLogin" type="button" onClick={onLogin}>
          ▶ 登录
        </button>
      </div>
    );
  }

  const formLabel = sync ? FORM_LABEL[sync.form] : '桌面';
  const roleLabel = sync ? ROLE_LABEL[sync.role] : '主源';
  const syncText =
    sync && sync.role === 'offline' ? `离线 ${sync.pendingSync} 条待回传` : '已同步 · 刚刚';

  return (
    <div className="topbar" id="topbar">
      <span className="hi" id="hiAuth">
        你好，{ctx.user_id} · 团队 {ctx.team_id}（管理员分配 · 只读）· 当前端[{formLabel}·{roleLabel}]
      </span>
      <span className="pill ok" id="syncPill">
        {syncText}
      </span>
      <button className="btn" id="btnLogout" type="button" onClick={onLogout}>
        登出
      </button>
    </div>
  );
}
