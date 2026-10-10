// 记忆管理页（REQ-006 / P8）列表（T3）
// 排序：sortMemories（pinned 置顶 → confidence 降序）。
// 操作列由 T4 的 MemoryActions 通过 renderActions 注入；T3 仅负责数据与排序展示。
import type { ReactNode } from 'react';
import type { MemoryRecord } from './types.ts';
import { sortMemories } from './logic.ts';
import { MemoryRow } from './MemoryRow.tsx';

export function MemoryTable({
  memories,
  selectedId,
  onSelect,
  renderActions,
}: {
  memories: MemoryRecord[];
  selectedId?: string | null;
  onSelect?: (r: MemoryRecord) => void;
  renderActions?: (r: MemoryRecord) => ReactNode;
}) {
  const sorted = sortMemories(memories);
  return (
    <table className="mtable" data-testid="memory-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>内容</th>
          <th>类型</th>
          <th>标签</th>
          <th>重要度</th>
          <th>置信</th>
          <th>访问/强化</th>
          <th>标记</th>
          <th>温度</th>
          <th>状态</th>
          <th>合并谱系</th>
          <th>创建/更新</th>
          {renderActions && <th>操作</th>}
        </tr>
      </thead>
      <tbody>
        {sorted.length === 0 ? (
          <tr><td colSpan={renderActions ? 13 : 12} style={{ textAlign: 'center', color: 'var(--muted)' }}>
            暂无记忆
          </td></tr>
        ) : (
          sorted.map((rec) => (
            <MemoryRow key={rec.id} rec={rec} selected={rec.id === selectedId} onSelect={onSelect}>
              {renderActions && renderActions(rec)}
            </MemoryRow>
          ))
        )}
      </tbody>
    </table>
  );
}
