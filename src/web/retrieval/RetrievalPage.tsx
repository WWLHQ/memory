// 检索页（REQ-012）T6 编排：查询栏 + 横幅 + 结果 + 预算 + 上下文 + 异常态
// 数据源 = 内核账本（禁止注入种子；空库即 EMPTY 态）
import { useEffect, useState } from 'react';
import { QueryBar, type QueryBarValue } from './QueryBar.tsx';
import { ResultList } from './ResultList.tsx';
import { ModeBanner } from './ModeBanner.tsx';
import { BudgetPanel } from './BudgetPanel.tsx';
import { ContextPanel } from './ContextPanel.tsx';
import { useRetrieval } from './useRetrieval.ts';
import { ALL_PROJECTS_SCOPE, coreReorderMemory } from './coreEngine.ts';
import { listProjectIds } from '../shared/kernelProjects.ts';
import { AuditTrailCard } from './AuditTrailCard.tsx';
import { useToast } from './useToast.tsx';

export function RetrievalPage() {
  const [qv, setQv] = useState<QueryBarValue>({ query: '', scene: 'default', mode: null, project: ALL_PROJECTS_SCOPE });
  const [projects, setProjects] = useState<string[]>([]);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  const doSearch = () => {
    setSelectedId(null);
    search(qv.query, qv.scene, qv.mode, qv.project ?? ALL_PROJECTS_SCOPE);
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
  // 跳反馈页（真实导航，预填 memory_id），不再弹假提示
  const feedback = (id: string) => { window.location.href = `/feedback.html?memory_id=${encodeURIComponent(id)}`; };

  const loading = phase === 'LOADING';
  const displayHits = result?.hits ?? [];
  const current = displayHits.find((h) => h.memory_id === selectedId) ?? null;

  return (
    <div className="wrap" data-testid="retrieval-page">
      <h1>🔎 检索页 <span className="badge p2">REQ-012</span></h1>
      <div className="sub">透明化召回：scene/mode 分流（2.4.4）+ 预算三档（R9）+ 异常态（§6）· 数据真相 = 内核账本</div>

      {/* 阶段5-A：从审计页 ↗ 带 ?request_id= 跳来时，真查账本回放该链路；无参数不渲染 */}
      <AuditTrailCard search={typeof window === 'undefined' ? '' : window.location.search} />

      <QueryBar
        value={qv}
        projects={projects}
        loading={loading}
        disabled={cooldown}
        onChange={(v, t) => { setQv(v); if (t) flash(t); }}
        onSubmit={() => doSearch()}
      />

      {loading && <div className="card" data-testid="loading">检索中…（骨架屏）</div>}

      {phase === 'ERROR' && (
        <div className="card" data-testid="error-panel">
          <span className="status deprecated">ERROR</span>
          <div style={{ marginTop: 8 }}>
            {errorKind === 'breach'
              ? '召回超硬熔断上限，本次已降级为「无记忆」响应。请缩小范围或拆分查询。'
              : '召回超时，已回退到第二层轻量打分结果。'}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            {errorKind === 'timeout' && <button type="button" className="btn" data-testid="retry-btn" onClick={() => doSearch()}>重试</button>}
          </div>
          {cooldown && <div className="note">已禁用检索 3 秒（§6）</div>}
        </div>
      )}

      {phase === 'EMPTY' && (
        <div className="card" data-testid="empty-panel">
          没有可靠的记忆证据。建议：换个说法，或切到「事实优先」模式扩大召回深度。
          <div className="row" style={{ marginTop: 8 }}>
            <button type="button" className="btn primary" data-testid="empty-fact-retry" onClick={() => { setQv({ ...qv, mode: 'fact_first' }); doSearch(); }}>切事实优先重试</button>
          </div>
        </div>
      )}

      {phase === 'RESULT' && result && (
        <>
          <ModeBanner
            data={result.banner}
            onRequestId={(id) => { window.location.href = `/audit.html?request_id=${encodeURIComponent(id)}`; }}
            onFactRetry={() => { setQv({ ...qv, mode: 'fact_first' }); doSearch(); }}
          />
          <ResultList
            hits={displayHits}
            selectedId={selectedId}
            onView={setSelectedId}
            onRemember={remember}
            onForget={forget}
            onFeedback={feedback}
          />
          <div className="row" style={{ gap: 14, alignItems: 'stretch', margin: '0 0 14px' }}>
            <div style={{ flex: 1, minWidth: 300, display: 'flex' }}>
              <BudgetPanel data={result.budget} />
            </div>
            <div style={{ flex: 1, minWidth: 300, display: 'flex' }}>
              <ContextPanel
                hit={current}
                query={qv.query}
                onLifecycle={(id) => { window.location.href = `/lifecycle.html?memory_id=${encodeURIComponent(id)}`; }}
                onAudit={(id) => { window.location.href = `/audit.html?memory_id=${encodeURIComponent(id)}`; }}
              />
            </div>
          </div>
        </>
      )}

      {toastMsg && <div className="toast" data-testid="toast" role="status">{toastMsg}</div>}
      {toast}
    </div>
  );
}
