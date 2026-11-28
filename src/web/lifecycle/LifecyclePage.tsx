// 生命周期页（REQ-006 / P4）· 2026-11-22 按真实使用场景重排
// 版式对齐概览页：顶部摘要读数条 + af-panel 三列网格（宽项跨列）。
// 分组按记忆从产生 → 降温 → 休眠 → 归档 → 弃用的真实阶段组织：
//   各阶段条数 / 流转规则 / 待处理项 / 时间窗口；明细表、单条迁移、调参、批量迁移、
//   衰减阈值与预览等原有真实能力全部保留。
// 数据真相 = 内核账本（桌面 = 主进程 FileStorage 持久库；浏览器降级内存态，空账本诚实空态）。
// 迁移/调参经 ma._memoryOp 走内核（G4/钳制/温度映射/审计真实发生，写回真实账本）。
// 禁止注入演示/种子数据 —— 所有读数只反映账本真实内容，取不到就写「未采样 / 不可用」并给原因。
import { useEffect, useMemo, useState } from 'react';
import { LifecycleCard } from './LifecycleCard.tsx';
import { ParamPanel } from './ParamPanel.tsx';
import { useToast } from './useToast.tsx';
import { useLifecycleMirror } from './useLifecycleMirror.ts';
import { canMigrate, freshnessPreview, importanceLevel, STATUS_FLOW } from './logic.ts';
import { coreListLifecycle, coreLifeOp } from './coreLifecycle.ts';
import { LIFECYCLE_DEFAULT_PAGE_SIZE, LIFECYCLE_PAGE_SIZES, pagedList } from './lifecycleFilter.ts';
import { M_DAYS, N_DAYS } from './constants.ts';
import { useHostTheme } from '../shared/hostTheme.ts';
import type { LifeOp, LifecycleRecord, MemoryStatus } from './types.ts';
import './lifecyclePage.css';

const STATUS_ORDER: MemoryStatus[] = ['active', 'hibernating', 'archived', 'deprecated', 'stale', 'dormant'];

