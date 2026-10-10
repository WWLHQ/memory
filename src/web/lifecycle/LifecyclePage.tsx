// 生命周期页（REQ-006 / P4）· 完整编排（T5）
// 列表（勾选批量）+ 选中联动（状态查看器 LifecycleCard + 调参面板 ParamPanel）
// + 批量迁移（stale→archived 等，写审计 lifecycle_change + request_id，9.10.4/18.2-E）+ mirror 注入点。
import { useMemo, useState } from 'react';
import { LifecycleCard } from './LifecycleCard.tsx';
import { ParamPanel } from './ParamPanel.tsx';
import { useToast } from './useToast.tsx';
import { useLifecycleMirror } from './useLifecycleMirror.ts';
import { applyLifecycle, canMigrate, importanceLevel } from './logic.ts';
import { SEED_LIFECYCLE } from './seed.ts';
import type { LifeOp, LifecycleRecord, MemoryStatus } from './types.ts';

export function LifecyclePage() {
  const [records, setRecords] = useState<LifecycleRecord[]>(SEED_LIFECYCLE);
  const [selectedId, setSelectedId] = useState<string | null>(SEED_LIFECYCLE[0]?.id ?? null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [batchTarget, setBatchTarget] = useState<MemoryStatus>('archived');
  const toast = useToast();
  const mirror = useLifecycleMirror();

  const selected = records.find((r) => r.id === selectedId) ?? null;

  const reqId = useMemo(() => `req_lc_${Math.random().toString(36).slice(2, 8)}`, []);

  function applySingle(rec: LifecycleRecord, op: Parameters<typeof applyLifecycle>[2]) {
    const res = applyLifecycle(records, rec, op, reqId);
    if (!res.ok) {
      toast.show(res.message ?? '操作未生效');
      return;
    }
    const byId = new Map(res.affected.map((r) => [r.id, r]));
    setRecords((list) => list.map((r) => byId.get(r.id) ?? r));
    mirror.audit(res.audit, reqId);
  }

  function handleMigrate(target: MemoryStatus) {
    if (!selected) return;
    applySingle(selected, { kind: 'migrate', target });
    toast.show(`已迁移 ${selected.id} → ${target}`);
  }

  function handleParam(patch: Partial<Pick<LifecycleRecord, 'half_life_days' | 'confidence' | 'importance' | 'pinned' | 'locked'>>) {
    if (!selected) return;
    const op: LifeOp = { kind: 'param', ...patch };
    applySingle(selected, op);
  }

  function handleBatch() {
    if (checked.size === 0) {
      toast.show('请先勾选要批量迁移的记忆');
      return;
    }
    const res = applyLifecycle(records, selected ?? records[0], { kind: 'batch_migrate', ids: [...checked], target: batchTarget }, reqId);
    const byId = new Map(res.affected.map((r) => [r.id, r]));
    setRecords((list) => list.map((r) => byId.get(r.id) ?? r));
    setChecked(new Set());
    mirror.audit(res.audit, reqId);
    toast.show(`批量迁移 ${res.affected.length} 条 → ${batchTarget}`);
  }

  const toggle = (id: string) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  return (
    <div className="wrap" data-testid="lifecycle-page">
      <h1>⏳ 生命周期页 <span className="badge p2">REQ-006 · P4</span></h1>
      <div className="sub">六态机（9.10）+ 调参（17.4/17.5）· 数据本地种子为真相 · request_id={reqId}</div>

      <div className="card">
        <table className="ltable" data-testid="lifecycle-table">
          <thead>
            <tr>
              <th><input type="checkbox" aria-label="全选" data-testid="check-all"
                checked={checked.size === records.length && records.length > 0}
                onChange={(e) => setChecked(e.target.checked ? new Set(records.map((r) => r.id)) : new Set())} /></th>
              <th>ID</th>
              <th>状态</th>
              <th>温度</th>
              <th>重要度（级）</th>
              <th>访问/强化</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id} className={r.id === selectedId ? 'sel' : ''} data-testid={`lrow-${r.id}`}
                onClick={() => setSelectedId(r.id)}>
                <td onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" data-testid={`chk-${r.id}`} checked={checked.has(r.id)}
                    onChange={() => toggle(r.id)} />
                </td>
                <td className="mid">{r.id}</td>
                <td><span className={`status ${r.status}`}>{r.status}</span></td>
                <td><span className={`temp ${r.decay_class}`}>{r.decay_class}</span></td>
                <td>{r.importance}（L{importanceLevel(r.importance)}）</td>
                <td>{r.access_count} / {r.reinforce_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="row" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'stretch', margin: '0 0 14px' }}>
        {selected && (
          <div style={{ flex: 1, minWidth: 300, display: 'flex' }}>
            <LifecycleCard rec={selected} onMigrate={handleMigrate} />
          </div>
        )}
        {selected && (
          <div style={{ flex: 1, minWidth: 300, display: 'flex' }}>
            <ParamPanel rec={selected} onParam={handleParam} />
          </div>
        )}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <b>批量迁移（9.10.4，写审计 lifecycle_change + {reqId}）</b>
          <div className="row">
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>目标态</label>
            <select data-testid="batch-target" value={batchTarget} onChange={(e) => setBatchTarget(e.target.value as MemoryStatus)}>
              {(['active', 'hibernating', 'archived', 'deprecated', 'stale', 'dormant'] as MemoryStatus[]).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <button type="button" className="btn primary" data-testid="batch-run" onClick={handleBatch}>
              批量迁移（{checked.size} 条）
            </button>
          </div>
        </div>
        <div className="note">合法迁移：{canMigrate('active', 'hibernating') ? 'active→hibernating 等' : '—'}；锁定（G4）与已处目标态的行自动跳过。</div>
      </div>

      {toast.node}
    </div>
  );
}
