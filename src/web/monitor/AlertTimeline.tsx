// P6-T3 告警时间线（12.2：request_id/memory_id 可点跳审计）
import type { AlertItem } from './types.ts';

interface Props {
  alerts: AlertItem[];
  onJump?: (kind: 'request' | 'memory', id: string) => void;
}

export function AlertTimeline({ alerts, onJump }: Props) {
  if (alerts.length === 0) {
    return <div className="card" data-testid="alert-empty">当前筛选无告警</div>;
  }
  return (
    <div className="card" data-testid="alert-timeline">
      <b>告警时间线（12.2）</b>
      <ul className="tl">
        {alerts.map((a, i) => (
          <li key={i} className={`tl-item ${a.level}`} data-testid={`alert-${i}`}>
            <span className="dot" />
            <div>
              <div>{a.message}</div>
              <div className="note">
                {a.ts} · {a.agent} ·{' '}
                {a.request_id && (
                  <a
                    href="#" data-testid={`alert-req-${i}`}
                    onClick={(e) => { e.preventDefault(); onJump?.('request', a.request_id!); }}
                  >
                    {a.request_id}
                  </a>
                )}{' '}
                {a.memory_id && (
                  <a
                    href="#" data-testid={`alert-mem-${i}`}
                    onClick={(e) => { e.preventDefault(); onJump?.('memory', a.memory_id!); }}
                  >
                    {a.memory_id}
                  </a>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
