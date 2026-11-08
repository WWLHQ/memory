// 生命周期页（REQ-006 / P4）· 完整编排（T5）· 真实数据接真版
// 列表 = 内核账本真实记忆（桌面 = 主进程 FileStorage 持久库；浏览器降级内存态，空账本诚实空态）。
// 迁移/调参经 ma._memoryOp 走内核（G4/钳制/温度映射/审计真实发生，写回真实账本）。
// 与记忆库管理页一致：禁止注入演示/种子数据 —— 列表只反映账本真实内容。
import { useEffect, useMemo, useState } from 'react';
import { LifecycleCard } from './LifecycleCard.tsx';
import { ParamPanel } from './ParamPanel.tsx';
import { useToast } from './useToast.tsx';
import { useLifecycleMirror } from './useLifecycleMirror.ts';
import { canMigrate, freshnessPreview, importanceLevel } from './logic.ts';
import { coreListLifecycle, coreLifeOp } from './coreLifecycle.ts';
import { LIFECYCLE_DEFAULT_PAGE_SIZE, LIFECYCLE_PAGE_SIZES, pagedList } from './lifecycleFilter.ts';
import { M_DAYS, N_DAYS } from './constants.ts';
import { useHostTheme } from '../shared/hostTheme.ts';
import type { LifeOp, LifecycleRecord, MemoryStatus } from './types.ts';

