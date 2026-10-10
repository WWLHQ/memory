// 审计日志页（REQ-006 / P11）审计列表（T4）
// 行全量字段（4.3）+ 点 request_id 展开同链路全行（18.2-E）+ 跳检索页占位。
import type { AuditEntry } from './types.ts';
import { actionLabel } from './logic.ts';

export function AuditTable({
  entries,
  activeRequestId,
  onToggleChain,
}: {
  entries: AuditEntry[];
  activeRequestId?: string | null;
  onToggleChain: (requestId: string) => void;
}) {
  return (
    <table className="atable" data-testid="audit-table">
      <thead>
        <tr>
          <th>时间</th>
          <th>动作</th>
          <th>资源</th>
          <th>状态变更</th>
          <th>request_id（链路）</th>
          <th>payload</th>
          <th>pipeline_llm</th>
          <th>操作者</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {entries.length === 0 ? (
          <tr><td colSpan={9} className="dim" style={{ textAlign: 'center' }}>无匹配审计记录</td></tr>
        ) : (
          entries.map((e, i) => (
            <tr
              key={`${e.request_id}-${i}`}
              className={activeRequestId && e.request_id === activeRequestId ? 'chain' : ''}
              data-testid={`row-${e.request_id}-${i}`}
            >
              <td className="dim">{new Date(e.created_at).toLocaleString('zh-CN')}</td>
              <td>{actionLabel(e.action)}</td>
              <td>
                {e.resource_type}/{e.resource_id}
                {e.evidence_thin && <span className="ev" data-testid="ev-thin"> · 证据不足</span>}
              </td>
              <td className="dim">
                {e.old_status && e.new_status ? `${e.old_status}→${e.new_status}` : '—'}
                {e.old_id && e.new_id ? ` (${e.old_id}→${e.new_id})` : ''}
              </td>
              <td>
                <span
                  className={`rid${activeRequestId === e.request_id ? ' active' : ''}`}
                  data-testid={`rid-${e.request_id}-${i}`}
                  onClick={() => onToggleChain(e.request_id)}
                >
                  {e.request_id}
                </span>
              </td>
              <td>{e.payload_tokens}</td>
              <td>{e.pipeline_llm_tokens}</td>
              <td className="dim">{e.user_id}@{e.ip_address}</td>
              <td>
                <a href="/overview.html" data-testid={`jump-${e.request_id}-${i}`} title="跳检索页上下文（占位）">↗</a>
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
