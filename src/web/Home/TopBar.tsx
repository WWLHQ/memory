// REQ-005 T6：首页顶栏组件（登录态自适应，§0.2 顶栏）
// 结构/文案/交互点严格对齐 design/ui/登录与首页_原型.html：
//   .topbar / .hi(#hiUnauth) / #btnOpenLogin / .hi(#hiAuth) / .pill.ok(#syncPill) / #btnLogout
// 未登录「欢迎使用…未登录 · 当前端[桌面] · [▶ 登录]」；
// 已登录「你好 <真实租户显示名> · 团队 <管理员分配的团队>（只读）· 当前端[桌面·主源] · 同步未实现 · [登出]」。
// 值全部来自 useTenant 的真实会话；此处不再写死示例账号/团队名（阶段5-B 清理原型文案）。
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

/** 依据：真实 lastReconcileAt 渲染相对时间（不再写死「刚刚」） */
function formatAgo(ts: number): string {
  if (!ts) return '从未对账';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
}

export interface TopBarProps {
  /** 点击「▶ 登录」回调（T9 弹登录卡片） */
  onLogin: () => void;
  /** 点击「登出」回调（T9 清会话 + useLogout） */
  onLogout: () => void;
  /** 已登录时的同步态；wired=false（缺省）= 本版本不提供云端同步，不得显示「已同步」 */
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
  // 同步引擎已实现但未接入内核 API / 主进程（agent.sync 抛 E_NOT_IMPLEMENTED）：
  // 绝不以本地/旧审计冒充「已同步」，只如实标注未接入。
  // 阶段5-E / B11：wired=false 时即使 lastReconcileAt 非零也不渲染 formatAgo()，
  // 避免把账本时间显示成云端对账时间。
  const syncText =
    sync?.wired === true
      ? `已同步 · ${formatAgo(sync.lastReconcileAt)}`
      : sync && sync.role === 'offline'
        ? `离线 ${sync.pendingSync} 条待回传 · 同步未实现（本版本不提供云端同步）`
        : `同步未实现（本版本不提供云端同步）${sync && sync.pendingSync > 0 ? ` · ${sync.pendingSync} 条待回传` : ''}`;

  return (
    <div className="topbar" id="topbar">
      <span className="hi" id="hiAuth">
        你好，{ctx.user_id}{ctx.role === 'admin' ? '（管理员）' : ''} · 团队 {ctx.team_id}（管理员分配 · 只读）· 当前端[{formLabel}·{roleLabel}]
      </span>
      <span className={sync?.wired === true ? 'pill ok' : 'pill'} id="syncPill">
        {syncText}
      </span>
      <button className="btn" id="btnLogout" type="button" onClick={onLogout}>
        登出
      </button>
    </div>
  );
}
