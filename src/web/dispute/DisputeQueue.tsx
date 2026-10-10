// P7-T3 冲突裁决队列组件
// 展示 dispute_flag=true 的冲突，超期>7d 高亮（12.1），旧/新对比 + 类型徽章（9.7）。
import type { ConflictRecord } from './types.ts';
import { isOverdue, overdueDays, typeLabel } from './logic.ts';

interface Props {
  list: ConflictRecord[];
  now?: number;
  onSelect: (id: string) => void;
  selectedId?: string;
}

export function DisputeQueue({ list, now = Date.now(), onSelect, selectedId }: Props) {
  if (list.length === 0) {
    return (
      <div className="queue empty" data-testid="queue-empty">
        暂无待裁决冲突
      </div>
    );
  }
  return (
    <ul className="queue" data-testid="queue">
      {list.map((r, i) => {
        const od = overdueDays(r.created_at, now);
        const overdue = isOverdue(r, now);
        const cls = ['item', overdue ? 'overdue' : '', selectedId === r.id ? 'selected' : ''].filter(Boolean).join(' ');
        return (
          <li
            key={r.id}
            className={cls}
            data-testid={`queue-item-${i}`}
            onClick={() => onSelect(r.id)}
          >
            <div className="row-head">
              <span className={`ctype ${r.conflict_type}`} data-testid={`q-ctype-${i}`}>{typeLabel(r.conflict_type)}</span>
              <span className="score">conflict {r.conflict_score}</span>
              {overdue && <span className="badge overdue-badge">超期 {od}d</span>}
            </div>
            <div className="compare">
              <div className="side old" data-testid={`q-old-${i}`}>
                <span className="meta">{r.old_id} · {r.old_confidence}</span>
                {r.old_content}
              </div>
              <div className="side new" data-testid={`q-new-${i}`}>
                <span className="meta">{r.new_id} · {r.new_confidence}</span>
                {r.new_content}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
