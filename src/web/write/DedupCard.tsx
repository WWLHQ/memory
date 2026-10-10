// 写入页（REQ-006 / P2）查重反馈卡（T4）
// 六维进度条（6.1）+ 综合分 vs 阈值 + is_duplicate + 合并/覆盖/保留三模式（9.7）。
import type { DedupResult } from './types.ts';

type DedupAction = 'merge' | 'overwrite' | 'keep';

export function DedupCard({
  result,
  onAction,
}: {
  result: DedupResult;
  onAction: (a: DedupAction) => void;
}) {
  const { dims, composite, threshold, is_duplicate, matched } = result;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const rows: Array<[string, number]> = [
    ['semantic（35%）', dims.semantic],
    ['keyword（20%）', dims.keyword],
    ['entity（15%）', dims.entity],
    ['structure（10%）', dims.structure],
    ['llm_judge（20%）', dims.llm_judge],
  ];

  return (
    <div className={`card dedup${is_duplicate ? ' dup' : ''}`} data-testid="dedup-card">
      <b>查重反馈（6.1）</b>
      {rows.map(([k, v]) => (
        <div className="dimrow" key={k}>
          <div className="k"><span>{k}</span><span>{pct(v)}</span></div>
          <div className="bar"><i style={{ width: pct(v) }} /></div>
        </div>
      ))}
      <div className={`composite${is_duplicate ? ' dup' : ''}`} data-testid="composite">
        综合分 {composite.toFixed(2)} / 阈值 {threshold.toFixed(2)} {is_duplicate ? '· 命中重复' : '· 未命中'}
      </div>
      {matched && (
        <div className="preview">
          命中既有记忆 <a href="/memory.html" data-testid="matched-link">{matched.id}</a>（跳 P8 记忆管理）
        </div>
      )}
      <div className="actions">
        <button type="button" className="btn" data-testid="op-merge" onClick={() => onAction('merge')}>合并到既有</button>
        <button type="button" className="btn" data-testid="op-overwrite" onClick={() => onAction('overwrite')}>覆盖旧值</button>
        <button type="button" className="btn primary" data-testid="op-keep" onClick={() => onAction('keep')}>保留两条</button>
      </div>
    </div>
  );
}
