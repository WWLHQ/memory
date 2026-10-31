// 记忆库管理页（REQ-006 / P8）· 完整编排（T5）
// 列表(T3) + 操作(T4) + 详情/编辑抽屉 + toast + 后端 mirror 注入点 + 自动备份卡（P8 扩展）。
// 数据真相 = 内核账本（桌面 Electron 为主进程 FileStorage 真实持久库）：挂载即 listMemories 读真实数据；
// 17.3 操作经 ma._memoryOp 走内核（G4/钳制/版本/审计真实发生），回执驱动状态。
// ⚠ 禁止注入演示/种子数据：空账本 → 诚实空态 + 引导去写入页产生真实记忆。
// ⚠ 内核读不到（批次25 P0-7）→ 三态加载：显示原因 + 重试，绝不冒充「账本还是空的」。
import { useEffect, useState } from 'react';
import { MemoryTable } from './MemoryTable.tsx';
import type { MemoryTableFilterState } from './MemoryTable.tsx';
import { MemoryActions } from './MemoryActions.tsx';
import { MemoryDrawer } from './MemoryDrawer.tsx';
import { useToast } from './useToast.tsx';
import { useMemoryMirror } from './useMemoryMirror.ts';
import { OP_TOAST } from './logic.ts';
import { coreApplyOp, coreListMemories, coreUpdateContent, storageLocation, openMemoryFile } from './coreMemoryOps.ts';
import { KernelLoadError, useKernelLoad } from '../shared/kernelLoad.tsx';
import type { MemoryOp, MemoryRecord, MemoryStoreLocation } from './types.ts';

export function MemoryPage({ load = coreListMemories }: { load?: () => Promise<MemoryRecord[]> } = {}) {
  const ledger = useKernelLoad('memory', load);
  const memories = ledger.data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loc, setLoc] = useState<MemoryStoreLocation | null>(null);
  const [filterState, setFilterState] = useState<MemoryTableFilterState>({
    search: '', type: 'all', status: 'all', source: 'all',
    createdFrom: '', createdTo: '', pageSize: 20, page: 1,
  });
  const toast = useToast();
  const mirror = useMemoryMirror();

  const selected = memories.find((m) => m.id === selectedId) ?? null;

  // 账本位置（诚实标注「存储在哪」）；读不到时保持 null，由抽屉显示未知
  useEffect(() => {
    let alive = true;
    void storageLocation().then(
      (l) => { if (alive) setLoc(l); },
      () => { if (alive) setLoc(null); },
    );
    return () => { alive = false; };
  }, []);

  async function handleAction(rec: MemoryRecord, op: MemoryOp) {
    const res = await coreApplyOp(rec, op);
    if (!res.ok) {
      // locked 约束拒绝（内核 G4）
      toast.show('已锁定，先解锁才能操作。');
      return;
    }
    if (res.rec === null) {
      // 彻底删除：从列表移除
      ledger.replace((list) => list.filter((m) => m.id !== rec.id));
      if (selectedId === rec.id) setSelectedId(null);
    } else {
      ledger.replace((list) => list.map((m) => (m.id === rec.id ? res.rec! : m)));
    }
    mirror.audit(res.audit, rec, op); // G6
    toast.show(OP_TOAST[op]);
  }

  async function handleSave(next: MemoryRecord) {
    // 内容编辑 → 写回真实账本（9.5；version+1 + 审计真实落账）
    const res = await coreUpdateContent(next.id, next.content);
    if (!res.ok) {
      toast.show(res.error ?? '保存失败');
      return;
    }
    ledger.replace((list) => list.map((m) => (m.id === next.id ? res.rec! : m)));
    toast.show('已保存修改（写回本机记忆账本）。');
  }

  // 直接打开记忆文件（导出 .json + OS 默认查看器），成功/失败都有 toast 反馈
  async function handleOpenFile(rec: MemoryRecord) {
    toast.show(`正在打开记忆文件 ${rec.id}…`);
    const r = await openMemoryFile(rec.id);
    if (r.ok) toast.show(`已打开：${r.path}`);
    else toast.show(`无法打开文件：${r.error}`);
  }

  return (
    <div className="wrap" data-testid="memory-page">
      <h1>🗂️ 记忆库管理页 <span className="badge p2">REQ-006 · P8</span></h1>
      <div className="sub">
        列表 + 17.3 操作（记住/忘记/置顶/锁定/归档/删除）· 数据真相 = 本机真实记忆账本（无演示数据）· 自动备份
      </div>

      <div className="card">
        {ledger.phase === 'loading' && (
          <div data-testid="memory-loading" style={{ padding: '20px', textAlign: 'center' }}>加载真实账本中…</div>
        )}
        {ledger.phase === 'error' && (
          <KernelLoadError what="读取记忆账本" error={ledger.error} onRetry={ledger.retry} />
        )}
        {ledger.phase === 'ok' && memories.length === 0 && (
          <div data-testid="memory-empty" style={{ padding: '36px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🗂️</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>记忆账本还是空的</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
              这里只显示真实记忆数据（来自本机账本 / 各端写入）。<br />
              去「✍️ 写入页」写下第一条记忆，或让 Agent 在对话中自动沉淀。
            </div>
            <button
              className="btn primary"
              data-testid="goto-write"
              type="button"
              onClick={() => { window.location.href = '/write.html'; }}
            >
              → 去写入页产生真实记忆
            </button>
          </div>
        )}
        {ledger.phase === 'ok' && memories.length > 0 && (
          <MemoryTable
            memories={memories}
            selectedId={selectedId}
            onSelect={(r) => setSelectedId(r.id)}
            renderActions={(rec) => (
              <MemoryActions
                rec={rec}
                onAction={(op) => handleAction(rec, op)}
                onOpenFile={(r) => void handleOpenFile(r)}
              />
            )}
            filterState={filterState}
            onFilterChange={setFilterState}
          />
        )}
      </div>

      {selected && (
        <MemoryDrawer rec={selected} location={loc} onClose={() => setSelectedId(null)} onSave={handleSave} />
      )}

      <div className="note">
        红线：租户 ID 全局注入禁手填（G1）；cold/dormant 仅 L2 占位符（G3）；locked 仅可解锁（G4）；
        pinned 免检置顶（G5）；操作写审计（G6）。后端镜像当前为 safe-noop（home server 暂无 memory 端点）。
      </div>

      {toast.node}
    </div>
  );
}
