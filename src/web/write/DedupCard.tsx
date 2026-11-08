// 写入页（REQ-006 / P2）查重预览卡（T4）
// 批次25 P0-3：一条真实词面分 + 内核阈值对照；移除五条假刻度与点了不生效的原型按钮。
// 阶段5-E / B10（C 类·诚实重标注）：内核写路径只产出 new / grafted / duplicated / filtered
// 四种由内核自动裁决的结果，从来没有用户可选的「合并/覆盖/保留」模式。旧 note 把三模式
// 写成待办式功能缺口，实为规格与实现的设计边界，现如实写清。
import type { DedupResult } from './types.ts';

export function DedupCard({ result }: { result: DedupResult }) {
  const { score, layer, threshold, is_duplicate, matched } = result;
  const pct = `${Math.round(score * 100)}%`;

  return (
    <div className={`card dedup${is_duplicate ? ' dup' : ''}`} data-testid="dedup-card">
      <div className="p0-hd">
        <h3>查重预览 · Jaccard</h3>
        <span className={`p0-tag ${is_duplicate ? 'warn' : 'info'}`} data-testid="dedup-guess">
          {is_duplicate ? '预判 graft（内核会嫁接）' : '预判 create'}
        </span>
      </div>
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
        内核写路径只有四种真实结果：新建（new）、分支嫁接（grafted）、重复保留（duplicated）、
        质量门拦截（filtered），全部由内核自动裁决；不存在用户可选的「合并/覆盖/保留」模式，
        因此本卡不提供这类按钮。
      </div>
    </div>
  );
}
