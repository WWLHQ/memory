// REQ-012 T5 预算面板（§5/R9）：三档变色 + 漏斗 + 重排闸门 + 裁剪明细
import type { BudgetData } from './types.ts';
import { budgetLevel } from './logic.ts';

const LEVEL_LABEL = { ok: '正常', trim: '已裁剪', warn: '告警', breach: '硬熔断' } as const;

export function BudgetPanel({ data }: { data: BudgetData }) {
  const level = budgetLevel(data.payload_tokens);
  const pct = Math.min(100, Math.round((data.payload_tokens / 3000) * 100));
  return (
    <div className="card" data-testid="budget-panel">
      <div className="row-head">
        <b>预算面板（R9）</b>
        <span className={`status ${level === 'breach' ? 'deprecated' : level === 'warn' ? 'hibernating' : 'active'}`} data-testid="budget-level">
          {LEVEL_LABEL[level]}
        </span>
      </div>
      <div className="row">
        <span style={{ fontSize: 12, minWidth: 110 }}>payload_tokens</span>
        <div className="bar b3"><div className={`lv-${level}`} style={{ width: `${pct}%` }} data-testid="budget-bar" /></div>
        <span className="mid">{data.payload_tokens} / 3000</span>
      </div>
      <div className="row">
        <span style={{ fontSize: 12, minWidth: 110 }}>pipeline_llm</span>
        <div className="bar b3"><div style={{ width: `${Math.min(100, (data.pipeline_llm_tokens / 3000) * 100)}%` }} /></div>
        <span className="mid">{data.pipeline_llm_tokens}</span>
      </div>
      <div className="row" data-testid="funnel">
        <span style={{ fontSize: 12 }}>漏斗：stage1 {data.stage1_count} → stage2 {data.stage2_count}</span>
        <span className="dim">重排闸门：{data.rerank_applied ? '开' : '关'}{data.rerank_fallback ? '（失败回退第二层 · rerank_fallback）' : ''}</span>
      </div>
      {data.budget_breach && (
        <div className="note" data-testid="breach-detail">
          以下内容已超支被裁，未进上下文：{data.breach_detail?.join('；')}
        </div>
      )}
    </div>
  );
}
