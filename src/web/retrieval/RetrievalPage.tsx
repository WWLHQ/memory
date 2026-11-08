// 检索页（REQ-012）· 定稿三标签：检索工作台 / 历史查询 / 规则
// 工作台 = 查询条（6 项）+ 预算面板 + 结果行 + 审计轨迹；数据源 = 内核账本真实召回（禁止种子）。
// 默认「全部项目」逐项目召回合并，结果行标明来源项目；导出无后端接口 → 前端 CSV 并注明。
import { useEffect, useState } from 'react';
import { QueryBar, type QueryBarValue } from './QueryBar.tsx';
import { ResultList } from './ResultList.tsx';
import { ModeBanner } from './ModeBanner.tsx';
import { BudgetPanel } from './BudgetPanel.tsx';
import { ContextPanel } from './ContextPanel.tsx';
import { useRetrieval } from './useRetrieval.ts';
import { ALL_PROJECTS_SCOPE, coreReorderMemory, coreRecallHistory } from './coreEngine.ts';
import { listProjectIds } from '../shared/kernelProjects.ts';
import { AuditTrailCard } from './AuditTrailCard.tsx';
import { useToast } from './useToast.tsx';
import { useHostTheme } from '../shared/hostTheme.ts';
import { resolveSceneBudget } from './logic.ts';
import type { BudgetData, RecallHistoryRow } from './types.ts';

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

  return (
    <div className="p0-page" data-testid="retrieval-page">
      {/* 从审计页 ↗ 带 ?request_id= 跳来时，真查账本回放该链路；无参数不渲染 */}
      <AuditTrailCard search={typeof window === 'undefined' ? '' : window.location.search} />

      <div className="p0-hd page-hd">
        <h2>检索 · ma.read</h2>
        <span className="p0-sub">透明化召回：scene/mode 分流（2.4.4）· 预算 R9 · 异常态 §6 · 真相 = 内核账本</span>
        <span className="p0-right">
          <span className="p0-tag ok">真实账本 · 只读</span>
          <span className="p0-tag info">{qv.project === ALL_PROJECTS_SCOPE || qv.project === undefined ? '全部项目' : qv.project}</span>
        </span>
      </div>

      <div className="p0-tabs" role="tablist" aria-label="检索页标签">
        {TABS.map((t) => (
          <button
            type="button"
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`p0-tab${tab === t.id ? ' active' : ''}`}
            data-testid={`ret-tab-${t.id}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'history' && history.rows.length > 0 ? <span className="p0-tabnum">{history.rows.length}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'work' && (
        <>
          {loading && <div className="p0-card" data-testid="loading">检索中…（骨架屏）</div>}

          {phase === 'ERROR' && (
            <div className="p0-card" data-testid="error-panel">
              <div className="p0-hd">
                <h3>检索失败</h3>
                <span className="p0-tag err">{errorKind === 'breach' ? 'BREACH' : 'ERROR'}</span>
              </div>
              <div className="p0-note" style={{ marginTop: 6 }}>
                {errorKind === 'breach'
                  ? '召回超硬熔断上限，本次已降级为「无记忆」响应。请缩小范围或拆分查询。'
                  : errorKind === 'timeout'
                    ? '召回失败（内核不可达或超时），未伪造结果。'
                    : '召回超时，已回退到第二层轻量打分结果。'}
              </div>
              <div className="p0-row-actions">
                {(errorKind === 'timeout' || errorKind !== 'breach') && (
                  <button type="button" className="p0-btn" data-testid="retry-btn" onClick={() => doSearch()}>重试</button>
                )}
                {cooldown && <span className="p0-note">已禁用检索 3 秒（§6）</span>}
              </div>
            </div>
          )}

          {phase === 'EMPTY' && (
            <div className="p0-card" data-testid="empty-panel">
              <div className="p0-hd"><h3>没有可靠的记忆证据</h3></div>
              <div className="p0-note">建议：换个说法，或切到「事实优先」模式扩大召回深度。</div>
              <div className="p0-row-actions">
                <button
                  type="button" className="p0-btn primary" data-testid="empty-fact-retry"
                  onClick={() => { setQv({ ...qv, mode: 'fact_first' }); doSearch(); }}
                >
                  切事实优先重试
                </button>
              </div>
            </div>
          )}

          {phase === 'RESULT' && result && (
            <ModeBanner
              data={result.banner}
              onRequestId={(id) => { window.location.href = `/audit.html?request_id=${encodeURIComponent(id)}`; }}
              onFactRetry={() => { setQv({ ...qv, mode: 'fact_first' }); doSearch(); }}
            />
          )}

          <div className="p0-grid2">
            <div className="p0-col">
              <QueryBar
                value={qv}
                projects={projects}
                loading={loading}
                disabled={cooldown}
                onChange={(v, t) => { setQv(v); if (t) flash(t); }}
                onSubmit={() => doSearch()}
              />

              {result && <BudgetPanel data={budgetView} />}
              {!result && (
                <div className="p0-card">
                  <div className="p0-hd"><h3>预算面板（R9）</h3></div>
                  <div className="p0-note">
                    查询预算 {(qv.budget ?? 1) * 1000} t · 深度 {qv.depth ?? 'L1'}；运行检索后显示真实注入/丢弃。
                  </div>
                </div>
              )}
            </div>

            <div className="p0-col">
              {phase === 'RESULT' && result ? (
                <>
                  <ResultList
                    hits={displayHits}
                    selectedId={selectedId}
                    onView={setSelectedId}
                    onRemember={remember}
                    onForget={forget}
                    onFeedback={feedback}
                    onExport={exportCsv}
                  />

                  <div className="p0-card" data-testid="audit-trail">
                    <div className="p0-hd">
                      <h3>审计轨迹</h3>
                      <span className="p0-tag info">request_id 可回放</span>
                    </div>
                    <div className="p0-kv">
                      <span className="p0-k">query_id</span>
                      <span className="p0-v mono">{result.banner.request_id}</span>
                      <span className="p0-k">场景 / 模式</span>
                      <span className="p0-v">{result.banner.scene} · {result.banner.mode}{result.banner.fallback ? '（自动分流）' : ''}</span>
                      <span className="p0-k">耗时</span>
                      <span className="p0-v mono">{result.latency_ms} ms</span>
                      <span className="p0-k">注入</span>
                      <span className="p0-v mono">
                        L1 × {result.budget.injected_count ?? displayHits.length} · {result.budget.injected_tokens ?? result.budget.payload_tokens} t
                        {result.budget.dropped_count ? ` · 预算丢弃 ${result.budget.dropped_count}` : ''}
                      </span>
                      <span className="p0-k">深度</span>
                      <span className="p0-v">{result.depth}（仅 L1 注入；L2–L6 只做展示）</span>
                      <span className="p0-k">L0</span>
                      <span className="p0-v">不回灌（冷层仅 L2 占位）</span>
                      <span className="p0-k">证据</span>
                      <span className="p0-v">{result.evidence_thin === 'none' ? '正常' : result.evidence_thin === 'backfill_hit' ? '补查命中' : '补查未命中'}</span>
                    </div>
                    <div className="p0-note">审计由内核 recall 真实写入；这里不展示未采集字段（如未接入的 LLM usage）。</div>
                  </div>

                  {current && (
                    <ContextPanel
                      hit={current}
                      query={qv.query}
                      onLifecycle={(id) => { window.location.href = `/lifecycle.html?memory_id=${encodeURIComponent(id)}`; }}
                      onAudit={(id) => { window.location.href = `/audit.html?memory_id=${encodeURIComponent(id)}`; }}
                    />
                  )}
                </>
              ) : null}

              {phase !== 'RESULT' && (
                <div className="p0-card">
                  <div className="p0-hd"><h3>结果</h3></div>
                  <div className="p0-empty dashed">
                    运行一次真实检索后，这里显示召回结果、来源项目与审计轨迹。
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {tab === 'history' && (
        <div className="p0-card">
          <div className="p0-hd">
            <h3>历史查询</h3>
            <span className="p0-sub">来源：账本审计 action=recall（最近 10 条）</span>
            <span className="p0-right"><button type="button" className="p0-btn" onClick={loadHistory}>刷新</button></span>
          </div>
          {history.phase === 'loading' ? (
            <div className="p0-empty">正在读取检索历史…</div>
          ) : history.phase === 'error' ? (
            <div className="p0-empty dashed"><b>检索历史没读到</b><div>原因：{history.error}</div></div>
          ) : history.rows.length === 0 ? (
            <div className="p0-empty dashed" data-testid="ret-history-empty">
              <b>账本暂无检索历史（真实 0 条）</b>
              <div>不注入演示行；完成一次真实检索后这里才出现记录。</div>
            </div>
          ) : (
            <div className="p0-tablewrap">
              <table className="p0-table">
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
          <div className="p0-note">历史只读；点审计页可凭 query_id 回放同一链路。</div>
        </div>
      )}

      {tab === 'rules' && (
        <div className="p0-grid3">
          <div className="p0-card">
            <div className="p0-hd"><h3>场景与预算（R9）</h3></div>
            <table className="p0-table">
              <thead><tr><th>场景</th><th>预算</th><th>回灌深度</th><th>重排</th></tr></thead>
              <tbody>
                {(['default', 'task_start', 'history_query', 'critical'] as const).map((s) => {
                  const b = resolveSceneBudget(s);
                  return (
                    <tr key={s}>
                      <td className="mono">{s}</td>
                      <td className="num">{b.budget} t</td>
                      <td>{b.backfillDepth}</td>
                      <td>{b.rerank === true ? '强制开（R5）' : b.rerank === 'auto' ? '自动' : '关'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="p0-note">预算输入单位 × 1000 tokens；≤1500 ok / ≤2000 trim / ≤3000 warn / &gt;3000 内核硬熔断。</div>
          </div>

          <div className="p0-card">
            <div className="p0-hd"><h3>注入纪律</h3></div>
            <ul className="p0-bullets">
              <li>只注入 L1（或冷层 L2 占位），L0 密文永不回灌检索上下文。</li>
              <li>默认「全部项目」逐项目召回后合并，结果行标注来源项目，不静默丢弃。</li>
              <li>结果按真实 score 排序；记住/忘记走内核 17.3 操作并写 memory_op 审计。</li>
              <li>预算裁剪只影响注入集，结果列表仍展示真实召回全量。</li>
              <li>导出为前端 CSV（真实结果），无后端导出接口。</li>
            </ul>
          </div>

          <div className="p0-card">
            <div className="p0-hd"><h3>审计字段</h3></div>
            <ul className="p0-bullets">
              <li>query_id（request_id）可回放：查询 / 场景 / 模式 / 命中数 / payload / 耗时 / evidence_thin。</li>
              <li>未采集字段（pipeline LLM usage 等）如实留空，不用 0 冒充已接通。</li>
              <li>异常态：超时回退第二层；硬熔断后禁用检索 3 秒（§6）。</li>
              <li>本页规则只读，不提供修改内核参数入口。</li>
            </ul>
          </div>
        </div>
      )}

      {toastMsg && <div className="toast" data-testid="toast" role="status">{toastMsg}</div>}
      {toast}
    </div>
  );
}
