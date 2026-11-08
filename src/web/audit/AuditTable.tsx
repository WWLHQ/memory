// 审计日志页（REQ-006 / P11）审计列表（T4）· 定稿 9 列
// 时间 / 事件 / request_id / 对象 / 结果 / 会话主体 / 来源 / 耗时 / 备注
// 点 request_id 展开同链路全行（18.2-E）+ 备注列 ↗ 跳检索页真实链路上下文（阶段5-A 接真）。
// 固定表头 + 可拖拽列宽（固化到 localStorage，重登/刷新后保持）；分页由父组件持有，行序号用全局下标。
import type { AuditEntry } from './types.ts';
import { actionLabel } from './logic.ts';
import { retrievalContextHref } from './auditLink.ts';
import { ColResizeHandle, useColWidths } from '../shared/useColWidths.tsx';
import '../shared/tableResize.css';

/** 9 列默认宽度（px）；固化键 auditColWidths */
const AUDIT_COL_DEFAULTS = [80, 70, 118, 58, 50, 76, 60, 46, 76] as const;
const AUDIT_COL_KEY = 'auditColWidths';
const AUDIT_COL_LABELS = ['时间', '事件', 'request_id', '对象', '结果', '会话主体', '来源', '耗时', '备注'];

export interface AuditTableProps {
  /** 当前页要渲染的审计行（分页在父组件完成） */
  entries: AuditEntry[];
  activeRequestId?: string | null;
  onToggleChain: (requestId: string) => void;
  /** 首页偏移：翻页后行 testid 不串位 */
  indexOffset?: number;
}

/** 结果语义色：拒绝/失败=err，阻止/跳过=warn，其余=ok；缺失不染色 */
function resultTone(result?: string): string {
  if (!result) return '';
  if (/拒绝|denied|deny|fail|error|401|403/i.test(result)) return 'err';
  if (/阻止|blocked|skip|跳过|warn/i.test(result)) return 'warn';
  return 'ok';
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
        <table className="atable col-fixed p0-table" data-testid="audit-table">
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
              <tr><td colSpan={AUDIT_COL_LABELS.length} className="p0-empty">无匹配审计记录</td></tr>
            ) : (
              entries.map((e, n) => {
                const i = indexOffset + n;
                const label = actionLabel(e.action);
                const note = e.note
                  || (e.old_status && e.new_status ? `${e.old_status}→${e.new_status}` : '')
                  || (e.old_id && e.new_id ? `${e.old_id}→${e.new_id}` : '');
                return (
                  <tr
                    key={`${e.request_id}-${i}`}
                    className={activeRequestId && e.request_id === activeRequestId ? 'chain' : ''}
                    data-testid={`row-${e.request_id}-${i}`}
                  >
                    <td className="dim mono">
                      {new Date(e.created_at).toLocaleTimeString('zh-CN', { hour12: false })}
                      <div className="p0-note" style={{ margin: 0 }}>
                        {new Date(e.created_at).toLocaleDateString('zh-CN')}
                      </div>
                    </td>
                    <td>
                      <div className="ev-name" title={label}>{label}</div>
                      {label !== e.action && <div className="act-raw p0-note mono" title={e.action}>{e.action}</div>}
                    </td>
                    <td>
                      <span
                        className={`rid mono${activeRequestId === e.request_id ? ' active' : ''}`}
                        data-testid={`rid-${e.request_id}-${i}`}
                        title="展开该 request_id 的链路视图"
                        onClick={() => onToggleChain(e.request_id)}
                      >
                        {e.request_id}
                      </span>
                    </td>
                    <td>
                      <span>{e.resource_type}/{e.resource_id}</span>
                      {e.evidence_thin && <span className="ev" data-testid="ev-thin"> · 证据不足</span>}
                    </td>
                    <td>{e.result ? <span className={`p0-tag ${resultTone(e.result)}`}>{e.result}</span> : <span className="dim">—</span>}</td>
                    <td>
                      <span>{e.user_id}@{e.ip_address}</span>
                      {e.agent && <div className="p0-note">agent: {e.agent}</div>}
                    </td>
                    <td className="dim src" title={e.source ?? undefined}>{e.source ?? '无'}</td>
                    <td className="num">{e.duration_ms !== undefined ? `${e.duration_ms} ms` : '未取数'}</td>
                    <td>
                      <span className="dim" title={note || undefined}>{note || '无'}</span>
                      <a
                        href={retrievalContextHref(e.request_id)}
                        data-testid={`jump-${e.request_id}-${i}`}
                        title="跳检索页查看该 request_id 的真实审计链路上下文"
                        style={{ marginLeft: 6 }}
                      >↗</a>
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
