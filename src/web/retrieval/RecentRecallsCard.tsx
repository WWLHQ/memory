// 检索页右侧栏「最近召回」：直接读账本 recall 审计行（时间 / query 摘要 / 命中 / 注入 t），
// 「今日 N 次」按北京时间自然日统计。没有记录就如实说没有，不塞演示行。
import type { RecentRecallRow } from './types.ts';

export type RecentPhase = 'loading' | 'ready' | 'error';

interface Props {
  phase: RecentPhase;
  rows: RecentRecallRow[];
  /** 今日（北京时间）召回次数，来自同一份审计 */
  today: number;
  error?: string;
  onRefresh: () => void;
  onOpenAudit: (requestId: string) => void;
}

/** 时间一律按北京时间（UTC+08:00）显示，不随本机时区漂移 */
export function fmtClock(ts: number): string {
  const d = new Date(ts + 8 * 3600 * 1000);
  if (!Number.isFinite(d.getTime())) return '--:--:--';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

export function RecentRecallsCard({ phase, rows, today, error, onRefresh, onOpenAudit }: Props) {
  return (
    <section className="ret-card ret-recent" data-testid="recent-recalls">
      <div className="ret-recent-hd">
        <span className="ret-recent-eyebrow">RECENT RECALLS</span>
        <h3>最近召回</h3>
        <span className="ret-recent-sum" data-testid="recent-today">
          {phase === 'ready'
            ? `今日 ${today} 次 · 审计为证`
            : phase === 'loading'
              ? '今日次数读取中…'
              : '今日次数未取到（审计不可读）'}
        </span>
        <button type="button" className="ret-linkbtn ret-recent-refresh" data-testid="recent-refresh" onClick={onRefresh}>
          刷新
        </button>
      </div>

      <div className="ret-recent-head">
        <span>时间</span>
        <span>query 摘要</span>
        <span className="num">命中</span>
        <span className="num">注入 t</span>
      </div>

      {phase === 'loading' && <div className="ret-recent-empty">读取账本召回记录…</div>}
      {phase === 'error' && (
        <div className="ret-recent-empty" data-testid="recent-error">读取失败：{error ?? '账本不可达'}（不生成演示行）</div>
      )}
      {phase === 'ready' && rows.length === 0 && (
        <div className="ret-recent-empty" data-testid="recent-empty">
          账本暂无召回记录（真实 0 条）。完成一次检索后这里才有条目。
        </div>
      )}
      {phase === 'ready' && rows.map((r) => (
        <button
          type="button"
          key={r.request_id}
          className="ret-recent-row"
          data-testid={`recent-row-${r.request_id}`}
          title={`${r.request_id} · 点开查该次审计`}
          onClick={() => onOpenAudit(r.request_id)}
        >
          <span className="mono ret-recent-time">{fmtClock(r.ts)}</span>
          <span className="ret-recent-q">{r.query}</span>
          <span className="num">{r.hits}</span>
          <span className="num">{r.injected_tokens}</span>
        </button>
      ))}
    </section>
  );
}