export function LifecyclePage() {
  useHostTheme();
  const [records, setRecords] = useState<LifecycleRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [batchTarget, setBatchTarget] = useState<MemoryStatus>('archived');
  const [loading, setLoading] = useState(true);
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

  // ── 真实阶段读数（全部由账面 status 派生；不造数） ──
  const countOf = (...s: MemoryStatus[]) => records.filter((r) => s.includes(r.status)).length;
  const activeN = countOf('active');
  const coolingN = countOf('hibernating', 'dormant', 'stale');
  const archivedN = countOf('archived');
  const deprecatedN = countOf('deprecated');
  const pendingRecords = records.filter((r) => r.status === 'stale' || r.status === 'dormant' || r.locked);

  // 人机交互：plain=这档是什么意思（大白话），rule=系统判定规则，按钮说清"点了会发生什么"
  const STAGES: { key: string; target: MemoryStatus; title: string; plain: string; rule: string; window: string; count: number }[] = [
    {
      key: 'active', target: 'active', title: '正在使用', count: activeN,
      plain: '刚记下、或者最近还在用的记忆——它们照常参与回答。',
      rule: '新写入就进这一档，用过会让它更"热"。',
      window: '没有时间限制',
    },
    {
      key: 'cooling', target: 'hibernating', title: '慢慢休眠', count: coolingN,
      plain: `超过 ${N_DAYS} 天没用的记忆先收起来，需要时仍然能查到。`,
      rule: '放久了自动降温；这只是标记，没有删掉内容。',
      window: `超过 ${N_DAYS} 天`,
    },
    {
      key: 'archived', target: 'archived', title: '已归档', count: archivedN,
      plain: `超过 ${M_DAYS} 天没动过的记忆存进这里，不是删除，随时能取回。`,
      rule: '长期不用的自动归档，仍能读、能恢复。',
      window: `超过 ${M_DAYS} 天`,
    },
    {
      key: 'deprecated', target: 'deprecated', title: '已弃用', count: deprecatedN,
      plain: '被更新的记忆替代后，旧的那条留在这里备查。',
      rule: '合并或替换时触发，内容留痕，不会物理删除。',
      window: '有新内容替代它时',
    },
  ];

  if (loading) {
    return (
      <div className="p0-page lifecycle-page" data-testid="lifecycle-page">
        <div className="af-head" data-testid="lifecycle-head">
          <h1>生命周期</h1>
          <span className="sub">正在读取真实账本…</span>
        </div>
        <div className="note">加载真实账本中…</div>
        {toast.node}
      </div>
    );
  }

  return (
    <div className="p0-page lifecycle-page" data-testid="lifecycle-page">
      <div className="af-head" data-testid="lifecycle-head">
        <h1>生命周期</h1>
        <span className="sub">
          产生 → 降温 → 休眠 → 归档 → 弃用 · 数据真相 = 内核账本（{records.length} 条真实记忆） · request_id={reqId || '暂无（操作后由内核返回）'}
        </span>
        <span className="right">
          <span className="p0-tag info">{records.length} 条真实记忆</span>
          <span className="p0-tag">休眠 {N_DAYS} 天 · 归档 {M_DAYS} 天</span>
        </span>
      </div>

      {/* ── 摘要读数条 ── */}
      <section className="af-panel" data-testid="lifecycle-summary">
        <div className="af-ph"><h3>生命周期摘要</h3><span className="hint">coreListLifecycle 真值 · 非示例数据</span></div>
        <div className="af-pb">
          <div className="af-g4">
            <div className="af-stat">
              <div className="k">活跃 <span>active</span></div>
              <div className="v">{activeN}</div>
              <div className="d mut">写入 / 强化中的记忆</div>
            </div>
            <div className="af-stat">
              <div className="k">降温与休眠 <span>hibernating / dormant / stale</span></div>
              <div className="v">{coolingN}</div>
              <div className="d mut">age ≥ {N_DAYS} 天进入休眠（仍可读）</div>
            </div>
            <div className="af-stat">
              <div className="k">归档与弃用 <span>archived / deprecated</span></div>
              <div className="v">{archivedN + deprecatedN}</div>
              <div className="d mut">age ≥ {M_DAYS} 天归档；弃用可恢复</div>
            </div>
            <div className="af-stat">
              <div className="k">待处理 <span>stale / dormant / locked</span></div>
              <div className="v">{pendingRecords.length}</div>
              <div className={pendingRecords.length ? 'd' : 'd mut'}>
                {pendingRecords.length ? '可在下方「待处理项」勾选后批量处理' : '当前没有待处理项'}
              </div>
            </div>
          </div>
          <p className="af-note">
            数据来源：内核账本 coreListLifecycle（桌面 = FileStorage，浏览器 = 进程内账本）。
            状态 / 温度 / 半衰期均为真实值；页面不生成演示记忆，读不到时保持空态并说明原因。
          </p>
        </div>
      </section>

      {/* ── 四阶段卡：各阶段条数 / 流转规则 / 时间窗口 / 可执行动作 ── */}
      <div className="af-g4" data-testid="lifecycle-stages">
        {STAGES.map((s) => (
          <section className="af-panel lc-stage" key={s.key} data-testid={`stage-card-${s.key}`}>
            <div className="af-ph"><h3>{s.title}</h3><span className="hint">{s.count} 条</span></div>
            <div className="af-pb">
              <p className="af-q">{s.plain}</p>
              <div className="lc-mini">
                <span>现在有 <b>{s.count}</b> 条</span>
                <span>{s.window}</span>
              </div>
              <p className="af-note">{s.rule}</p>
              <div className="lc-actions">
                <button
                  type="button"
                  className="btn"
                  data-testid={`stage-migrate-${s.target}`}
                  disabled={!selected}
                  title={selected ? `把选中的「${selected.content}」改成「${s.title}」，内容不会丢` : '先在下面的列表里选一条记忆'}
                  onClick={() => void handleMigrate(s.target)}
                >
                  {selected ? `把这 1 条改成「${s.title}」` : `把选中的改成「${s.title}」`}
                </button>
              </div>
            </div>
          </section>
        ))}
      </div>

      {/* ── 流转规则 + 待处理项（3 列网格：宽卡 2 列、窄卡 1 列） ── */}
      <div className="af-g3">
        <section className="af-panel af-span2" data-testid="lifecycle-flow">
          <div className="af-ph"><h3>流转规则与时间窗口</h3><span className="hint">9.10.1 / 9.10.3 · 内核 STATUS_FLOW</span></div>
          <div className="af-pb">
            <ul className="lc-flow">
              {STATUS_ORDER.map((s) => (
                <li key={s}>
                  <span className={`status ${s}`}>{s}</span>
                  <span className="lc-arrow">→</span>
                  <span className="lc-next">{STATUS_FLOW[s].join(' / ')}</span>
                </li>
              ))}
            </ul>
            <p className="af-note">
              时间窗口：age ≥ {N_DAYS} 天 → hibernating（仍可读）；age ≥ {M_DAYS} 天 → archived（仍可读，不是删除）。
              freshness = 0.5^(age/half_life)，下限 0.05。锁定（locked）记忆仅可解锁，不参与迁移/调参（G4）。
            </p>
          </div>
        </section>
        <section className="af-panel" data-testid="lifecycle-pending">
          <div className="af-ph"><h3>待处理项</h3><span className="hint">{pendingRecords.length} 条</span></div>
          <div className="af-pb">
            {pendingRecords.length === 0 ? (
              <p className="af-note">当前没有 stale / dormant / locked 记忆。</p>
            ) : (
              <ul className="lc-pending">
                {pendingRecords.slice(0, 10).map((r) => (
                  <li key={r.id}>
                    <span className="mono">{r.id}</span>
                    <span className={`status ${r.status}`}>{r.status}</span>
                    {r.locked ? <span className="tag">locked</span> : null}
                  </li>
                ))}
              </ul>
            )}
            <div className="lc-actions">
              <button
                type="button"
                className="btn"
                data-testid="pending-check"
                disabled={pendingRecords.length === 0}
                onClick={() => setChecked(new Set(pendingRecords.map((r) => r.id)))}
              >
                勾选全部待处理
              </button>
            </div>
            <p className="af-note">勾选后到「批量迁移」卡执行；锁定项会被内核跳过并计入跳过数。</p>
          </div>
        </section>
      </div>

      {/* ── 明细表 + 选中项处理（原有能力保留） ── */}
      {records.length === 0 ? (
        <section className="af-panel" data-testid="lifecycle-empty-wrap">
          <div className="af-pb">
            <div className="card" data-testid="lifecycle-empty">
              <b>当前记忆账本为空，无真实生命周期数据。</b>
              <div className="note">
                请先在「写入页」或「记忆库管理页」产生真实记忆，本页将自动列出全部真实记忆及其
                温度（decay_class）/ 重要度 / 半衰期 / 访问与强化计数。空账本不伪造数据。
              </div>
            </div>
          </div>
        </section>
      ) : (
        <div className="af-g3">
          <section className="af-panel af-span2" data-testid="lifecycle-table-panel">
            <div className="af-ph"><h3>真实记忆明细</h3><span className="hint">{records.length} 条 · 默认每页 {LIFECYCLE_DEFAULT_PAGE_SIZE}</span></div>
            <div className="af-pb">
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

              {/* 分页控件（批次 E：与首页 v5 pager 统一，复用 shared/PageNav；默认每页 5 条） */}
              <div className="lc-pager" data-testid="pagination">
                <label data-testid="filter-pagesize-label">
                  每页
                  <select
                    data-testid="filter-pagesize"
                    value={String(pageSize)}
                    onChange={(e) => changePageSize(Number(e.target.value))}
                  >
                    {LIFECYCLE_PAGE_SIZES.map((n) => (
                      <option key={n} value={n}>{n} 条</option>
                    ))}
                  </select>
                </label>
                <button type="button" className="btn" data-testid="pg-first" disabled={paged.page <= 1} onClick={() => setPage(1)} title="首页">⏮ 首页</button>
                <button type="button" className="btn" data-testid="pg-prev" disabled={paged.page <= 1} onClick={() => setPage(paged.page - 1)} title="上一页">‹ 上一页</button>
                <span data-testid="pg-info">
                  第 <input
                    type="number"
                    min={1}
                    max={paged.totalPages}
                    data-testid="pg-goto-input"
                    value={paged.page}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (!isNaN(v) && v >= 1 && v <= paged.totalPages) setPage(v);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const v = parseInt((e.target as HTMLInputElement).value, 10);
                        if (!isNaN(v) && v >= 1 && v <= paged.totalPages) setPage(v);
                      }
                    }}
                  /> / {paged.totalPages} 页 · 共 {paged.total} 条
                </span>
                <button type="button" className="btn" data-testid="pg-next" disabled={paged.page >= paged.totalPages} onClick={() => setPage(paged.page + 1)} title="下一页">下一页 ›</button>
                <button type="button" className="btn" data-testid="pg-last" disabled={paged.page >= paged.totalPages} onClick={() => setPage(paged.totalPages)} title="尾页">尾页 ⏭</button>
              </div>
            </div>
          </section>

          <section className="af-panel" data-testid="lifecycle-selected">
            <div className="af-ph"><h3>选中项处理</h3><span className="hint">{selected ? selected.id : '未选中'}</span></div>
            <div className="af-pb lc-selected-body">
              {selected ? (
                <>
                  <div className="lc-cell"><LifecycleCard rec={selected} onMigrate={handleMigrate} /></div>
                  <div className="lc-cell"><ParamPanel rec={selected} onParam={handleParam} /></div>
                </>
              ) : (
                <p className="af-note">点左侧明细行选中一条记忆后，这里可单条迁移与调参。</p>
              )}
            </div>
          </section>
        </div>
      )}

      {/* ── 批量迁移 + 衰减与阈值（空账本不渲染操作入口，保持旧 E2E 契约） ── */}
      {records.length > 0 && (
      <div className="af-g3">
        <section className="af-panel" data-testid="lifecycle-batch">
          <div className="af-ph"><h3>批量迁移</h3><span className="hint">9.10.4 · lifecycle_change 审计</span></div>
          <div className="af-pb">
            <div className="lc-batch-row">
              <label>目标态
                <select data-testid="batch-target" value={batchTarget} onChange={(e) => setBatchTarget(e.target.value as MemoryStatus)}>
                  {STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
              <button type="button" className="btn primary" data-testid="batch-run" onClick={handleBatch}>
                批量迁移（{checked.size} 条）
              </button>
            </div>
            <p className="af-note">
              合法迁移：{canMigrate('active', 'hibernating') ? 'active→hibernating 等（完整清单见上方流转规则）' : '不适用'}；
              锁定（G4）与已处目标态的行由内核自动跳过；0 条改动会如实显示「未生效」。
              审计写入 lifecycle_change，request_id：{reqId || '操作后由内核返回'}。
            </p>
            <div className="af-note" data-testid="batch-selection">
              勾选在「真实记忆明细」完成 · 当前已勾选 <b>{checked.size}</b> 条
              {checked.size > 0 ? `：${[...checked].join('、')}` : '（先去明细勾选要迁移的行）'}
            </div>
          </div>
        </section>

        <section className="af-panel af-span2" data-testid="lifecycle-decay">
          <div className="af-ph"><h3>衰减与阈值</h3><span className="hint">9.10.1 / 17.5 / 17.7</span></div>
          <div className="af-pb">
            <table className="ltable" data-testid="decay-thresholds">
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
            {paged.items.length === 0 ? (
              <div className="p0-empty dashed" data-testid="decay-empty">账本为空：无真实衰减数据，不伪造阈值样本。</div>
            ) : (
              <table className="ltable" data-testid="decay-table">
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
            <p className="af-note">当前页 {paged.items.length} / 共 {records.length} 条；衰减预览只算真实账本记录，不补样例。</p>
          </div>
        </section>
      </div>
      )}

      {toast.node}
    </div>
  );
}