export function LifecyclePage() {
  useHostTheme();
  const [records, setRecords] = useState<LifecycleRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [batchTarget, setBatchTarget] = useState<MemoryStatus>('archived');
  const [loading, setLoading] = useState(true);
  /** 定稿 3 页签：六状态 / 批量迁移 / 衰减与阈值 */
  const [tab, setTab] = useState(0);
  // 分页状态（复制记忆库管理页口径；默认每页 5 条）
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(LIFECYCLE_DEFAULT_PAGE_SIZE);
  const toast = useToast();
  const mirror = useLifecycleMirror();

  // 当前页数据（纯函数分页；page 越界自动 clamp）
  const paged = useMemo(() => pagedList(records, { page, pageSize }), [records, page, pageSize]);
  const changePageSize = (n: number) => {
    setPageSize(n);
    setPage(1); // 改每页条数 → 回第 1 页（与记忆库管理页一致）
  };

  // 挂载：从真实账本读全量生命周期列表（无种子兜底；空账本 → 诚实空态）
  useEffect(() => {
    let alive = true;
    coreListLifecycle()
      .then((list) => {
        if (!alive) return;
        setRecords(list);
        setSelectedId(list[0]?.id ?? null);
      })
      .catch(() => {}) // 内核不可达 → 保持空列表（不编造记录）
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const selected = records.find((r) => r.id === selectedId) ?? null;

  // 展示用 request_id：只能由内核操作回填；未操作前留空，不用客户端 ULID 冒充（批次48 A20）
  const [reqId, setReqId] = useState('');

  async function applySingle(rec: LifecycleRecord, op: Parameters<typeof coreLifeOp>[2]): Promise<boolean> {
    const res = await coreLifeOp(records, rec, op);
    if (res.request_id) setReqId(res.request_id);
    if (!res.ok) {
      toast.show(res.message ?? '操作未生效');
      return false;
    }
    const byId = new Map(res.affected.map((r) => [r.id, r]));
    setRecords((list) => list.map((r) => byId.get(r.id) ?? r));
    mirror.audit(res.audit, res.request_id || reqId);
    return true;
  }

  async function handleMigrate(target: MemoryStatus) {
    if (!selected) return;
    // 批次48 A20：失败时 applySingle 已给出错误 toast，这里不得再叠加成功 toast 把错误盖掉
    if (!(await applySingle(selected, { kind: 'migrate', target }))) return;
    toast.show(`已迁移 ${selected.id} → ${target}（真实审计）`);
  }

  function handleParam(patch: Partial<Pick<LifecycleRecord, 'half_life_days' | 'confidence' | 'importance' | 'pinned' | 'locked'>>) {
    if (!selected) return;
    const op: LifeOp = { kind: 'param', ...patch };
    void applySingle(selected, op);
  }

  async function handleBatch() {
    if (checked.size === 0) {
      toast.show('请先勾选要批量迁移的记忆');
      return;
    }
    const res = await coreLifeOp(records, selected ?? records[0], { kind: 'batch_migrate', ids: [...checked], target: batchTarget });
    if (res.request_id) setReqId(res.request_id);
    if (!res.ok) {
      toast.show(res.message ?? '批量迁移未生效');
      return;
    }
    const byId = new Map(res.affected.map((r) => [r.id, r]));
    setRecords((list) => list.map((r) => byId.get(r.id) ?? r));
    setChecked(new Set());
    mirror.audit(res.audit, res.request_id || reqId);
    const skipped = checked.size - res.affected.length;
    if (res.affected.length === 0) {
      // 失败/全部跳过不许报成功：内核没改任何一条时如实说「未生效」
      toast.show(`批量迁移未生效：勾选 ${checked.size} 条均被内核跳过（锁定 G4 / 已处目标态 / 非法迁移）`);
      return;
    }
    toast.show(`批量迁移 ${res.affected.length} 条 → ${batchTarget}${skipped > 0 ? `（${skipped} 条被内核跳过）` : ''}（真实审计）`);
  }

  // 勾选操作：批量只作用于当前页（避免跨页误选），全选/取消勾选全表
  const currentIds = new Set(paged.items.map((r) => r.id));
  const allChecked = currentIds.size > 0 && selectedId !== null && currentIds.has(selectedId) ? paged.items.every((r) => checked.has(r.id)) : false;
  const toggle = (id: string) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  const toggleAllPage = (v: boolean) =>
    setChecked((s) => {
      const n = new Set(s);
      for (const r of paged.items) {
        if (v) n.add(r.id); else n.delete(r.id);
      }
      return n;
    });

  if (loading) {
    return (
      <div className="wrap" data-testid="lifecycle-page">
        <h1>⏳ 生命周期页 <span className="badge p2">REQ-006 · P4</span></h1>
        <div className="note">加载真实账本中…</div>
        {toast.node}
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="wrap" data-testid="lifecycle-page">
        <h1>⏳ 生命周期页 <span className="badge p2">REQ-006 · P4</span></h1>
        <div className="card" data-testid="lifecycle-empty">
          <b>当前记忆账本为空，无真实生命周期数据。</b>
          <div className="note">
            请先在「写入页」或「记忆库管理页」产生真实记忆，本页将自动列出全部真实记忆及其
            温度（decay_class）/ 重要度 / 半衰期 / 访问与强化计数。空账本不伪造数据。
          </div>
        </div>
        {toast.node}
      </div>
    );
  }

  return (
    <div className="wrap" data-testid="lifecycle-page">
      <h1>⏳ 生命周期页 <span className="badge p2">REQ-006 · P4</span></h1>
      <div className="sub">六态机（9.10）+ 调参（17.4/17.5）· 数据真相 = 内核账本（{records.length} 条真实记忆）· request_id={reqId || '暂无（操作后由内核返回）'}</div>

      <div className="p0-tabs" role="tablist" data-testid="lifecycle-tabs">
        {['六状态', '批量迁移', '衰减与阈值'].map((label, i) => (
          <button
            key={label} type="button" role="tab" aria-selected={tab === i}
            className={`p0-tab${tab === i ? ' active' : ''}`}
            data-testid={`lifecycle-tab-${i}`} data-tab={i}
            onClick={() => setTab(i)}
          >{label}</button>
        ))}
      </div>

      <div hidden={tab !== 0} data-testid="lifecycle-panel-0">

      <div className="card">
        <table className="ltable" data-testid="lifecycle-table">
          <thead>
            <tr>
              <th><input type="checkbox" aria-label="本页全选" data-testid="check-all"
                checked={allChecked}
                onChange={(e) => toggleAllPage(e.target.checked)} /></th>
              <th>ID</th>
              <th>状态</th>
              <th>温度</th>
              <th>重要度（级）</th>
              <th>访问/强化</th>
            </tr>
          </thead>
          <tbody>
            {paged.items.map((r) => (
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

      {/* 分页控件（复制记忆库管理页口径；默认每页 5 条；置于表格卡片与两个联动卡片中间） */}
      <div
        data-testid="pagination"
        style={{
          display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, marginBottom: 10,
          fontSize: 12.5, color: 'var(--muted)', flexWrap: 'wrap',
        }}
      >
        <label style={{ fontSize: 12 }} data-testid="filter-pagesize-label">
          每页
          <select
            data-testid="filter-pagesize"
            value={String(pageSize)}
            onChange={(e) => changePageSize(Number(e.target.value))}
            style={{ padding: '4px 6px', background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 6, color: 'var(--txt)', fontSize: 12, margin: '0 4px' }}
          >
            {LIFECYCLE_PAGE_SIZES.map((n) => (
              <option key={n} value={n}>{n} 条</option>
            ))}
          </select>
        </label>
        <button
          className="btn"
          data-testid="pg-first"
          disabled={paged.page <= 1}
          onClick={() => setPage(1)}
          style={{ padding: '4px 12px', fontSize: 12 }}
          title="首页"
        >
          ⏮ 首页
        </button>
        <button
          className="btn"
          data-testid="pg-prev"
          disabled={paged.page <= 1}
          onClick={() => setPage(paged.page - 1)}
          style={{ padding: '4px 12px', fontSize: 12 }}
          title="上一页"
        >
          ‹ 上一页
        </button>
        <span data-testid="pg-info">
          第 <input
            type="number"
            min={1}
            max={paged.totalPages}
            data-testid="pg-goto-input"
            value={paged.page}
            style={{ width: 36, padding: '2px 4px', background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 4, color: 'var(--txt)', fontSize: 12, textAlign: 'center' }}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!isNaN(v) && v >= 1 && v <= paged.totalPages) {
                setPage(v);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const v = parseInt((e.target as HTMLInputElement).value, 10);
                if (!isNaN(v) && v >= 1 && v <= paged.totalPages) setPage(v);
              }
            }}
          /> / {paged.totalPages} 页 · 共 {paged.total} 条
        </span>
        <button
          className="btn"
          data-testid="pg-next"
          disabled={paged.page >= paged.totalPages}
          onClick={() => setPage(paged.page + 1)}
          style={{ padding: '4px 12px', fontSize: 12 }}
          title="下一页"
        >
          下一页 ›
        </button>
        <button
          className="btn"
          data-testid="pg-last"
          disabled={paged.page >= paged.totalPages}
          onClick={() => setPage(paged.totalPages)}
          style={{ padding: '4px 12px', fontSize: 12 }}
          title="尾页"
        >
          尾页 ⏭
        </button>
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

      </div>

      <div hidden={tab !== 1} data-testid="lifecycle-panel-1">
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b>批量迁移（9.10.4，写真实审计 lifecycle_change + {reqId || '操作后回填真实 request_id'}）</b>
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
          <div className="note">合法迁移：{canMigrate('active', 'hibernating') ? 'active→hibernating 等' : '—'}；锁定（G4）与已处目标态的行自动跳过；0 条改动会如实显示「未生效」。</div>
          <div className="note" data-testid="batch-selection" style={{ marginTop: 8 }}>
            勾选在「六状态」页完成 · 当前已勾选 <b>{checked.size}</b> 条
            {checked.size > 0 ? `：${[...checked].join('、')}` : '（先去六状态页勾选要迁移的行）'}
          </div>
        </div>
      </div>

      <div hidden={tab !== 2} data-testid="lifecycle-panel-2">
        <div className="card">
          <b>衰减阈值与温度档（9.10.1 / 17.5 / 17.7）</b>
          <table className="ltable" data-testid="decay-thresholds" style={{ marginTop: 8 }}>
            <thead>
              <tr><th>阈值</th><th>值</th><th>说明</th></tr>
            </thead>
            <tbody>
              <tr><td>hibernating 触发</td><td>{N_DAYS} 天</td><td>age ≥ N 天进入休眠（仍可读）</td></tr>
              <tr><td>archived 触发</td><td>{M_DAYS} 天</td><td>age ≥ M 天进入归档（仍可读，不是删除）</td></tr>
              <tr><td>freshness</td><td>0.5^(age/half)</td><td>下限 0.05；由真实 age 与半衰期计算</td></tr>
              <tr><td>温度五档</td><td>hot / warm / cold / archived / dormant</td><td>内核真实 decay_class；页面六态由它翻译</td></tr>
            </tbody>
          </table>
        </div>
        <div className="card">
          <b>本页真实记忆的衰减预览（当前页 {paged.items.length} / 共 {records.length} 条）</b>
          {paged.items.length === 0 ? (
            <div className="p0-empty dashed" data-testid="decay-empty">账本为空：无真实衰减数据，不伪造阈值样本。</div>
          ) : (
            <table className="ltable" data-testid="decay-table" style={{ marginTop: 8 }}>
              <thead>
                <tr><th>ID</th><th>温度</th><th>状态</th><th>age（天）</th><th>半衰期</th><th>freshness</th></tr>
              </thead>
              <tbody>
                {paged.items.map((r) => (
                  <tr key={r.id} data-testid={`decay-row-${r.id}`}>
                    <td className="mid">{r.id}</td>
                    <td><span className={`temp ${r.decay_class}`}>{r.decay_class}</span></td>
                    <td><span className={`status ${r.status}`}>{r.status}</span></td>
                    <td>{r.ageDays}</td>
                    <td>{r.half_life_days}</td>
                    <td>{freshnessPreview(r.ageDays, r.half_life_days).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {toast.node}
    </div>
  );
}
