// P6-T3 告警时间线（12.2 · 批次49 起 af-tl 版式：tm 时间 + b 标题 + af-note af-mono 元信息行）
// 左轴按级别染色（crit=err 红 / warn=wrn 琥珀）；request_id / memory_id 渲染为真实页面深链：
// → /audit.html?request_id=...（审计页按真实 queryAudit 展开链路）或 /memory.html?mem_id=...（记忆页定位）。
// 无关联对象的告警如实显示「无关联对象」，不放 href="#" 假跳。
import type { AlertItem } from './types.ts';

interface Props {
  alerts: AlertItem[];
  /** 时间窗人话标签（跟随页面 chips：近 1 小时 / 近 24 小时 / 近 7 天），用于 hint 行 */
  windowLabel?: string;
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
  return new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function AlertTimeline({ alerts, windowLabel = '近 24 小时' }: Props) {
  if (alerts.length === 0) {
    return <div className="af-panel" data-testid="alert-empty"><div className="af-empty">当前筛选无告警</div></div>;
  }
  return (
    <section className="af-panel" data-testid="alert-timeline">
      <div className="af-ph">
        <h3>告警时间线</h3>
        <span className="hint">monitor_alert · {windowLabel} · {alerts.length} 条</span>
      </div>
      <div className="af-tl" style={{ padding: '8px 0' }}>
        {alerts.map((a, i) => {
          const href = a.request_id ? auditHref(a.request_id) : a.memory_id ? memoryHref(a.memory_id) : null;
          return (
            <div key={i} className={`ti ${a.level === 'crit' ? 'err' : 'wrn'}`} data-testid={`alert-${i}`}>
              <span className="tm">{clock(a.ts)}</span>
              <div>
                <b>{a.message}</b>
                <div className="af-note af-mono">
                  agent={a.agent ?? '未记录'}
                  {a.request_id && (
                    <> · <a className="af-link" href={auditHref(a.request_id)} data-testid={`alert-req-${i}`}>{a.request_id}</a></>
                  )}
                  {a.memory_id && (
                    <> · <a className="af-link" href={memoryHref(a.memory_id)} data-testid={`alert-mem-${i}`}>{a.memory_id}</a></>
                  )}
                  {href ? (
                    <> · <a className="af-link" href={href} data-testid={`alert-go-${i}`}>处置 →</a></>
                  ) : (
                    <> · 无关联对象（不可跳）</>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
