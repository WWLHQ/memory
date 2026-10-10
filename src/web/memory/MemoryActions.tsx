// 记忆管理页（REQ-006 / P8）操作区（T4）
// 17.3 推荐文案在 MemoryPage 以 toast 呈现；本组件负责渲染按钮 + locked 约束（G4）。
// 操作意图通过 onAction 上抛，由页面执行 applyOp + 审计（G6）+ toast。
import type { MemoryOp, MemoryRecord } from './types.ts';

export function MemoryActions({
  rec,
  onAction,
}: {
  rec: MemoryRecord;
  onAction: (op: MemoryOp) => void;
}) {
  // locked 记忆：仅「解锁」可点，其余禁用（G4）
  const disabled = rec.locked;

  const Btn = ({
    op, label, danger, confirm,
  }: { op: MemoryOp; label: string; danger?: boolean; confirm?: string }) => (
    <button
      type="button"
      className={`btn${danger ? ' danger' : ''}`}
      disabled={disabled && op !== 'unlock'}
      title={disabled && op !== 'unlock' ? '已锁定，先解锁才能操作' : undefined}
      data-testid={`op-${op}`}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        onAction(op);
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="actions" data-testid="memory-actions">
      <Btn op="remember" label="📌 记住" />
      <Btn op="forget" label="⌫ 忘记" />
      {rec.pinned ? <Btn op="unpin" label="取消置顶" /> : <Btn op="pin" label="置顶" />}
      {rec.archived ? <Btn op="restore" label="恢复" /> : <Btn op="archive" label="归档" />}
      {rec.locked ? <Btn op="unlock" label="🔓 解锁" /> : <Btn op="lock" label="🔒 锁定" />}
      <Btn op="delete" label="🗑 删除" danger confirm="彻底删除该记忆？此操作不可恢复。" />
    </div>
  );
}
