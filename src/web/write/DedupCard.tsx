// 写入页（REQ-006 / P2）查重预览卡（T4）
// 批次25 P0-3：一条真实词面分 + 内核阈值对照。
// 不再画五条假刻度（全是同一个 Jaccard 的仿射变换，还带未接大模型却展示的 llm_judge），
// 也不再留点了不生效的「合并/覆盖/保留」按钮（内核写路径不接受该选项）。
import type { DedupResult } from './types.ts';

export function DedupCard({ result }: { result: DedupResult }) {
  const { score, layer, threshold, is_duplicate, matched } = result;
  const pct = `${Math.round(score * 100)}%`;

  return (
    <div className={`card dedup${is_duplicate ? ' dup' : ''}`} data-testid="dedup-card">
      <b>查重预览（本地词面）</b>
      <div className="dimrow">
        <div className="k">
          <span>词面相似度（分词重合度，本机实算）</span>
          <span data-testid="dedup-score">{score.toFixed(2)}</span>
        </div>
        <div className="bar"><i data-testid="dedup-bar" style={{ width: pct }} /></div>
      </div>
      <div className={`verdict${is_duplicate ? ' dup' : ''}`} data-testid="dedup-verdict">
        词面 {score.toFixed(2)} / 阈值 {threshold.toFixed(2)}（{layer}）· {is_duplicate ? '预览提示可能重复' : '预览未见重复'}
      </div>
      {matched && (
        <div className="preview">
          最接近的既有记忆 <a href="/memory.html" data-testid="matched-link">{matched.id}</a>（跳 P8 记忆管理）
        </div>
      )}
      <div className="note" data-testid="dedup-note">
        本卡只是输入过程中的词面预览，不是入库判定：真正是否重复由内核在点「写入」时按四维
        （语义/关键词/实体/结构，§6.1）对照同一阈值判定，未接入大模型时只查 L1。
        §9.7 的合并/覆盖/保留三模式尚未接入写路径，因此不提供按钮。
      </div>
    </div>
  );
}
