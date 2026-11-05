// P6-T3 指标卡网格（12.1：6 组 14 卡，级别徽标 + 跳转）
import type { MetricCard } from './types.ts';
import { groupMetrics, levelBadge } from './logic.ts';

export function MetricGrid({ cards }: { cards: MetricCard[] }) {
  const groups = groupMetrics(cards);
  return (
    <div data-testid="metric-grid">
      {groups.map(([g, list]) => (
        <div key={g} className="card">
          <b>{g}</b>
          <div className="mgrid">
            {list.map((c) => (
              <div key={c.metric} className={`mcard ${c.level}`} data-testid={`metric-${c.metric}`}>
                <div className="row-head">
                  <span className="dim">{c.metric}</span>
                  <span className={`level ${c.level}`}>{levelBadge(c.level)}</span>
                </div>
                <div className="mval">
                  {c.value}{c.unit ?? ''}
                </div>
                <div className="note">
                  阈值 {c.threshold} · <a href="#" onClick={(e) => e.preventDefault()}>跳 {c.jump}</a>
                  {/* 兑现「显示「—」并标注未采集」：无真实口径的卡必须可辨识，不能只留一个破折号 */}
                  {c.value === '—' && <span className="dim"> · 未采集</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
