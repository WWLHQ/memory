// 生命周期页（REQ-006 / P4）状态查看器（T3）
// §P4 状态查看器（只读）：六态机选中高亮、可执行迁移提示、deprecated 替代跳转、N/M 参数展示。
import type { LifecycleRecord, MemoryStatus } from './types.ts';
import { canMigrate, STATUS_FLOW } from './logic.ts';
import { N_DAYS, M_DAYS } from './seed.ts';

export function LifecycleCard({
  rec,
  onMigrate,
}: {
  rec: LifecycleRecord;
  onMigrate: (target: MemoryStatus) => void;
}) {
  const targets = STATUS_FLOW[rec.status];
  return (
    <div className="panel" data-testid="status-card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>{rec.id} <span className="mid" style={{ color: 'var(--accent)' }}>{rec.content}</span></b>
        <span className={`status ${rec.status}`} data-testid="status-chip">{rec.status}</span>
      </div>
      <div className="kv">
        <b>温度</b><span><span className={`temp ${rec.decay_class}`}>{rec.decay_class}</span></span>
        <b>N/M 参数</b><span>hibernating 触发 {N_DAYS}d · archived 触发 {M_DAYS}d</span>
        <b>替代（9.7）</b>
        {rec.status === 'deprecated' && rec.replaced_by ? (
          <span>
            已被 <a href="/memory.html" data-testid="replaced-link">{rec.replaced_by}</a> 替代（{rec.replaced_at ? new Date(rec.replaced_at).toLocaleDateString('zh-CN') : ''}）
          </span>
        ) : (
          <span className="dim">—</span>
        )}
      </div>
      <div className="section-title">可执行迁移</div>
      <div className="mig">
        {targets.map((t) => (
          <button
            key={t}
            type="button"
            className="btn"
            data-testid={`mig-${t}`}
            disabled={!canMigrate(rec.status, t)}
            onClick={() => onMigrate(t)}
          >
            → {t}
          </button>
        ))}
      </div>
    </div>
  );
}
