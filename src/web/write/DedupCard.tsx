// 写入页（REQ-006 / P2）查重预览卡 · 批次58 定稿版式
// 一条真实词面分 + 内核阈值对照；note 保留阶段5-E 诚实契约（四种真实结果/内核裁决/四维）。
import type { DedupResult } from './types.ts';

export function DedupCard({ result }: { result: DedupResult }) {
  const { score, layer, threshold, is_duplicate, matched } = result;
  const pct = `${Math.round(score * 100)}%`;

  return (
    <div className={`wf-card wf-dedup${is_duplicate ? ' hit' : ''}`} data-testid="dedup-card">
      <div className="wf-hd">
        <span className="wf-code">DEDUP</span><span className="wf-zh">查重预览</span>
        <span className="wf-meta">本地词面相似度</span>
      </div>
      <div className="wf-bd">
        <div className="wf-simrow">
          <span>相似度</span>
          <span className="wf-v">
            <span data-testid="dedup-score">{score.toFixed(2)}</span> · {is_duplicate ? '高于阈值' : '低于阈值'}
          </span>
        </div>
        <div className="wf-bar"><i data-testid="dedup-bar" style={{ width: pct }} /></div>
        <div className="wf-verdict" data-testid="dedup-verdict">
          词面 {score.toFixed(2)} / 阈值 {threshold.toFixed(2)}（{layer}）· {is_duplicate ? '预览提示可能重复' : '预览未见重复'}
        </div>
        {matched && (
          <div className="wf-near">
            <span>最接近</span>
            <a className="wf-chip" href="/memory.html" data-testid="matched-link">{matched.id} →</a>
          </div>
        )}
        <div className="wf-note" data-testid="dedup-note">
          {is_duplicate ? `高于阈值 ${threshold.toFixed(2)} · 本次将走嫁接 graft 而非新建 · ` : `低于阈值 ${threshold.toFixed(2)} · `}
          判重由内核写路径真实执行，此处仅预览。内核写路径只有四种真实结果：新建（new）、分支嫁接（grafted）、重复保留（duplicated）、
          质量门拦截（filtered），全部由内核自动裁决；不存在用户可选的「合并/覆盖/保留」模式。
          真正判重由内核在提交时按四维（语义/关键词/实体/结构）对照同一阈值执行，未接入大模型时只查 L1。
        </div>
      </div>
    </div>
  );
}