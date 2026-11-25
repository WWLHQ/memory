// REQ-012 T5 生效横幅（§2）：一条蓝色场景带 —— 场景徽标 + 该场景的硬口径（重排/预算/纪律），
// 右侧挂生效模式、冷层补查与可回放的 request_id。所有口径取内核实值（resolveSceneBudget / dispatch）。
import type { ModeBannerData } from './types.ts';
import { modeName, resolveSceneBudget, sceneName } from './logic.ts';

interface Props {
  data: ModeBannerData;
  onRequestId: (id: string) => void;
  onFactRetry: () => void;
}

export function ModeBanner({ data, onRequestId, onFactRetry }: Props) {
  // A6：来源与「建议 vs 实际」全部读内核 dispatch，不在这里重新判断。
  // A9：自动极简观测档（applied='auto'）下与回显逐字同口径：主标签写「自动」，建议只出现在括号里。
  const observedAuto = data.dispatch?.applied === 'auto';
  const sourceTag = observedAuto
    ? ''
    : data.dispatch?.source === 'manual'
      ? '（用户指定）'
      : data.fallback
        ? '（自动分流）'
        : '';
  const notApplied = observedAuto && data.dispatch
    ? `（分流建议${modeName(data.dispatch.suggested)} · 本轮按默认口径执行）`
    : '';
  const shownMode = observedAuto ? '自动' : modeName(data.mode);
  const table = resolveSceneBudget(data.scene);
  const rerank = table.rerank === true ? '强制重排' : table.rerank === 'auto' ? '自动重排' : '不重排';

  return (
    <div className={`ret-scenebar scene-${data.scene}`} data-testid="mode-banner">
      <span className="ret-scene-badge" data-testid="banner-scene">{sceneName(data.scene)}</span>
      <span className="ret-scene-text">
        {rerank} · 前端注入上限 {table.budget} tokens（内核硬熔断另计）· 命中不足如实返回，不编造
      </span>

      <span className="ret-scene-right">
        <span className="ret-tag mode" data-testid="banner-mode">
          模式: {shownMode}{sourceTag}{notApplied}
        </span>
        {data.cold_recall && <span className="ret-tag cold" data-testid="banner-cold">已补查冷层</span>}
        {data.hit_keywords.map((k) => <span key={k} className="ret-tag kw">#{k}</span>)}
        <button
          type="button"
          className="ret-req"
          data-testid="banner-req"
          title="点击跳审计并定位该链路"
          onClick={() => onRequestId(data.request_id)}
        >
          {data.request_id}
        </button>
      </span>

      {data.secondary_mode_hint && (
        <details className="ret-secondary" data-testid="secondary-hint">
          <summary>次模式参考: {modeName(data.secondary_mode_hint.mode)}</summary>
          <span className="ret-note">{data.secondary_mode_hint.note}</span>
          {data.secondary_mode_hint.content && (
            <div className="ret-note" data-testid="secondary-content">{data.secondary_mode_hint.content}</div>
          )}
        </details>
      )}

      {data.evidence_thin && data.evidence_thin !== 'none' && (
        <div className="ret-warnbar evidence" data-testid="evidence-thin">
          {data.evidence_thin === 'backfill_hit'
            ? '证据不足：已追加 1 条冷层摘要作辅助参考。建议切事实优先模式重试。'
            : '无可信记忆证据，建议升级模式或人工确认。'}
          {' '}
          <button type="button" className="ret-btn" data-testid="fact-retry" onClick={onFactRetry}>切事实优先重试</button>
        </div>
      )}
    </div>
  );
}
