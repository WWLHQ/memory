// REQ-012 T5 生效模式横幅（§2）
import type { ModeBannerData } from './types.ts';
import { modeName, sceneName } from './logic.ts';

interface Props {
  data: ModeBannerData;
  onRequestId: (id: string) => void;
  onFactRetry: () => void;
}

export function ModeBanner({ data, onRequestId, onFactRetry }: Props) {
  return (
    <div className="card banner" data-testid="mode-banner">
      <div className="row">
        <span className="status stale" data-testid="banner-scene">场景: {sceneName(data.scene)}</span>
        <span className="status stale" data-testid="banner-mode">
          模式: {modeName(data.mode)}{data.fallback ? '（自动兜底）' : ''}
        </span>
        {data.cold_recall && <span className="status stale" data-testid="banner-cold">已补查 Cold/dormant 层</span>}
        {data.hit_keywords.length > 0
          ? data.hit_keywords.map((k) => <span key={k} className="mid">#{k}</span>)
          : <span className="dim">无关键词命中（走 scene 默认）</span>}
        <span
          className="mid" style={{ cursor: 'pointer', textDecoration: 'underline' }}
          data-testid="banner-req" title="点击跳审计并定位该链路"
          onClick={() => onRequestId(data.request_id)}
        >{data.request_id}</span>
      </div>
      {data.secondary_mode_hint && (
        <details className="row" data-testid="secondary-hint">
          <summary style={{ cursor: 'pointer', fontSize: 12 }}>次模式参考: {modeName(data.secondary_mode_hint.mode)}</summary>
          <span className="dim">{data.secondary_mode_hint.note}</span>
        </details>
      )}
      {data.evidence_thin && data.evidence_thin !== 'none' && (
        <div className="status hibernating" data-testid="evidence-thin" style={{ display: 'block', marginTop: 8 }}>
          {data.evidence_thin === 'backfill_hit'
            ? '证据不足：已追加 1 条 Cold 摘要作辅助参考。建议切事实优先模式重试。'
            : '无可靠记忆证据，建议升级模式或人工确认。'}
          {' '}
          <button type="button" className="btn" data-testid="fact-retry" onClick={onFactRetry}>切事实优先重试</button>
        </div>
      )}
    </div>
  );
}
