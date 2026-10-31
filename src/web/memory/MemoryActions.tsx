// 记忆管理页（REQ-006 / P8）操作区（T4）
// 图标化按钮分 2 行 × 4 列（grid），列宽受限无需横向拖动条即可全部显示，hover 显示 title 说明。
// 17.3 推荐文案在 MemoryPage 以 toast 呈现；本组件负责渲染按钮 + locked 约束（G4）。
// 「📂 打开」：直接打开该记忆文件（主进程导出独立 .json + OS 默认查看器），非抽屉。
import type { MemoryOp, MemoryRecord } from './types.ts';

export function MemoryActions({
  rec,
  onAction,
  onOpenFile,
}: {
  rec: MemoryRecord;
  onAction: (op: MemoryOp) => void;
  /** 打开该记忆文件（导出 .json + OS 默认查看器/编辑器）；缺省 no-op */
  onOpenFile?: (rec: MemoryRecord) => void;
}) {
  // locked 记忆：仅「解锁」可点，其余禁用（G4）；「打开文件」始终可点（只读查看）
  const disabled = rec.locked;
  const btnStyle = {
    padding: '2px 4px', fontSize: 13, lineHeight: 1.3, width: '100%', textAlign: 'center' as const,
  };

  /** 图标按钮（单字符 + title 说明；点按直接生效，不触发行的 onSelect） */
  const IconBtn = ({
    op, icon, title,
  }: { op: MemoryOp; icon: string; title: string }) => (
    <button
      type="button"
      className="btn"
      disabled={disabled && op !== 'unlock'}
      title={disabled && op !== 'unlock' ? `已锁定，先解锁才能操作（${title}）` : title}
      data-testid={`op-${op}`}
      style={btnStyle}
      onClick={(e) => { e.stopPropagation(); onAction(op); }}
    >
      {icon}
    </button>
  );

  return (
    <div className="actions" data-testid="memory-actions">
      <button
        type="button"
        className="btn primary"
        data-testid="op-open"
        title="📂 打开这条记忆文件（导出 .json + 系统默认查看器/编辑器）"
        style={btnStyle}
        onClick={() => onOpenFile?.(rec)}
      >
        📂
      </button>
      <IconBtn op="remember" icon="📌" title="📌 记住（提升优先级 + 置信度）" />
      <IconBtn op="forget" icon="⌫" title="⌫ 忘记（降权，不删除）" />
      {rec.pinned
        ? <IconBtn op="unpin" icon="📍" title="取消置顶" />
        : <IconBtn op="pin" icon="📍" title="置顶" />}
      {rec.archived
        ? <IconBtn op="restore" icon="↩" title="恢复为活跃" />
        : <IconBtn op="archive" icon="🗄" title="归档" />}
      {rec.locked
        ? <IconBtn op="unlock" icon="🔓" title="解锁（豁免后台任务）" />
        : <IconBtn op="lock" icon="🔒" title="锁定（仅可解锁）" />}
      <button
        type="button"
        className="btn danger"
        data-testid="op-delete"
        title="🗑 彻底删除该记忆（不可恢复）"
        disabled={disabled}
        style={btnStyle}
        onClick={(e) => {
          e.stopPropagation();
          if (window.confirm('彻底删除该记忆？此操作不可恢复。')) onAction('delete');
        }}
      >
        🗑
      </button>
    </div>
  );
}
