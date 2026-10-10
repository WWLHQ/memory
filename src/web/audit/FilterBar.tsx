// 审计日志页（REQ-006 / P11）过滤栏（T3）
// 字段对照 §P11：enterprise_id/user_id/ip/device/action/request_id/created_at 区间。
import type { AuditAction, AuditFilter } from './types.ts';
import { ACTION_LABEL } from './logic.ts';

const ACTIONS: AuditAction[] = [
  'recall', 'write', 'verify', 'dispute', 'archive', 'ban', 'merge',
  'recall_skip', 'recall_breach', 'rerank_on', 'rerank_fallback', 'cold_recall',
  'mode_dispatch', 'mode_fallback', 'evidence_thin',
];

export function FilterBar({
  filter,
  onChange,
  onQuery,
  onReset,
}: {
  filter: AuditFilter;
  onChange: (f: AuditFilter) => void;
  onQuery: () => void;
  onReset: () => void;
}) {
  const set = (patch: Partial<AuditFilter>) => onChange({ ...filter, ...patch });

  return (
    <div className="card" data-testid="filter-bar">
      <div className="filter">
        <div className="f">
          <label>enterprise_id</label>
          <input data-testid="f-ent" value={filter.enterprise_id ?? ''} placeholder="租户隔离"
            onChange={(e) => set({ enterprise_id: e.target.value || undefined })} />
        </div>
        <div className="f">
          <label>user_id</label>
          <input data-testid="f-user" value={filter.user_id ?? ''}
            onChange={(e) => set({ user_id: e.target.value || undefined })} />
        </div>
        <div className="f">
          <label>ip_address</label>
          <input data-testid="f-ip" value={filter.ip_address ?? ''}
            onChange={(e) => set({ ip_address: e.target.value || undefined })} />
        </div>
        <div className="f">
          <label>device_info</label>
          <input data-testid="f-device" value={filter.device_info ?? ''}
            onChange={(e) => set({ device_info: e.target.value || undefined })} />
        </div>
        <div className="f">
          <label>action（4.3）</label>
          <select data-testid="f-action" value={filter.action ?? ''}
            onChange={(e) => set({ action: (e.target.value || undefined) as AuditFilter['action'] })}>
            <option value="">全部</option>
            {ACTIONS.map((a) => <option key={a} value={a}>{ACTION_LABEL[a]}</option>)}
          </select>
        </div>
        <div className="f">
          <label>request_id（链路）</label>
          <input data-testid="f-rid" value={filter.request_id ?? ''}
            onChange={(e) => set({ request_id: e.target.value || undefined })} />
        </div>
        <div className="f">
          <label>起</label>
          <input data-testid="f-from" type="datetime-local" value={filter.from ?? ''}
            onChange={(e) => set({ from: e.target.value || undefined })} />
        </div>
        <div className="f">
          <label>止</label>
          <input data-testid="f-to" type="datetime-local" value={filter.to ?? ''}
            onChange={(e) => set({ to: e.target.value || undefined })} />
        </div>
      </div>
      <div className="actions">
        <button type="button" className="btn primary" data-testid="query" onClick={onQuery}>查询</button>
        <button type="button" className="btn" data-testid="reset" onClick={onReset}>重置</button>
      </div>
    </div>
  );
}
