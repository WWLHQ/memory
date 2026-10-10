// P9-T3 统计卡（7.1/7.2）
import type { FeedbackStats } from './logic.ts';

export function StatCards({ stats }: { stats: FeedbackStats }) {
  const pct = (n: number) => (stats.total ? Math.round((n / stats.total) * 100) : 0);
  return (
    <div className="card" data-testid="stat-cards">
      <b>反馈统计（7.1/7.2）</b>
      <div className="row" style={{ gap: 16 }}>
        <span data-testid="stat-confirm">确认 {stats.confirm}（{pct(stats.confirm)}%）</span>
        <span data-testid="stat-reject">拒绝 {stats.reject}（{pct(stats.reject)}%）</span>
        <span data-testid="stat-disputed">争议 {stats.disputed}（{pct(stats.disputed)}%）</span>
        <span data-testid="stat-trust">trust_delta 累计 {stats.trustTotal >= 0 ? '+' : ''}{stats.trustTotal}</span>
      </div>
      <div className="row">
        <span className="dim">评分分布</span>
        {stats.ratingDist.map((n, i) => (
          <span key={i} data-testid={`dist-${i + 1}`}>{i + 1}★×{n}</span>
        ))}
        <span className="dim">均分 {stats.avgRating}</span>
      </div>
      <div className="row" style={{ gap: 24 }}>
        <div>
          <span className="dim">TopN 高分：</span>
          {stats.topLiked.map((f) => <span key={f.id} className="mid">{f.memory_id}({f.rating}) </span>)}
        </div>
        <div>
          <span className="dim">TopN 低分：</span>
          {stats.topDisliked.map((f) => <span key={f.id} className="mid">{f.memory_id}({f.rating}) </span>)}
        </div>
      </div>
      <div className="note">每周日 03:00 汇入自生长（13.3/7.2）</div>
    </div>
  );
}
