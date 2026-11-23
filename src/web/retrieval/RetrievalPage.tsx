// 检索页（REQ-012）· 定稿三标签：检索工作台 / 历史查询 / 规则
// 工作台 = 查询行 + 模式行 + 场景带 + 结果列表 + 命中上下文 / 右侧 Token 预算·漏斗·裁剪明细 + 审计轨迹；
// 数据源 = 内核账本真实召回（禁止种子）。默认「全部项目」逐项目召回合并，结果行标明来源项目。
// 导出无后端接口 → 前端 CSV 并注明。
import { useEffect, useState } from 'react';
import { QueryBar, type QueryBarValue } from './QueryBar.tsx';
import { ModeBanner } from './ModeBanner.tsx';
import { TokenBudgetCard, FunnelCard, TrimCard } from './BudgetPanel.tsx';
import { ContextPanel } from './ContextPanel.tsx';
import { ResultRow } from './ResultRow.tsx';
import { RecentRecallsCard, fmtClock, type RecentPhase } from './RecentRecallsCard.tsx';
import { useRetrieval } from './useRetrieval.ts';
import { ALL_PROJECTS_SCOPE, coreReorderMemory, coreRecallHistory, coreRecentRecalls, coreLastRecall, type LastRecallSnapshot } from './coreEngine.ts';
import { listProjectIds } from '../shared/kernelProjects.ts';
import { AuditTrailCard } from './AuditTrailCard.tsx';
import { useToast } from './useToast.tsx';
import { useHostTheme } from '../shared/hostTheme.ts';
import { resolveSceneBudget } from './logic.ts';
import type { BudgetData, RecallHistoryRow, RecentRecallRow } from './types.ts';

type RetTab = 'work' | 'history' | 'rules';
const TABS: { id: RetTab; label: string }[] = [
  { id: 'work', label: '检索工作台' },
  { id: 'history', label: '历史查询' },
  { id: 'rules', label: '规则' },
];

