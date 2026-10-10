// 检索页（REQ-012）T6 编排：查询栏 + 横幅 + 结果 + 预算 + 上下文 + 异常态
import { useState } from 'react';
import { QueryBar, type QueryBarValue } from './QueryBar.tsx';
import { ResultList } from './ResultList.tsx';
import { ModeBanner } from './ModeBanner.tsx';
import { BudgetPanel } from './BudgetPanel.tsx';
import { ContextPanel } from './ContextPanel.tsx';
import { useRetrieval } from './useRetrieval.ts';
import { useToast } from './useToast.tsx';
import type { RetrievalHit } from './types.ts';
import { SEED_HITS } from './seed.ts';

export function RetrievalPage() {
  const [qv, setQv] = useState<QueryBarValue>({ query: '', scene: 'default', mode: null });
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hits, setHits] = useState<RetrievalHit[]>([]);
  const { phase, errorKind, result, cooldown, search } = useRetrieval();
  const { node: toast } = useToast();

  const flash = (m: string) => {
    setToastMsg(m);
    window.setTimeout(() => setToastMsg(null), 2200);
  };

  const doSearch = (opts?: { forceBreach?: boolean; forceTimeout?: boolean }) => {
    setSelectedId(null);
    search(qv.query, qv.scene, qv.mode, opts);
  };

  // demo：记住/忘记直接改本地 hits（17.3 文案）
  const remember = (id: string) => {
    setHits((prev) => prev.map((h) => (h.memory_id === id ? { ...h, importance: Math.min(1, h.importance + 0.1), confidence: Math.min(1, h.confidence + 0.05), decay_class: 'hot' } : h)));
    flash('已提升这条信息的优先级。');
  };
  const forget = (id: string) => {
    setHits((prev) => prev.map((h) => (h.memory_id === id ? { ...h, importance: Math.max(0.1, h.importance - 0.1), confidence: Math.max(0.05, h.confidence - 0.05), decay_class: 'warm' } : h)));
    flash('这条信息已降权，后续会较少主动出现。你可以稍后恢复。');
  };
  const feedback = (id: string) => flash(`跳反馈页预填 memory_id=${id}（占位）`);

  const loading = phase === 'LOADING';
  const current = SEED_HITS.find((h) => h.memory_id === selectedId) ?? hits.find((h) => h.memory_id === selectedId) ?? null;
  const displayHits = hits.length > 0 ? hits : result?.hits ?? [];

  return (
    <div className="wrap" data-testid="retrieval-page">
      <h1>🔎 检索页 <span className="badge p2">REQ-012</span></h1>
      <div className="sub">透明化召回：scene/mode 分流（2.4.4）+ 预算三档（R9）+ 异常态（§6）· 数据本地种子为真相</div>

      <QueryBar
        value={qv}
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
            {errorKind === 'breach' && <button type="button" className="btn" data-testid="breach-demo" onClick={() => doSearch({ forceBreach: true })}>模拟硬熔断</button>}
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
            onRequestId={(id) => flash(`跳审计页定位 ${id} 全链路（占位）`)}
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
                onLifecycle={(id) => flash(`跳生命周期页带 memory_id=${id}（占位）`)}
                onAudit={(id) => flash(`查 ${id} 审计（占位）`)}
              />
            </div>
          </div>
          <div className="card">
            <b>异常态演示（§6）</b>
            <div className="row">
              <button type="button" className="btn" data-testid="demo-breach" onClick={() => doSearch({ forceBreach: true })}>模拟硬熔断（payload&gt;3000）</button>
              <button type="button" className="btn" data-testid="demo-timeout" onClick={() => doSearch({ forceTimeout: true })}>模拟超时</button>
            </div>
          </div>
        </>
      )}

      {toastMsg && <div className="toast" data-testid="toast" role="status">{toastMsg}</div>}
      {toast}
    </div>
  );
}
