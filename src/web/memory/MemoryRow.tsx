// 记忆管理页（REQ-006 / P8）单行（T3）
import type { ReactNode } from 'react';
import type { MemoryRecord } from './types.ts';
import { decayClass, summarizeContent } from './logic.ts';
import { fmtLayerGen } from '../shared/layerTime.ts';

function Pct({ v, warn, err }: { v: number; warn?: boolean; err?: boolean }) {
  const pct = Math.round(Math.max(0, Math.min(1, v)) * 100);
  return (
    <span className={`pct${err ? ' err' : warn ? ' warn' : ''}`} title={`${pct}%`}>
      {pct}%
    </span>
  );
}

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('zh-CN');
  } catch {
    return iso;
  }
}

export function MemoryRow({
  rec,
  selected,
  onSelect,
  colWidths,
  children,
}: {
  rec: MemoryRecord;
  selected: boolean;
  onSelect?: (r: MemoryRecord) => void;
  colWidths?: number[];
  children?: ReactNode;
}) {
  const temp = decayClass(rec);
  const content = summarizeContent(rec);
  return (
    <tr
      className={rec.pinned ? 'pinned' : ''}
      data-testid={`row-${rec.id}`}
      onClick={() => onSelect?.(rec)}
      style={selected ? { outline: '2px solid var(--accent)' } : undefined}
    >
      <td className="mid" style={colWidths ? { width: colWidths[0], minWidth: colWidths[0] } : undefined}>{rec.id}</td>
      <td className="content" title={content} style={{ cursor: content.length > 60 ? 'help' : 'default', ...((colWidths?.[1] ? { width: colWidths[1], minWidth: colWidths[1] } : {})) }}>
        {content}
      </td>
      <td style={colWidths ? { width: colWidths[2], minWidth: colWidths[2] } : undefined}><span className="pill">{rec.type}</span></td>
      <td style={colWidths ? { width: colWidths[3], minWidth: colWidths[3] } : undefined} className="tags">
        {rec.tags.length === 0 ? <span className="dim">—</span> : rec.tags.map((t) => (
          <span className="pill" key={t}>{t}</span>
        ))}
      </td>
      <td style={colWidths ? { width: colWidths[4], minWidth: colWidths[4] } : undefined}><Pct v={rec.importance} /></td>
      <td style={colWidths ? { width: colWidths[5], minWidth: colWidths[5] } : undefined}><Pct v={rec.confidence} /></td>
      <td style={colWidths ? { width: colWidths[6], minWidth: colWidths[6] } : undefined}>{rec.access_count} / {rec.reinforce_count}</td>
      <td style={colWidths ? { width: colWidths[7], minWidth: colWidths[7] } : undefined}>
        {rec.pinned && <span className="icon pinned" title="已置顶">📌</span>}
        {rec.locked && <span className="icon locked" title="已锁定">🔒</span>}
        {rec.archived && <span className="icon archived" title="已归档">🗄️</span>}
      </td>
      <td style={colWidths ? { width: colWidths[8], minWidth: colWidths[8] } : undefined}><span className={`temp ${temp}`}>{temp}</span></td>
      <td style={colWidths ? { width: colWidths[9], minWidth: colWidths[9] } : undefined}><span className="status">{rec.status}</span></td>
      <td style={colWidths ? { width: colWidths[10], minWidth: colWidths[10] } : undefined}>
        {rec.merged_from && rec.merged_from.length > 0
          ? `合并自 ${rec.merged_from.length} 条`
          : '未取数'}
      </td>
      <td style={colWidths ? { width: colWidths[11], minWidth: colWidths[11] } : undefined}>
        <div className="dim">{fmt(rec.created_at)}</div>
        <div className="dim">↻ {fmt(rec.updated_at)}</div>
        <div className="dim" data-testid={`row-layer-gen-${rec.id}`}>{fmtLayerGen(rec.layers_generated_at, 'date')}</div>
      </td>
      {children !== undefined && <td className="actions" style={colWidths?.[12] ? { width: colWidths[12], minWidth: colWidths[12] } : undefined}>{children}</td>}
    </tr>
  );
}