function fmtTs(ts: number, withDate = true): string {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return '时间不可读';
  const p = (n: number) => String(n).padStart(2, '0');
  return withDate
    ? `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
    : `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const EMPTY_BUDGET: BudgetData = {
  payload_tokens: 0, pipeline_llm_tokens: 0, stage1_count: 0, stage2_count: 0,
  rerank_applied: false, budget_breach: false,
};

export function RetrievalPage() {
  useHostTheme();
  const [tab, setTab] = useState<RetTab>('work');
  const [qv, setQv] = useState<QueryBarValue>({
    query: '', scene: 'default', mode: null, project: ALL_PROJECTS_SCOPE,
    budget: Math.ceil(resolveSceneBudget('default').budget / 1000), depth: 'L1',
  });
  const [projects, setProjects] = useState<string[]>([]);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [history, setHistory] = useState<{ phase: 'loading' | 'ready' | 'error'; rows: RecallHistoryRow[]; error?: string }>({
    phase: 'ready', rows: [],
  });
  const [recent, setRecent] = useState<{ phase: RecentPhase; rows: RecentRecallRow[]; today: number; error?: string }>({
    phase: 'loading', rows: [], today: 0,
  });
  /** 本次还没检索时，右栏用账本里最近一次召回的真实审计回填（不留空占位、不造数） */
  const [snapshot, setSnapshot] = useState<LastRecallSnapshot | null>(null);
  const { phase, errorKind, result, cooldown, search } = useRetrieval();
  const { node: toast } = useToast();

  const flash = (m: string) => {
    setToastMsg(m);
    window.setTimeout(() => setToastMsg(null), 2200);
  };

  // 批次48 A26：项目选择器选项 = 账本真实项目（空账本只有「全部项目」）
  useEffect(() => {
    let alive = true;
    void listProjectIds().then((ps) => { if (alive) setProjects(ps); });
    return () => { alive = false; };
  }, []);

  const loadHistory = () => {
    setHistory((h) => ({ ...h, phase: 'loading' }));
    coreRecallHistory(10)
      .then((rows) => setHistory({ phase: 'ready', rows }))
      .catch((e: unknown) => setHistory({ phase: 'error', rows: [], error: e instanceof Error ? e.message : String(e) }));
  };

  useEffect(() => {
    if (tab === 'history') loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  /** 右侧栏「最近召回」= 账本 recall 审计行（初次进入 + 每次检索出结果后各刷一次） */
  const loadRecent = () => {
    setRecent((r) => ({ ...r, phase: 'loading' }));
    coreRecentRecalls(5)
      .then(({ rows, today }) => setRecent({ phase: 'ready', rows, today }))
      .catch((e: unknown) => setRecent({
        phase: 'error', rows: [], today: 0, error: e instanceof Error ? e.message : String(e),
      }));
  };

  useEffect(() => {
    loadRecent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    coreLastRecall()
      .then((s) => { if (alive) setSnapshot(s); })
      .catch(() => { if (alive) setSnapshot(null); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (result) loadRecent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.banner.request_id]);

  const doSearch = () => {
    setSelectedId(null);
    search(
      qv.query, qv.scene, qv.mode, qv.project ?? ALL_PROJECTS_SCOPE,
      (qv.budget ?? Math.ceil(resolveSceneBudget(qv.scene).budget / 1000)) * 1000,
      qv.depth ?? 'L1',
    );
  };

  // 记住/忘记 = 内核 17.3 真操作（写账本 + memory_op 审计），随后重查以反映真实权重
  const remember = (id: string) => {
    void coreReorderMemory(id, 'remember').then((r) => {
      flash(r.ok ? '已提升这条信息的优先级。' : '该记忆已锁定，无法调整权重。');
      if (r.ok) doSearch();
    });
  };
  const forget = (id: string) => {
    void coreReorderMemory(id, 'forget').then((r) => {
      flash(r.ok ? '这条信息已降权，后续会较少主动出现。你可以稍后恢复。' : '该记忆已锁定，无法调整权重。');
      if (r.ok) doSearch();
    });
  };
  // 跳反馈页（真实导航，预填 memory_id）
  const feedback = (id: string) => { window.location.href = `/feedback.html?memory_id=${encodeURIComponent(id)}`; };

  /** 导出 = 真实召回结果前端 CSV（无后端导出接口，按钮旁已注明） */
  const exportCsv = () => {
    const hits = result?.hits ?? [];
    if (hits.length === 0) { flash('本次没有可导出的真实结果。'); return; }
    const head = ['memory_id', 'score', 'project_id', 'layer', 'decay_class', 'importance', 'tags', 'content'];
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [head.join(','), ...hits.map((h) => [
      h.memory_id, h.score.toFixed(3), h.project_id ?? '', h.layer ?? '',
      h.decay_class, h.importance.toFixed(2), h.tags.join('|'), h.content,
    ].map(esc).join(','))];
    const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `retrieval-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const loading = phase === 'LOADING';
  const displayHits = result?.hits ?? [];
  const current = displayHits.find((h) => h.memory_id === selectedId) ?? null;
  const budgetView = result?.budget ?? {
    ...EMPTY_BUDGET,
    budget_tokens: (qv.budget ?? Math.ceil(resolveSceneBudget(qv.scene).budget / 1000)) * 1000,
    depth: qv.depth ?? 'L1',
  };
  const toggle = (id: string) => setSelectedId((cur) => (cur === id ? null : id));

  return (
    <div className="ret-page" data-testid="retrieval-page">
      {/* 从审计页 ↗ 带 ?request_id= 跳来时，真查账本回放该链路；无参数不渲染 */}
      <AuditTrailCard search={typeof window === 'undefined' ? '' : window.location.search} />

      {/* v5 页头（批次 B）：20px 标题 + tagline 胶囊 + 分隔符元信息行 + 右侧导出主操作 */}
      <div className="p0-pagehead" data-testid="ret-head">
        <div className="p0-ph-main">
          <div className="p0-ph-title">
            <h1>检索记忆</h1>
            <span className="p0-tagline">recall_memory 同源 · 全部项目合并去重</span>
          </div>
          <div className="p0-ph-meta">
            <span data-testid="ret-head-meta">
              {phase === 'RESULT' && result
                ? `命中 ${displayHits.length} 条`
                : phase === 'LOADING'
                  ? '召回中…'
                  : phase === 'ERROR'
                    ? '检索失败（真实错误，见下方面板）'
                    : '尚未检索'}
            </span>
            <span className="p0-ph-sep" />
            <span>{phase === 'RESULT' && result ? `用时 ${result.latency_ms} ms` : '运行一次真实检索后显示读数'}</span>
            <span className="p0-ph-sep" />
            <span>预算 {budgetView.budget_tokens}t</span>
            <span className="p0-ph-sep" />
            <span>令牌作用域 + 3000t 硬熔断</span>
          </div>
        </div>
        <div className="p0-ph-actions">
          {displayHits.length > 0 && (
            <button type="button" className="p0-btn" data-testid="export-results" onClick={exportCsv}>导出 CSV</button>
          )}
        </div>
      </div>

      <span className="ret-seg" role="tablist" aria-label="检索页标签">
        {TABS.map((t) => (
          <button
            type="button"
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`ret-seg-item${tab === t.id ? ' active' : ''}`}
            data-testid={`ret-tab-${t.id}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'history' && history.rows.length > 0 ? <span className="ret-tabnum">{history.rows.length}</span> : null}
          </button>
        ))}
      </span>

      {tab === 'work' && (
        <>
          <QueryBar
            value={qv}
            projects={projects}
            loading={loading}
            disabled={cooldown}
            onChange={(v, t) => { setQv(v); if (t) flash(t); }}
            onSubmit={() => doSearch()}
          />

          {phase === 'RESULT' && result && (
            <ModeBanner
              data={result.banner}
              onRequestId={(id) => { window.location.href = `/audit.html?request_id=${encodeURIComponent(id)}`; }}
              onFactRetry={() => { setQv({ ...qv, mode: 'fact_first' }); doSearch(); }}
            />
          )}

          {phase === 'ERROR' && (
            <div className="ret-stage" data-testid="error-panel">
              <b>检索失败</b>
              <span className={`ret-tag ${errorKind === 'breach' ? 'err' : 'warn'}`}>{errorKind === 'breach' ? '硬熔断' : '超时'}</span>
              <span className="ret-note">
                {errorKind === 'breach'
                  ? '召回超硬熔断上限，本次已降级为「无记忆」响应。请缩小范围或拆分查询。'
                  : '召回超时，已回退到第二层轻量打分结果。'}
              </span>
              {(errorKind === 'timeout' || errorKind !== 'breach') && (
                <button type="button" className="ret-btn" data-testid="retry-btn" onClick={() => doSearch()}>重试</button>
              )}
              {cooldown && <span className="ret-note">已禁用检索 3 秒（§6）</span>}
            </div>
          )}

          {phase === 'EMPTY' && (
            <div className="ret-stage" data-testid="empty-panel">
              <b>没有可靠的记忆证据</b>
              <span className="ret-note">建议：换个说法，或切到「事实优先」模式扩大召回深度。</span>
              <button
                type="button" className="ret-btn" data-testid="empty-fact-retry"
                onClick={() => { setQv({ ...qv, mode: 'fact_first' }); doSearch(); }}
              >
                切事实优先重试
              </button>
            </div>
          )}

          <div className="ret-work">
            <div className="ret-work-main">
              <section className="ret-card ret-reslist-card" data-testid="result-list">
                <div className="ret-sec-hd">
                  <h3>结果</h3>
                  <span className="ret-note" data-testid="result-summary">
                    {loading
                      ? '召回中…'
                      : phase === 'RESULT'
                        ? `注入 ${result?.budget.injected_count ?? displayHits.length} 条 · 合并去重按 mem_id`
                        : '运行一次真实检索后显示召回结果'}
                  </span>
                </div>

                {loading && <div className="ret-empty">召回中…（真查内核账本）</div>}

                {!loading && displayHits.length === 0 && (
                  <div className="ret-empty" data-testid="result-empty">
                    {phase === 'IDLE' ? '运行一次真实检索后，这里显示召回结果。' : '本次无命中。不注入演示结果。'}
                  </div>
                )}

                {!loading && displayHits.map((h, i) => (
                  <ResultRow
                    key={h.memory_id}
                    hit={h}
                    index={i}
                    selected={selectedId === h.memory_id}
                    onView={toggle}
                    onRemember={remember}
                    onForget={forget}
                    onFeedback={feedback}
                  />
                ))}
              </section>

              {current ? (
                <ContextPanel
                  hit={current}
                  query={qv.query}
                  onLifecycle={(id) => { window.location.href = `/lifecycle.html?memory_id=${encodeURIComponent(id)}`; }}
                  onAudit={(id) => { window.location.href = `/audit.html?memory_id=${encodeURIComponent(id)}`; }}
                />
              ) : (
                <div className="ret-ctx ret-ctx-idle" data-testid="context-idle">
                  <div className="ret-sec-hd"><h3>命中上下文</h3><span className="ret-note">片段 → 关联记忆</span></div>
                  <div className="ret-note">点开上面任意一条结果，这里显示原文片段、关联记忆与只读参数。</div>
                </div>
              )}

              {phase === 'RESULT' && result && (
                <section className="ret-card ret-trail" data-testid="audit-trail">
                  <div className="ret-sec-hd">
                    <h3>审计轨迹</h3>
                    <span className="ret-note">recall 已落 audit.jsonl</span>
                  </div>
                  <div className="ret-trail-line">
                    <span className="ret-trail-k">request_id =</span>
                    <span className="mono">{result.banner.request_id}</span>
                    <button
                      type="button"
                      className="ret-linkbtn"
                      onClick={() => { window.location.href = `/audit.html?request_id=${encodeURIComponent(result.banner.request_id)}`; }}
                    >
                      按 id 查审计 →
                    </button>
                    <span className="ret-trail-facts">
                      场景 {result.banner.scene} · 模式 {result.banner.mode} · 命中 {displayHits.length} 条 ·
                      payload {result.budget.payload_tokens}t · 耗时 {result.latency_ms} ms · 深度 {result.depth}
                    </span>
                  </div>
                  <div className="ret-note">审计由内核 recall 真实写入；未采集字段（如 LLM usage）不在此臆测。</div>
                </section>
              )}
            </div>

            <aside className="ret-work-rail">
              {/* 顺序：Token 预算 → 最近召回（紧跟预算卡，不再沉到最底下）→ 漏斗 → 裁剪明细 */}
              {result ? (
                <TokenBudgetCard
                  data={budgetView}
                  sourceNote={`本次召回 · ${result.banner.scene} / ${result.banner.mode}`}
                  onOpenSource={() => {
                    window.location.href = `/audit.html?request_id=${encodeURIComponent(result.banner.request_id)}`;
                  }}
                />
              ) : snapshot ? (
                <TokenBudgetCard
                  data={snapshot.data}
                  sourceNote={`最近一次召回 · ${fmtClock(snapshot.ts)}${snapshot.query ? ` · ${snapshot.query.slice(0, 12)}` : ''}`}
                  onOpenSource={() => {
                    window.location.href = `/audit.html?request_id=${encodeURIComponent(snapshot.request_id)}`;
                  }}
                />
              ) : (
                <section className="ret-card" data-testid="budget-empty">
                  <div className="ret-sec-hd"><h3>Token 预算</h3><span className="ret-note">硬熔断 {budgetView.budget_tokens}t</span></div>
                  <div className="ret-note">
                    账本里还没有任何召回记录，所以这里没有可展示的真实读数。运行一次检索后，注入量 / 漏斗 / 裁剪明细会全部按账本真值回填。
                  </div>
                </section>
              )}

              <RecentRecallsCard
                phase={recent.phase}
                rows={recent.rows}
                today={recent.today}
                error={recent.error}
                onRefresh={loadRecent}
                onOpenAudit={(id) => { window.location.href = `/audit.html?request_id=${encodeURIComponent(id)}`; }}
              />

              {(result || snapshot) && (
                <>
                  <FunnelCard data={result ? budgetView : snapshot!.data} />
                  <TrimCard data={result ? budgetView : snapshot!.data} />
                </>
              )}
            </aside>
          </div>
        </>
      )}

      {tab === 'history' && (
        <div className="ret-card ret-history-card">
          <div className="ret-sec-hd">
            <h3>历史查询</h3>
            <span className="ret-sub">来源：账本审计 action=recall（最近 10 条）</span>
            <span className="ret-sec-right"><button type="button" className="ret-btn" onClick={loadHistory}>刷新</button></span>
          </div>
          {history.phase === 'loading' ? (
            <div className="ret-empty">正在读取检索历史…</div>
          ) : history.phase === 'error' ? (
            <div className="ret-empty"><b>检索历史没读到</b><div>原因：{history.error}</div></div>
          ) : history.rows.length === 0 ? (
            <div className="ret-empty" data-testid="ret-history-empty">
              <b>账本暂无检索历史（真实 0 条）</b>
              <div>不注入演示行；完成一次真实检索后这里才出现记录。</div>
            </div>
          ) : (
            <div className="ret-tablewrap">
              <table className="ret-table">
                <thead>
                  <tr>
                    <th>查询号</th><th>查询</th><th>场景 / 模式</th><th>命中</th>
                    <th>payload</th><th>耗时</th><th>结果</th><th>时间</th>
                  </tr>
                </thead>
                <tbody>
                  {history.rows.map((r) => (
                    <tr key={r.request_id}>
                      <td className="mono">{r.request_id}</td>
                      <td>{r.query}</td>
                      <td className="mono">{r.scene} · {r.mode}</td>
                      <td className="num">{r.hits}</td>
                      <td className="num">{r.payload_tokens}</td>
                      <td className="num">{r.latency_ms === null ? '未采集' : `${r.latency_ms} ms`}</td>
                      <td>{r.evidence_thin ? '补查命中' : r.hits > 0 ? '命中' : '无命中'}</td>
                      <td className="mono">{fmtTs(r.ts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="ret-note">历史只读；点审计页可凭 query_id 回放同一链路。</div>
        </div>
      )}

      {tab === 'rules' && (
        <div className="ret-rules-grid">
          <div className="ret-card">
            <div className="ret-sec-hd"><h3>场景与预算（R9）</h3></div>
            <table className="ret-table">
              <thead><tr><th>场景</th><th>预算</th><th>回灌深度</th><th>重排</th></tr></thead>
              <tbody>
                {(['default', 'task_start', 'history_query', 'critical'] as const).map((s) => {
                  const b = resolveSceneBudget(s);
                  return (
                    <tr key={s}>
                      <td>{s === 'default' ? '默认' : s === 'task_start' ? '任务启动' : s === 'history_query' ? '历史查询' : '合规关键'}</td>
                      <td className="num">{b.budget} t</td>
                      <td>{b.backfillDepth}</td>
                      <td>{b.rerank === true ? '强制开（R5）' : b.rerank === 'auto' ? '自动' : '关'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="ret-note">预算输入单位 × 1000 tokens；≤1500 ok / ≤2000 trim / ≤3000 warn / &gt;3000 内核硬熔断。</div>
          </div>

          <div className="ret-card">
            <div className="ret-sec-hd"><h3>注入纪律</h3></div>
            <ul className="ret-bullets">
              <li>只注入 L1（或冷层 L2 占位），L0 密文永不回灌检索上下文。</li>
              <li>默认「全部项目」逐项目召回后合并，结果行标注来源项目，不静默丢弃。</li>
              <li>结果按真实 score 排序；记住/忘记走内核 17.3 操作并写 memory_op 审计。</li>
              <li>预算裁剪只影响注入集，结果列表仍展示真实召回全量。</li>
              <li>导出为前端 CSV（真实结果），无后端导出接口。</li>
            </ul>
          </div>

          <div className="ret-card">
            <div className="ret-sec-hd"><h3>审计字段</h3></div>
            <ul className="ret-bullets">
              <li>query_id（request_id）可回放：查询 / 场景 / 模式 / 命中数 / payload / 耗时 / evidence_thin。</li>
              <li>未采集字段（pipeline LLM usage 等）如实留空，不用 0 冒充已接通。</li>
              <li>异常态：超时回退第二层；硬熔断后禁用检索 3 秒（§6）。</li>
              <li>本页规则只读，不提供修改内核参数入口。</li>
            </ul>
          </div>
        </div>
      )}

      {toastMsg && <div className="ret-toast" data-testid="toast" role="status">{toastMsg}</div>}
      {toast}
    </div>
  );
}
