// 审计过滤栏（T3）· 定稿 5 维：动作 / 起止时间 / request_id / Agent
// 查询时由 AuditPage 下推真实 storage.queryAudit（不是前端假筛）。
import { ACTION_LABEL } from './logic.ts';
import type { AuditAction, AuditFilter } from './types.ts';

export function FilterBar({ filter, onChange, onQuery, onReset }: {
  filter: AuditFilter;
  onChange: (f: AuditFilter) => void;
  onQuery: () => void;
  onReset: () => void;
}) {
  const actions = Object.entries(ACTION_LABEL) as [AuditAction, string][];
  return (
    <div className="p0-card" data-testid="filter-bar">
      <div className="p0-hd">
        <h3>筛选</h3>
        <span className="p0-sub">动作 / 时间 / request_id / Agent · 查询经内核 queryAudit</span>
      </div>
      <div className="p0-filter">
        <div className="p0-frow">
          <label htmlFor="f-action">动作</label>
          <select id="f-action" className="p0-in" data-testid="f-action"
            value={filter.action ?? ''}
            onChange={(e) => onChange({ ...filter, action: e.target.value as AuditAction | '' })}>
            <option value="">全部动作</option>
            {actions.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="p0-frow">
          <label htmlFor="f-from">起（含）</label>
          <input id="f-from" className="p0-in" data-testid="f-from" type="datetime-local"
            value={filter.from ?? ''}
            onChange={(e) => onChange({ ...filter, from: e.target.value })} />
        </div>
        <div className="p0-frow">
          <label htmlFor="f-to">止（含）</label>
          <input id="f-to" className="p0-in" data-testid="f-to" type="datetime-local"
            value={filter.to ?? ''}
            onChange={(e) => onChange({ ...filter, to: e.target.value })} />
        </div>
        <div className="p0-frow">
          <label htmlFor="f-rid">request_id</label>
          <input id="f-rid" className="p0-in" data-testid="f-rid" placeholder="精确匹配"
            value={filter.request_id ?? ''}
            onChange={(e) => onChange({ ...filter, request_id: e.target.value })} />
        </div>
        <div className="p0-frow">
          <label htmlFor="f-agent">Agent</label>
          <input id="f-agent" className="p0-in" data-testid="f-agent" placeholder="宿主 Agent 精确匹配"
            value={filter.agent ?? ''}
            onChange={(e) => onChange({ ...filter, agent: e.target.value })} />
        </div>
      </div>
      <div className="p0-row-actions">
        <button type="button" className="p0-btn primary" data-testid="query" onClick={onQuery}>查询</button>
        <button type="button" className="p0-btn" data-testid="reset" onClick={onReset}>重置</button>
      </div>
    </div>
  );
}
