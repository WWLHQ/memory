// REQ-005 T7：首页 Dashboard 区块组件（功劳 + 异常 + 活跃 + 待办，§0.2）
// 结构对齐 design/ui/登录与首页_原型.html：.gains(#gains)/.gain/.dash-grid(#dashGrid)/.stat/.list/.rid/.off-placeholder
// 未登录：整体灰置（.off-placeholder），不渲染数据；已登录：填数据 + 数字可点溯源 .rid → onTrace(request_id)。
// 功劳 4 卡复用 REQ-003 Gains 组件（与效果证据区同构，避免重复实现）。
// 同步未完成时显示真实待回传计数：offline → 「离线 N 条待回传」；未实现 → 「同步未实现（本版本不提供云端同步）· N 条待回传」（19.11 §5）。
// 审计 modal 由全局 useAuditModal 提供，本任务只抛 onTrace（边界：仅 src/web/Home/）。
import { useMemo } from 'react';
import { useTenant } from './tenantContext.tsx';
import { buildDashboard } from '../../home/dashboard.ts';
import type { RawHomeFeed } from '../../home/dashboard.ts';
import { Gains } from '../AgentOnboard/Gains.tsx';
import type { SyncState } from '../../types/home.ts';
import type { Gain } from '../../types/agentOnboard.ts';
import { LayerGraphPanel } from './LayerGraphPanel.tsx';
import { emptyLayerGraph, type LayerGraph } from './layerGraph.ts';

export interface DashboardProps {
  /** 后端/镜像原始 feed（T4 消费） */
  raw: RawHomeFeed;
  /** 同步态；pendingSync>0 时显示离线待回传提示 */
  sync?: SyncState;
  /** L1–L6 关系图谱（真实账本推导；缺省为空图谱，显示六层结构与诚实空态） */
  graph?: LayerGraph;
  /** 效果证据四卡（接入页迁至首页，内核账本真实聚合）；缺省不渲染 */
  effectGains?: Gain[];
  /** 内核账本读取失败的真实原因；有值 → 明示「不是空账本」+ 刷新重试（批次25 P0-7） */
  storageError?: string | null;
  /** 图谱刷新（重新读取内核账本） */
  onRefreshGraph?: () => void | Promise<void>;
  /** 点击 .rid 溯源回调（弹审计 modal，非常驻） */
  onTrace: (requestId: string) => void;
}

/** 溯源 id：只有真实 request_id 才渲染成可点 .rid；空串 → 如实显示「账本无链路」，不编造可点 id */
function TraceRef({ id, onTrace }: { id: string; onTrace: (requestId: string) => void }) {
  if (!id) return <span className="mid" data-testid="no-trace">账本无链路</span>;
  return (
    <span className="rid" role="button" tabIndex={0} onClick={() => onTrace(id)}>
      {id}
    </span>
  );
}

export function Dashboard({ raw, sync, graph, effectGains, storageError, onRefreshGraph, onTrace }: DashboardProps) {
  const ctx = useTenant();
  const dash = buildDashboard(ctx, raw);
  const safeGraph = useMemo(() => graph ?? emptyLayerGraph(), [graph]);

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

      {storageError && (
        <div className="offline-banner" data-testid="kernel-error-banner">
          内核账本没读到（不是「账本为空」）：{storageError} —— 四卡 / 关系图谱暂为空，点「刷新图谱」重试。
        </div>
      )}

      {sync && sync.pendingSync > 0 && (
        <div className="offline-banner">
          {sync.role === 'offline'
            ? `离线 ${sync.pendingSync} 条待回传 · 同步未实现（本版本不提供云端同步）`
            : `同步未实现（本版本不提供云端同步） · ${sync.pendingSync} 条待回传`}
        </div>
      )}

      {effectGains && (
        <section id="effectEvidence" data-testid="effect-evidence">
          <div className="section-title">效果证据（内核账本 · 真实聚合）</div>
          <Gains gains={effectGains} id="effectGains" />
          <div className="note">
            Token 节省 / 效率提升 / 跨 Agent 复用 / 模型成本均来自真实召回审计与记忆主表；
            无样本显示「—」，未设置单价时模型成本不估算。
          </div>
        </section>
      )}

      <LayerGraphPanel graph={safeGraph} onRefresh={onRefreshGraph} />

      <div className="dash-grid" id="dashGrid">
        <div className="stat">
          <h3>⚠ 异常速览（真实账本）</h3>
          <div className="list">
            {dash.anomalies.length === 0 ? (
              <div className="item dim" id="anomEmpty">暂无真实异常（内核账本为空 · 有动作后实时聚合）</div>
            ) : (
              dash.anomalies.map((a, i) => (
                <div className={`item ${a.level === 'error' ? 'err' : ''}`} key={`${a.request_id || a.title}-${i}`}>
                  <div className="v">{a.title}</div>
                  <div className="k">
                    {a.detail}{' '}
                    <TraceRef id={a.request_id} onTrace={onTrace} />
                    {a.jump ? ` [跳 ${a.jump}]` : ''}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="stat">
          <h3>📊 近 1h 召回 Top3 + 待办（真实账本）</h3>
          <div className="list">
            {dash.activeMemories.length === 0 && dash.todos.length === 0 ? (
              <div className="item dim" id="recallEmpty">暂无真实记录（内核账本为空 · 有召回/冲突后实时聚合）</div>
            ) : (
              <>
                {dash.activeMemories.map((m, i) => (
                  <div className="item" key={`${m.request_id || m.title}-${i}`}>
                    <div className="v">{m.title}</div>
                    <div className="k">
                      命中{m.hits}条 · decay={m.decayClass} ·{' '}
                      <TraceRef id={m.request_id} onTrace={onTrace} />
                    </div>
                  </div>
                ))}
                {dash.todos.map((t, i) => (
                  <div className="item" key={`${t.request_id || t.label}-${i}`}>
                    <div className="v">{t.label}</div>
                    <div className="k">
                      {t.detail} ·{' '}
                      <TraceRef id={t.request_id} onTrace={onTrace} />
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
