// 写入页右栏「查重预览」面板（STRATUM 1:1 复刻 · 设计真源 stratum-a-full.html pg-write 右栏）：
// af-panel(af-ph h3 查重预览 + hint 本地词面相似度 · 判重由内核真执行) → af-pb af-stack gap 9：
// af-stat 词面相似度单值 + af-bar + 判读 note + 最接近记忆 pill + 内核裁决 note + 「查看净化生长 →」。
// 一条真实词面分 + 内核阈值对照；候选全部来自真实账本（空库即无候选），不做假刻度。
// 诚实化契约（批次25 P0-3）保留：四种内核结果自动裁决、四维判重口径、无「合并/覆盖/保留」按钮。
import { requestShellView } from '../shared/shellNavigate.ts';
import type { DedupResult } from './types.ts';

export function DedupCard({ result, hasContent = true }: { result: DedupResult; hasContent?: boolean }) {
  const { score, layer, threshold, is_duplicate, matched } = result;
  const pct = `${Math.round(score * 100)}%`;

  return (
    <section className={`af-panel${hasContent && is_duplicate ? ' af-hit' : ''}`} data-testid="dedup-card">
      <div className="af-ph">
        <h3>查重预览</h3>
        <span className="hint">本地词面相似度 · 判重由内核真执行</span>
      </div>
      <div className="af-pb af-stack" style={{ gap: 9 }}>
        {hasContent ? (
          <>
            <div className="af-stat" style={{ padding: 0 }}>
              <div className="k">词面相似度<span>阈值 {threshold.toFixed(2)} · {layer}</span></div>
              <div className="v" data-testid="dedup-score">{score.toFixed(2)}</div>
            </div>
            <div className="af-bar"><i data-testid="dedup-bar" style={{ width: pct }} /></div>
            <p className="af-note" data-testid="dedup-verdict">
              词面 {score.toFixed(2)} / 阈值 {threshold.toFixed(2)}（{layer}）· {is_duplicate ? '高于阈值 · 预览提示可能重复（走嫁接 graft）' : '低于阈值，预计不判重 · 预览未见重复'}
            </p>
            {matched && (
              <>
                <p className="af-note">最接近记忆：</p>
                <a className="af-pill" href="/memory.html" data-testid="matched-link">{matched.id} · {score.toFixed(2)}</a>
              </>
            )}
          </>
        ) : (
          <div className="af-empty" data-testid="dedup-empty">
            <b>等待输入</b>
            输入内容后按当前候选实算词面相似度（本地 Jaccard · 不经大模型）；候选全部来自真实账本。
          </div>
        )}
        <p className="af-note" data-testid="dedup-note">
          {hasContent
            ? (is_duplicate ? '高于阈值，预计判重 · ' : '低于阈值，预计不判重 · ')
            : ''}
          判重由内核写路径真实执行，此处仅预览。内核写路径只有四种真实结果：新建（new）、分支嫁接（grafted）、重复保留（duplicated）、
          质量门拦截（filtered），全部由内核自动裁决；不存在用户可选的「合并/覆盖/保留」模式。
          真正判重由内核在提交时按四维（语义/关键词/实体/结构）对照同一阈值执行，未接入大模型时只查 L1。
          五维查重与短路嫁接详情见「净化生长」页；此处不做假刻度。
        </p>
        <button type="button" className="af-btn sm" onClick={() => requestShellView('growth')}>
          查看净化生长 →
        </button>
      </div>
    </section>
  );
}
