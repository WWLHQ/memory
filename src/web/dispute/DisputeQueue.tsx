// P7-T3 冲突裁决队列组件（批次53-R 重做：截图目标版式 = 密集表格，非卡片堆）
// ul>li 网格行保留（DisputePage.test 断言 closest('li') 与行 overdue 类）；行内仍含 old/new 内容文本。
// 列：conflict_id | 类型 | old_id → new_id | old 置信度 | new 置信度 | 等待 | 操作。
import type { ConflictRecord } from './types.ts';
import { isOverdue, overdueDays, typeLabel } from './logic.ts';

interface Props {
  list: ConflictRecord[];
  now?: number;
  onSelect: (id: string) => void;
  selectedId?: string;
}

/** 等待时长人话化：<48h 显示 xh，否则 xd */
function waitText(createdAt: string, now: number): string {
  const ms = Math.max(0, now - new Date(createdAt).getTime());
  const h = Math.floor(ms / 3600000);
  if (h < 48) return `${Math.max(1, h)}h`;
  return `${Math.floor(h / 24)}d`;
}

const clip = (s: string, n = 22): string => (s.length > n ? `${s.slice(0, n)}…` : s);

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
      <li className="q-head" aria-hidden="true">
        <span>conflict_id</span>
        <span>类型</span>
        <span>mem_id</span>
        <span className="num">old 置信度</span>
        <span className="num">new 置信度</span>
        <span>等待</span>
        <span>操作</span>
      </li>
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
            <span className="mid" data-testid={`q-id-${i}`} title={r.id}>{clip(r.id)}</span>
            <span className={`ctype ${r.conflict_type ?? 'unknown'}`} data-testid={`q-ctype-${i}`} title={r.conflict_type ? undefined : '内核无检测引擎，类型未采样'}>
              {r.conflict_type ? typeLabel(r.conflict_type) : '未检测'}
            </span>
            <span className="mem" data-testid={`q-old-${i}`}>
              <span className="mid" title={r.old_id}>{clip(r.old_id)}</span>
              <i>→</i>
              <span className="mid" data-testid={`q-new-${i}`} title={r.new_id}>{clip(r.new_id)}</span>
              <em>{r.old_content}</em>
            </span>
            <span className="num">{r.old_confidence}</span>
            <span className="num">{r.new_confidence}</span>
            <span className="wait">
              {waitText(r.created_at, now)}
              {overdue && <b className="af-badge bad" data-testid={`q-overdue-${i}`}>超期 {od}d</b>}
            </span>
            <span className="act">
              <button type="button" className="q-go" onClick={(e) => { e.stopPropagation(); onSelect(r.id); }}>裁决</button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
