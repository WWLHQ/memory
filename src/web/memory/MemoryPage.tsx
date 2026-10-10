// 记忆管理页（REQ-006 / P8）· 完整编排（T5）
// 列表(T3) + 操作(T4) + 详情/编辑抽屉 + toast + 后端 mirror 注入点。
// 初始渲染用种子；17.3 操作经 ma._memoryOp 走内核（G4/钳制/版本/审计真实发生），回执驱动状态。
import { useState } from 'react';
import { MemoryTable } from './MemoryTable.tsx';
import { MemoryActions } from './MemoryActions.tsx';
import { MemoryDrawer } from './MemoryDrawer.tsx';
import { useToast } from './useToast.tsx';
import { useMemoryMirror } from './useMemoryMirror.ts';
import { OP_TOAST } from './logic.ts';
import { coreApplyOp } from './coreMemoryOps.ts';
import { SEED_MEMORIES } from './seed.ts';
import type { MemoryOp, MemoryRecord } from './types.ts';

export function MemoryPage() {
  const [memories, setMemories] = useState<MemoryRecord[]>(SEED_MEMORIES);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const toast = useToast();
  const mirror = useMemoryMirror();

  const selected = memories.find((m) => m.id === selectedId) ?? null;

  async function handleAction(rec: MemoryRecord, op: MemoryOp) {
    const res = await coreApplyOp(rec, op);
    if (!res.ok) {
      // locked 约束拒绝（内核 G4）
      toast.show('已锁定，先解锁才能操作。');
      return;
    }
    if (res.rec === null) {
      // 彻底删除：从列表移除
      setMemories((list) => list.filter((m) => m.id !== rec.id));
      if (selectedId === rec.id) setSelectedId(null);
    } else {
      setMemories((list) => list.map((m) => (m.id === rec.id ? res.rec! : m)));
    }
    mirror.audit(res.audit, rec, op); // G6
    toast.show(OP_TOAST[op]);
  }

  function handleSave(next: MemoryRecord) {
    setMemories((list) => list.map((m) => (m.id === next.id ? next : m)));
  }

  return (
    <div className="wrap" data-testid="memory-page">
      <h1>🗂️ 记忆管理页 <span className="badge p2">REQ-006 · P8</span></h1>
      <div className="sub">列表 + 17.3 操作（记住/忘记/置顶/锁定/归档/删除）· 数据本地内存态为真相</div>

      <div className="card">
        <MemoryTable
          memories={memories}
          selectedId={selectedId}
          onSelect={(r) => setSelectedId(r.id)}
          renderActions={(rec) => <MemoryActions rec={rec} onAction={(op) => handleAction(rec, op)} />}
        />
      </div>

      {selected && (
        <MemoryDrawer rec={selected} onClose={() => setSelectedId(null)} onSave={handleSave} />
      )}

      <div className="note">
        红线：租户 ID 全局注入禁手填（G1）；cold/dormant 仅 L2 占位符（G3）；locked 仅可解锁（G4）；
        pinned 免检置顶（G5）；操作写审计（G6）。后端镜像当前为 safe-noop（home server 暂无 memory 端点）。
      </div>

      {toast.node}
    </div>
  );
}
