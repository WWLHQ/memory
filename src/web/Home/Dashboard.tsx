// REQ-005 T7：首页 Dashboard 区块组件（功劳 + 异常 + 活跃 + 待办，§0.2）
// 结构对齐 design/ui/登录与首页_原型.html：.gains(#gains)/.gain/.dash-grid(#dashGrid)/.stat/.list/.rid/.off-placeholder
// 未登录：整体灰置（.off-placeholder），不渲染数据；已登录：填数据 + 数字可点溯源 .rid → onTrace(request_id)。
// 功劳 4 卡复用 REQ-003 Gains 组件（与效果证据区同构，避免重复实现）。
// 离线端（sync.pendingSync>0）显示「离线 N 条待回传」（19.11 §5）。
// 审计 modal 由全局 useAuditModal 提供，本任务只抛 onTrace（边界：仅 src/web/Home/）。
import { useTenant } from './tenantContext.tsx';
import { buildDashboard } from '../../home/dashboard.ts';
import type { RawHomeFeed } from '../../home/dashboard.ts';
import { Gains } from '../AgentOnboard/Gains.tsx';
import type { SyncState } from '../../types/home.ts';

export interface DashboardProps {
  /** 后端/镜像原始 feed（T4 消费） */
  raw: RawHomeFeed;
  /** 同步态；pendingSync>0 时显示离线待回传提示 */
  sync?: SyncState;
  /** 点击 .rid 溯源回调（弹审计 modal，非常驻） */
  onTrace: (requestId: string) => void;
}

export function Dashboard({ raw, sync, onTrace }: DashboardProps) {
  const ctx = useTenant();
  const dash = buildDashboard(ctx, raw);

  // 未登录：整体灰置占位，不渲染任何数据
  if (!dash) {
    return (
      <>
        <div className="gains" id="gains">
          <div className="off-placeholder" id="offPlaceholder">
            未登录，登录后可查看功劳 / 异常 / 活跃 / 待办
          </div>
        </div>
        <div className="dash-grid" id="dashGrid">
          <div className="off-placeholder" id="offPlaceholder2">
            （未登录灰置）异常速览 / 活跃记忆 / 待办
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Gains gains={dash.gains} />

      {sync && sync.pendingSync > 0 && (
        <div className="offline-banner">离线 {sync.pendingSync} 条待回传</div>
      )}

      <div className="dash-grid" id="dashGrid">
        <div className="stat">
          <h3>⚠ 异常速览</h3>
          <div className="list">
            {dash.anomalies.map((a) => (
              <div className={`item ${a.level === 'error' ? 'err' : ''}`} key={a.request_id}>
                <div className="v">{a.title}</div>
                <div className="k">
                  {a.detail}{' '}
                  <span
                    className="rid"
                    role="button"
                    tabIndex={0}
                    onClick={() => onTrace(a.request_id)}
                  >
                    {a.request_id}
                  </span>
                  {a.jump ? ` [跳 ${a.jump}]` : ''}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="stat">
          <h3>📊 近 1h 召回 Top3 + 待办</h3>
          <div className="list">
            {dash.activeMemories.map((m) => (
              <div className="item" key={m.request_id}>
                <div className="v">{m.title}</div>
                <div className="k">
                  命中{m.hits}条 · decay={m.decayClass} ·{' '}
                  <span
                    className="rid"
                    role="button"
                    tabIndex={0}
                    onClick={() => onTrace(m.request_id)}
                  >
                    {m.request_id}
                  </span>
                </div>
              </div>
            ))}
            {dash.todos.map((t) => (
              <div className="item" key={t.request_id}>
                <div className="v">{t.label}</div>
                <div className="k">
                  {t.detail} ·{' '}
                  <span
                    className="rid"
                    role="button"
                    tabIndex={0}
                    onClick={() => onTrace(t.request_id)}
                  >
                    {t.request_id}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
