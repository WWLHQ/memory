// 审计日志页（REQ-006 / P11）审计列表（T4）
// 行全量字段（4.3）+ 点 request_id 展开同链路全行（18.2-E）+ 跳检索页占位。
// 批次24：固定表头 + 可拖拽列宽（固化到 localStorage，重登/刷新后保持）；分页由父组件持有，行序号用全局下标。
import type { AuditEntry } from './types.ts';
import { actionLabel } from './logic.ts';
import { ColResizeHandle, useColWidths } from '../shared/useColWidths.tsx';
import '../shared/tableResize.css';

/** 9 列默认宽度（px）；固化键 auditColWidths */
const AUDIT_COL_DEFAULTS = [150, 104, 150, 130, 176, 78, 96, 150, 56] as const;
const AUDIT_COL_KEY = 'auditColWidths';
const AUDIT_COL_LABELS = ['时间', '动作', '资源', '状态变更', 'request_id（链路）', 'payload', 'pipeline_llm', '操作者', ''];

export interface AuditTableProps {
  /** 当前页要渲染的审计行（分页在父组件完成） */
  entries: AuditEntry[];
  activeRequestId?: string | null;
  onToggleChain: (requestId: string) => void;
  /** 首页偏移：翻页后行 testid 不串位 */
  indexOffset?: number;
}

export function AuditTable({ entries, activeRequestId, onToggleChain, indexOffset = 0 }: AuditTableProps) {
  const { widths, startResize, reset, isDefault } = useColWidths(AUDIT_COL_KEY, AUDIT_COL_DEFAULTS);
  return (
    <div>
      <div className="col-hint">
        <span>拖表头右侧把手调列宽，调整后自动固化（刷新、重新登录都保持）。</span>
        {!isDefault && (
          <button type="button" className="btn" data-testid="audit-col-reset" onClick={reset}>恢复默认列宽</button>
        )}
      </div>
      <div className="tbl-scroll">
        <table className="atable col-fixed" data-testid="audit-table">
          <thead>
            <tr>
              {AUDIT_COL_LABELS.map((h, i) => (
                <th key={i} style={{ width: widths[i] }} data-testid={`audit-th-${i}`} data-w={widths[i]}>
                  {h}
                  <ColResizeHandle col={i} onCol={startResize} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr><td colSpan={AUDIT_COL_LABELS.length} className="dim" style={{ textAlign: 'center' }}>无匹配审计记录</td></tr>
            ) : (
              entries.map((e, n) => {
                const i = indexOffset + n;
                return (
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
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
