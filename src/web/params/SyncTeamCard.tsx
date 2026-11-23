// 参数页「同步与团队」只读卡（批次63）。
// 这里没有任何 params:v1 参数：租户三元组来自内核 getTenant()，中枢游标/审计来自真实 PgSyncHub。
// 只读展示，绝不把「本页看不到」写成「已同步」，同步动作仍在「同步与裁决」页。
import { useEffect, useState } from 'react';
import { getTenant } from '../kernel.ts';
import { syncChannels, type SyncChannelsView } from '../sync/coreSyncPage.ts';

export function SyncTeamCard() {
  const tenant = getTenant();
  const [view, setView] = useState<SyncChannelsView | null>(null);

  useEffect(() => {
    let alive = true;
    void syncChannels().then((v) => { if (alive) setView(v); });
    return () => { alive = false; };
  }, []);

  return (
    <div className="card" data-testid="sync-team-card">
      <b>同步与团队（只读真值）</b>
      <div className="note">
        这些不是 params:v1 参数，本页只展示，不提供修改：租户三元组由内核 / 登录会话下发；
        中枢游标与审计条数来自本机 PgSyncHub。同步动作与冲突裁决在「同步与裁决」页。
      </div>
      <div data-testid="sync-tenant">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="dim">企业</span><code style={{ fontSize: 11 }}>{tenant.enterprise_id}</code>
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="dim">团队</span><code style={{ fontSize: 11 }}>{tenant.team_id}</code>
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="dim">账号</span><code style={{ fontSize: 11 }}>{tenant.user_id}</code>
        </div>
      </div>
      <div className="note" data-testid="sync-hub-state">
        {view === null
          ? '正在读取本机同步中枢…'
          : view.ok
            ? `中枢：${view.node.name} · ${view.node.detail}${view.cursor !== null ? ` · 游标 ${view.cursor}` : ''}`
            : `中枢不可达：[${view.code ?? 'E_SYNC_HUB_UNREACHABLE'}] ${view.error ?? '未知原因'}（如实显示，不谎称已同步）`}
      </div>
      <div className="note">
        同步策略：内核按 <code>team_id</code> 隔离；L0 密文层强制不同步（42-A 红线）；本页不写同步偏好。
      </div>
    </div>
  );
}
