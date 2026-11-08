// P6-T3 指标卡网格（12.1：5 组 14 卡）
// 诚实口径：有真实值的显示真实值；没有真实口径的卡不显示数值，值位直接标「未采集」——
// 不把破折号当读数，也不伪造 0 / 100%。
import type { MetricCard } from './types.ts';
import { groupMetrics, levelBadge } from './logic.ts';

export function MetricGrid({ cards }: { cards: MetricCard[] }) {
  const groups = groupMetrics(cards);
  return (
    <div data-testid="metric-grid">
      {groups.map(([g, list]) => (
        <div key={g} className="p0-card p0-mgroup" data-testid={`mgroup-${g}`}>
          <div className="p0-hd">
            <h3>{g}</h3>
            <span className="p0-tag">{list.length} 项</span>
          </div>
          <div className="mgrid">
            {list.map((c) => {
              const empty = c.value === '未取数';
              return (
                <div key={c.metric} className={`p0-mcard ${c.level}${empty ? ' empty' : ''}`} data-testid={`metric-${c.metric}`}>
                  <div className="p0-mhead">
                    <span className="p0-note">{c.metric}</span>
                    <span className={`level ${empty ? 'empty' : c.level}`} title={empty ? '无样本，不给健康/告警结论' : c.level}>
                      {empty ? '待采集' : levelBadge(c.level)}
                    </span>
                  </div>
                  <div className={`mval${empty ? ' empty' : ''}`}>
                    {empty ? '未采集' : <>{c.value}{c.unit ?? ''}</>}
                  </div>
                  <div className="p0-mfoot">
                    <span className="p0-note">阈值 {c.threshold} · 口径 {c.jump}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div className="p0-note" style={{ marginTop: 2 }}>
        「未采集」= 该卡无真实口径/样本：值位不显示数字，也不当作 0、100% 或正常读数。
      </div>
    </div>
  );
}
