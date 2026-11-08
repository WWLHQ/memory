// REQ-012 T5 预算面板（定稿）：场景预算 / 实际注入 / 丢弃条数 + R9 三档 + 漏斗与重排闸门
import type { BudgetData } from './types.ts';
import { budgetLevel } from './logic.ts';

const LEVEL_LABEL = { ok: '正常', trim: '已裁剪', warn: '告警', breach: '硬熔断' } as const;

export function BudgetPanel({ data }: { data: BudgetData }) {
  const level = budgetLevel(data.payload_tokens);
  const cap = data.budget_tokens && data.budget_tokens > 0 ? data.budget_tokens : 3000;
  const pct = Math.min(100, Math.round((data.payload_tokens / 3000) * 100));
  const injectPct = Math.min(100, Math.round(((data.injected_tokens ?? data.payload_tokens) / cap) * 100));
  return (
    <div className="p0-card" data-testid="budget-panel">
      <div className="p0-hd">
        <h3>预算面板（R9）</h3>
        <span className={`p0-tag ${level === 'breach' || level === 'warn' ? 'err' : level === 'trim' ? 'warn' : 'ok'}`} data-testid="budget-level">
          {LEVEL_LABEL[level]}
        </span>
      </div>

      <div className="p0-kv">
        <span className="p0-k">查询预算</span>
        <span className="p0-v mono">{data.budget_tokens !== undefined ? `${data.budget_tokens} t` : '按场景（未显式设）'}</span>
        <span className="p0-k">实际注入</span>
        <span className="p0-v mono">
          {data.injected_tokens ?? data.payload_tokens} t{data.injected_count !== undefined ? ` · ${data.injected_count} 条` : ''}
        </span>
        <span className="p0-k">预算丢弃</span>
        <span className="p0-v mono">{data.dropped_count !== undefined ? `${data.dropped_count} 条` : '未取数'}</span>
        <span className="p0-k">payload_tokens</span>
        <span className="p0-v mono">{data.payload_tokens} / 3000</span>
        <span className="p0-k">pipeline_llm</span>
        <span className="p0-v mono">{data.pipeline_llm_tokens}</span>
      </div>

      <div className="p0-meter">
        <i className={`lv-${level}`} style={{ width: `${pct}%` }} data-testid="budget-bar" />
      </div>
      <div className="p0-meter" title="注入占本次预算">
        <i className={injectPct >= 100 ? 'warn' : ''} style={{ width: `${injectPct}%` }} />
      </div>

      <div className="p0-note" data-testid="funnel">
        漏斗：stage1 {data.stage1_count} → stage2 {data.stage2_count} · 重排闸门：{data.rerank_applied ? '开' : '关'}
        {data.rerank_fallback ? '（失败回退第二层 · rerank_fallback）' : ''}
        {data.depth ? ` · 深度 ${data.depth}` : ''}
      </div>
      {data.budget_breach && (
        <div className="p0-note" data-testid="breach-detail">
          以下内容已超支被裁，未进上下文：{data.breach_detail?.join('；') ?? '（内核未给出明细）'}
        </div>
      )}
    </div>
  );
}
