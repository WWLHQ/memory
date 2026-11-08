// P6-T3 告警时间线（12.2）
// 左轴按级别染色（crit=红 / warn=琥珀）；request_id / memory_id 渲染为真实页面深链：
// → /audit.html?request_id=...（审计页按真实 queryAudit 展开链路）或 /memory.html?mem_id=...（记忆页定位）。
// 无关联对象的告警如实显示「无关联对象」，不放 href="#" 假跳。
import type { AlertItem } from './types.ts';

interface Props {
  alerts: AlertItem[];
  /** 兼容旧调用：页面已改为真实 href 导航，此回调不再用于伪造跳转 */
  onJump?: (kind: 'request' | 'memory', id: string) => void;
}

function auditHref(rid: string): string {
  return `/audit.html?request_id=${encodeURIComponent(rid)}`;
}
function memoryHref(mid: string): string {
  return `/memory.html?mem_id=${encodeURIComponent(mid)}`;
}
function clock(ts: string): string {
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return ts;
  return new Date(t).toLocaleTimeString('zh-CN', { hour12: false });
}

export function AlertTimeline({ alerts }: Props) {
  if (alerts.length === 0) {
    return <div className="p0-card" data-testid="alert-empty">当前筛选无告警</div>;
  }
  return (
    <div className="p0-card" data-testid="alert-timeline">
      <div className="p0-hd">
        <h3>告警时间线（12.2）</h3>
        <span className="p0-sub">左轴按级别染色 · 命中 {alerts.length} 条</span>
        <span className="p0-right p0-tag info">点击真实跳转审计 / 记忆</span>
      </div>
      <ul className="p0-tl">
        {alerts.map((a, i) => {
          const href = a.request_id ? auditHref(a.request_id) : a.memory_id ? memoryHref(a.memory_id) : null;
          return (
            <li key={i} className={`p0-tl-item ${a.level}`} data-testid={`alert-${i}`}>
              <span className="p0-tl-dot" aria-hidden="true" />
              <div className="p0-tl-body">
                <div>
                  <span className={`p0-tag ${a.level === 'crit' ? 'err' : 'warn'}`}>{a.level === 'crit' ? '严重' : '告警'}</span>{' '}
                  {a.message}
                </div>
                <div className="p0-tl-meta">
                  <span className="mono">{clock(a.ts)}</span>
                  <span>{a.agent ?? '未记录 agent'}</span>
                  {a.request_id && (
                    <a href={auditHref(a.request_id)} data-testid={`alert-req-${i}`} className="mono">
                      {a.request_id}
                    </a>
                  )}
                  {a.memory_id && (
                    <a href={memoryHref(a.memory_id)} data-testid={`alert-mem-${i}`} className="mono">
                      {a.memory_id}
                    </a>
                  )}
                  {href ? (
                    <a href={href} data-testid={`alert-go-${i}`} className="p0-btn" style={{ height: 18, padding: '0 6px' }}>处置 →</a>
                  ) : (
                    <span className="p0-note">无关联对象（不可跳）</span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
