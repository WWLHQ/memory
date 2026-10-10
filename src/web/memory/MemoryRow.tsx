// 记忆管理页（REQ-006 / P8）单行（T3）
import type { ReactNode } from 'react';
import type { MemoryRecord } from './types.ts';
import { decayClass, summarizeContent } from './logic.ts';

function Bar({ v, warn, err }: { v: number; warn?: boolean; err?: boolean }) {
  const pct = Math.round(Math.max(0, Math.min(1, v)) * 100);
  const cls = err ? 'bar err' : warn ? 'bar warn' : 'bar';
  return (
    <span className={cls} title={`${pct}%`}>
      <i style={{ width: `${pct}%` }} />
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
  children,
}: {
  rec: MemoryRecord;
  selected: boolean;
  onSelect?: (r: MemoryRecord) => void;
  children?: ReactNode;
}) {
  const temp = decayClass(rec);
  return (
    <tr
      className={rec.pinned ? 'pinned' : ''}
      data-testid={`row-${rec.id}`}
      onClick={() => onSelect?.(rec)}
      style={selected ? { outline: '2px solid var(--accent)' } : undefined}
    >
      <td className="mid">{rec.id}</td>
      <td className="content">{summarizeContent(rec)}</td>
      <td><span className="pill">{rec.type}</span></td>
      <td className="tags">
        {rec.tags.length === 0 ? <span className="dim">—</span> : rec.tags.map((t) => (
          <span className="pill" key={t}>{t}</span>
        ))}
      </td>
      <td><Bar v={rec.importance} /></td>
      <td><Bar v={rec.confidence} /></td>
      <td>{rec.access_count} / {rec.reinforce_count}</td>
      <td>
        {rec.pinned && <span className="icon pinned" title="已置顶">📌</span>}
        {rec.locked && <span className="icon locked" title="已锁定">🔒</span>}
        {rec.archived && <span className="icon archived" title="已归档">🗄️</span>}
      </td>
      <td><span className={`temp ${temp}`}>{temp}</span></td>
      <td><span className="status">{rec.status}</span></td>
      <td>
        {rec.merged_from && rec.merged_from.length > 0
          ? `合并自 ${rec.merged_from.length} 条`
          : '—'}
      </td>
      <td>
        <div className="dim">{fmt(rec.created_at)}</div>
        <div className="dim">↻ {fmt(rec.updated_at)}</div>
      </td>
      {children !== undefined && <td className="actions">{children}</td>}
    </tr>
  );
}
